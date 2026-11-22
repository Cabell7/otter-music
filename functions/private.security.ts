import { describe, it, expect, vi } from "vitest";
import { app } from "./app";
import { signJWT, signSiteJWT } from "./utils/auth";

const password = "unit-test-only-password-with-32-chars";
function fixture() {
  const values = new Map<string, { value: any; metadata: any }>();
  const kv = {
    get: vi.fn(async (key: string) => values.get(key)?.value ?? null),
    getWithMetadata: vi.fn(
      async (key: string) => values.get(key) ?? { value: null, metadata: null }
    ),
    put: vi.fn(async (key: string, value: any, options?: any) => {
      values.set(key, { value, metadata: options?.metadata ?? null });
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true })),
  };
  const env = { PASSWORD: password, oh_file_url: kv };
  const request = (path: string, init?: RequestInit) =>
    app.request(`https://music.test${path}`, init, env);
  return { env, kv, request };
}

describe("private deployment", () => {
  it("disables every proxy route without making outbound requests", async () => {
    const f = fixture();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const path of [
      "/proxy?url=https://example.com/a.mp3",
      "/proxy/a",
      "/music-api",
      "/music-api/bilibili/audio?url=https://example.com",
      "/api/fetch?url=https://example.com",
      "/podcast-api",
      "/sync/pull",
    ]) {
      expect((await f.request(path)).status).toBe(404);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(f.kv.put).not.toHaveBeenCalled();
  });
  it("serves authenticated source lookups without mounting audio relay paths", async () => {
    const { request } = fixture();
    const path = "/api/bilibili/x/player/playurl?bvid=BV123&cid=1";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"code":0}', {
        headers: { "Content-Type": "application/json" },
      })
    );
    try {
      expect((await request(path)).status).toBe(401);
      const headers = { Cookie: `site=${await signSiteJWT(password)}` };
      expect(
        (
          await request("/api/bilibili-audio?url=https://example.com", {
            headers,
          })
        ).status
      ).toBe(404);
      expect(await (await request(path, { headers })).json()).toEqual({
        code: 0,
      });
      expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
        new URL("https://api.bilibili.com/x/player/playurl?bvid=BV123&cid=1"),
        expect.objectContaining({ redirect: "manual" })
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("retries Bilibili search once with a server-issued visitor session", async () => {
    const { request } = fixture();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(
        Response.json({ data: { b_3: "visitor-3", b_4: "visitor-4" } })
      )
      .mockImplementationOnce(async (_url, init) => {
        expect(new Headers(init?.headers).get("Cookie")).toBe(
          "buvid3=visitor-3; buvid4=visitor-4"
        );
        return Response.json({ code: 0 });
      });
    try {
      const response = await request(
        "/api/bilibili/x/web-interface/search/type?keyword=Jay",
        {
          headers: { Cookie: `site=${await signSiteJWT(password)}` },
        }
      );
      expect(await response.json()).toEqual({ code: 0 });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects missing/forged credentials, extension bypasses and hostile origins", async () => {
    const f = fixture();
    for (const path of ["/sync/v2/keys", "/sync/v2/keys/data.json"]) {
      expect(
        (
          await f.request(path, {
            method: path.endsWith("json") ? "DELETE" : "GET",
          })
        ).status
      ).toBe(401);
    }
    expect(
      (
        await f.request("/sync/v2/create-key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status
    ).toBe(401);
    expect((await f.request("/sync/v2/pull")).status).toBe(401);
    expect(
      (
        await f.request("/sync/v2/pull", {
          headers: { Authorization: "Bearer invalid-key-of-16chars" },
        })
      ).status
    ).toBe(404);
    expect(
      (
        await f.request("/auth/login", {
          method: "POST",
          headers: {
            Origin: "https://evil.test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ password }),
        })
      ).status
    ).toBe(403);
    expect(f.kv.put).not.toHaveBeenCalled();
  });
  it("fails closed without a password and sets a secure HttpOnly admin cookie", async () => {
    const f = fixture();
    expect(
      (
        await app.request(
          "https://music.test/sync/v2/keys",
          { headers: { Cookie: `auth=${await signJWT("secret")}` } },
          { ...f.env, PASSWORD: undefined }
        )
      ).status
    ).toBe(503);
    const res = await f.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(
      /HttpOnly.*SameSite=Lax.*Secure/
    );
    expect(await res.text()).not.toContain("eyJ");
  });
  it("syncs two clients, merges nested tracks, preserves deletion and skips unchanged writes", async () => {
    const f = fixture();
    const cookie = `auth=${await signJWT(password)}`;
    const created = await f.request("/sync/v2/create-key", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{}",
    });
    const key = ((await created.json()) as any).data.syncKey;
    const headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    const push = async (data: any, clientVersion: number) =>
      f.request("/sync/v2", {
        method: "POST",
        headers,
        body: JSON.stringify({ data, clientVersion }),
      });
    const now = Date.now();
    const a = {
      favorites: [{ id: "song", update_time: now, is_deleted: false }],
      playlists: [
        {
          id: "p",
          name: "first",
          update_time: now,
          tracks: [{ id: "a", update_time: now }],
        },
      ],
    };
    expect((await push(a, 0)).status).toBe(200);
    const pull = (await (
      await f.request("/sync/v2/pull", { headers })
    ).json()) as any;
    expect(pull.data.data.favorites[0].id).toBe("song");
    const b = {
      favorites: [{ id: "song", update_time: now + 1, is_deleted: true }],
      playlists: [
        {
          id: "p",
          name: "renamed",
          update_time: now + 1,
          tracks: [{ id: "b", update_time: now + 1 }],
        },
      ],
    };
    expect((await push(b, 0)).status).toBe(409);
    const merged = (await (await push(b, 1)).json()) as any;
    expect(
      merged.data.data.playlists[0].tracks.map((t: any) => t.id).sort()
    ).toEqual(["a", "b"]);
    expect(merged.data.data.playlists[0].name).toBe("renamed");
    expect(merged.data.data.favorites[0].is_deleted).toBe(true);
    const count = f.kv.put.mock.calls.length;
    expect((await push(merged.data.data, merged.data.version)).status).toBe(
      200
    );
    expect(f.kv.put.mock.calls.length).toBe(count);
    // Force compressed payload round-trip, beyond stream backpressure buffers.
    const large = {
      ...merged.data.data,
      favorites: Array.from({ length: 1000 }, (_, i) => ({
        id: `t${i}`,
        name: "track".repeat(40),
        update_time: now,
      })),
    };
    expect((await push(large, merged.data.version)).status).toBe(200);
    const roundtrip = (await (
      await f.request("/sync/v2/pull", { headers })
    ).json()) as any;
    expect(roundtrip.data.data.favorites.length).toBe(1001);
  });
});

describe("site session", () => {
  it("requires the password, returns the existing key, and never grants admin rights", async () => {
    const f = fixture();
    const key = "private_ABCDEFGHJKLMNPQR";
    f.kv.list.mockResolvedValue({
      keys: [{ name: `sync:${key}` }],
      list_complete: true,
    });
    const prefix = (await import("@otter-music/shared")).SYNC_KEY_PREFIX;
    f.kv.list.mockResolvedValue({
      keys: [{ name: `${prefix}${key}` }],
      list_complete: true,
    });
    const login = (password: string) =>
      f.request("/auth/site-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
    expect((await login("wrong")).status).toBe(401);
    const response = await login(password);
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).data.syncKey).toBe(key);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(
      /HttpOnly; Secure; SameSite=Strict; Max-Age=7776000/
    );
    expect(
      (await f.request("/auth/session", { headers: { Cookie: cookie } })).status
    ).toBe(200);
    expect(
      (await f.request("/sync/v2/keys", { headers: { Cookie: cookie } })).status
    ).toBe(401);
    const forgedAdminCookie = cookie.replace(/^site=/, "auth=");
    expect(
      (
        await f.request("/sync/v2/keys", {
          headers: { Cookie: forgedAdminCookie },
        })
      ).status
    ).toBe(401);
    expect(
      (await f.request("/auth/site-logout", { method: "POST" })).headers.get(
        "set-cookie"
      )
    ).toContain("Max-Age=0");
    expect(f.kv.put).not.toHaveBeenCalled();
  });
  it("fails closed when the private key is missing or ambiguous", async () => {
    const f = fixture();
    const login = () =>
      f.request("/auth/site-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
    expect((await login()).status).toBe(503);
    f.kv.list.mockResolvedValue({
      keys: [{ name: "one" }, { name: "two" }],
      list_complete: true,
    });
    expect((await login()).status).toBe(503);
    expect(f.kv.put).not.toHaveBeenCalled();
  });
});
