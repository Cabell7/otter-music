import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/api/config"); vi.doUnmock("@/lib/netease/netease-api"); });

describe("NeteaseProvider search routing", () => {
  it("uses GD metadata for web cover and lyrics", async () => {
    vi.doMock("@/lib/api/config", async (original) => ({ ...(await original<typeof import("@/lib/api/config")>()), IS_NATIVE: false }));
    const { BaseMusicProvider } = await import("../base-provider");
    const cover = vi.spyOn(BaseMusicProvider.prototype, "getPic").mockResolvedValue("https://example.test/cover.jpg");
    const lyric = vi.spyOn(BaseMusicProvider.prototype, "getLyric").mockResolvedValue({ lyric: "test", tlyric: "" });
    const { NeteaseProvider } = await import("./netease-provider");
    const track = { id: "123", pic_id: "456", lyric_id: "123", source: "netease" } as import("@/types/music").MusicTrack;
    const provider = new NeteaseProvider();
    expect(await provider.getPic(track, 400)).toBe("https://example.test/cover.jpg");
    expect(await provider.getLyric(track)).toEqual({ lyric: "test", tlyric: "" });
    expect(cover).toHaveBeenCalledWith(track, 400);
    expect(lyric).toHaveBeenCalledWith(track);
  });
  it("uses GD search on web and forwards the abort signal", async () => {
    vi.doMock("@/lib/api/config", async (original) => ({ ...(await original<typeof import("@/lib/api/config")>()), IS_NATIVE: false }));
    const { BaseMusicProvider } = await import("../base-provider");
    const result = { items: [], hasMore: false };
    const search = vi.spyOn(BaseMusicProvider.prototype, "search").mockResolvedValue(result);
    const { NeteaseProvider } = await import("./netease-provider");
    const signal = new AbortController().signal;
    expect(await new NeteaseProvider().search("test", 2, 20, signal)).toBe(result);
    expect(search).toHaveBeenCalledWith("test", 2, 20, signal, undefined);
  });
  it("retains official search on native", async () => {
    vi.doMock("@/lib/api/config", async (original) => ({ ...(await original<typeof import("@/lib/api/config")>()), IS_NATIVE: true }));
    const nativeSearch = vi.fn().mockResolvedValue({ data: { result: { songs: [], songCount: 0 } } });
    vi.doMock("@/lib/netease/netease-api", () => ({ search: nativeSearch }));
    const { NeteaseProvider } = await import("./netease-provider");
    expect(await new NeteaseProvider().search("test", 2, 20)).toEqual({ items: [], hasMore: false });
    expect(nativeSearch).toHaveBeenCalledWith("test", 1, 2, 20);
  });
});
