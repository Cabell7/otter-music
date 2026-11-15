import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let state = { favorites: [] as string[], playlists: [] as string[] };
  let listener: ((s: typeof state, p: typeof state) => void) | undefined;
  return {
    getState: () => state,
    rehydrate: vi.fn(async () => {}),
    subscribe: (fn: typeof listener) => { listener = fn; return () => { listener = undefined; }; },
    edit: (favorites: string[]) => { const previous = state; state = { ...state, favorites }; listener?.(state, previous); },
    reset: () => { state = { favorites: [], playlists: [] }; listener = undefined; },
    sync: vi.fn(),
  };
});
vi.mock("@/store/music-store", () => ({ useMusicStore: { getState: mocks.getState, subscribe: mocks.subscribe, persist: { rehydrate: mocks.rehydrate } } }));
vi.mock("./sync", () => ({ checkAndSync: mocks.sync }));
import { startAutoSync } from "./auto-sync";

describe("automatic synchronization", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); mocks.reset(); mocks.sync.mockReset().mockResolvedValue({ success: true }); Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); });
  afterEach(() => { vi.useRealTimers(); });
  it("coalesces changes and waits at least one minute between requests", async () => {
    const stop = startAutoSync(); await vi.advanceTimersByTimeAsync(0);
    mocks.edit(["a"]); await vi.advanceTimersByTimeAsync(10_000); mocks.edit(["a", "b"]);
    await vi.advanceTimersByTimeAsync(49_999); expect(mocks.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(mocks.sync).toHaveBeenCalledTimes(2); stop();
  });
  it("pushes edits made during an in-flight request", async () => {
    let finish!: () => void;
    mocks.sync.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const stop = startAutoSync(); await vi.advanceTimersByTimeAsync(0);
    mocks.edit(["new"]); finish(); await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.sync).toHaveBeenCalledTimes(2); stop();
  });
  it("waits while hidden and stops all future work", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const stop = startAutoSync(); await vi.advanceTimersByTimeAsync(0); mocks.edit(["a"]);
    await vi.advanceTimersByTimeAsync(120_000); expect(mocks.sync).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.sync).toHaveBeenCalledTimes(1); stop(); mocks.edit(["b"]);
    await vi.advanceTimersByTimeAsync(180_000); expect(mocks.sync).toHaveBeenCalledTimes(1);
  });
});
