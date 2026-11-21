import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "../types/hono";
import { verifySiteJWT } from "../utils/auth";

export const sourceRoutes = new Hono<{ Bindings: Env }>();

const bili = "https://api.bilibili.com";
const qq = "https://c.y.qq.com";
const musicu = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const endpoints = new Map([
  ...[
    "/x/web-interface/search/type",
    "/x/web-interface/view",
    "/x/player/playurl",
    "/x/player/wbi/v2",
    "/x/series/series",
    "/x/series/archives",
  ].map((path) => [`GET /bilibili${path}`, bili + path] as const),
  [
    "GET /qqmusic/qzone-music/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg",
    "https://i.y.qq.com/qzone-music/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg",
  ],
  [
    "GET /qqmusic-soso/soso/fcgi-bin/client_search_cp",
    qq + "/soso/fcgi-bin/client_search_cp",
  ],
  [
    "GET /qqmusic-soso/splcloud/fcgi-bin/smartbox_new.fcg",
    qq + "/splcloud/fcgi-bin/smartbox_new.fcg",
  ],
  [
    "GET /qqmusic-soso/v8/fcg-bin/fcg_v8_album_info_cp.fcg",
    qq + "/v8/fcg-bin/fcg_v8_album_info_cp.fcg",
  ],
  [
    "GET /qqmusic-lyric/lyric/fcgi-bin/fcg_query_lyric_new.fcg",
    qq + "/lyric/fcgi-bin/fcg_query_lyric_new.fcg",
  ],
  ["GET /qqmusic-search/cgi-bin/musicu.fcg", musicu],
  ["POST /qqmusic-url/cgi-bin/musicu.fcg", musicu],
]);

const qqMethods = new Set([
  "vkey.GetVkeyServer.CgiGetVkey",
  "music.musichallAlbum.AlbumInfoServer.GetAlbumDetail",
  "music.musichallAlbum.AlbumSongList.GetAlbumSongList",
  "userInfo.VipQueryServer.SRFVipQuery_V2",
  "userInfo.BaseUserInfoServer.get_user_baseinfo_v2",
]);

function validQqRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const calls = Object.entries(value).filter(([key]) => key !== "comm");
  return (
    calls.length > 0 &&
    calls.length <= 2 &&
    calls.every(
      ([, call]) => call && qqMethods.has(`${call.module}.${call.method}`)
    )
  );
}

sourceRoutes.use("*", bodyLimit({ maxSize: 16 * 1024 }));

for (const [key, endpoint] of endpoints) {
  const [method, path] = key.split(" ");
  sourceRoutes.on(method, path, async (c) => {
    const token = c.req.header("Cookie")?.match(/(?:^|;\s*)site=([^;]+)/)?.[1];
    if (!token || !c.env.PASSWORD || c.env.PASSWORD.length < 20) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    try {
      await verifySiteJWT(token, c.env.PASSWORD);
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const target = new URL(endpoint);
    target.search = new URL(c.req.url).search;
    const isBili = target.origin === bili;
    const headers = new Headers({
      Referer: isBili ? "https://www.bilibili.com/" : "https://y.qq.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    if (isBili) {
      headers.set("Cookie", "buvid3=0");
    } else {
      headers.set("Origin", "https://y.qq.com");
      if (endpoint === musicu) {
        const cookie = c.req.header("X-Real-Cookie");
        if (cookie) headers.set("Cookie", cookie);
      }
    }

    let body: string | undefined;
    if (endpoint === musicu) {
      try {
        body = method === "POST" ? await c.req.text() : undefined;
        if (
          !validQqRequest(
            JSON.parse(body ?? target.searchParams.get("data") ?? "")
          )
        ) {
          return c.json({ error: "Unsupported QQ Music operation" }, 400);
        }
      } catch {
        return c.json({ error: "Invalid QQ Music request" }, 400);
      }
      if (body) headers.set("Content-Type", "application/json");
    }

    try {
      const upstream = await fetch(target, {
        method,
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      const type = upstream.headers.get("Content-Type") ?? "";
      if (!upstream.ok) {
        return c.json(
          {
            error: "Music source unavailable",
            reason: "upstream_http",
            upstreamStatus: upstream.status,
          },
          424
        );
      }
      if (
        !/^(application\/(json|javascript|x-javascript)|text\/(plain|javascript))(?:;|$)/i.test(
          type
        )
      ) {
        return c.json(
          {
            error: "Music source unavailable",
            reason: "upstream_content_type",
          },
          424
        );
      }
      // Fetch only API payloads. The browser downloads audio from the resulting CDN URL.
      return c.body(upstream.body, 200, {
        "Content-Type": "text/plain; charset=utf-8",
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "TimeoutError"
          ? "upstream_timeout"
          : "upstream_fetch_failed";
      return c.json({ error: "Music source unavailable", reason }, 424);
    }
  });
}
