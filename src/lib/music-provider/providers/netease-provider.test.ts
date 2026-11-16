import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/api/config"); vi.doUnmock("@/lib/netease/netease-api"); });

describe("NeteaseProvider search routing", () => {
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
