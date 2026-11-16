import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  let state = { favorites: [] as string[], playlists: [] as string[] };
  let listener: ((s: typeof state, p: typeof state) => void) | undefined;
  const syncState = { dirty: false, setDirty: (v: boolean) => { syncState.dirty = v; } };
  return { getState: () => state, syncState, rehydrate: vi.fn(async () => {}),
    subscribe: (fn: typeof listener) => { listener = fn; return () => { listener = undefined; }; },
    edit: (favorites: string[]) => { const previous = state; state = { ...state, favorites }; listener?.(state, previous); },
    reset: () => { state = { favorites: [], playlists: [] }; listener = undefined; syncState.dirty = false; },
    sync: vi.fn(), refresh: vi.fn(), flush: vi.fn(), applying: vi.fn(() => false) };
});
vi.mock("@/store/music-store", () => ({ useMusicStore: { getState: mocks.getState, subscribe: mocks.subscribe, persist: { rehydrate: mocks.rehydrate } } }));
vi.mock("@/store/sync-store", () => ({ useSyncStore: { getState: () => mocks.syncState } }));
vi.mock("./sync", () => ({ checkAndSync: mocks.sync, refreshFromCloud: mocks.refresh, flushSyncOnPageHide: mocks.flush, isApplyingSync: mocks.applying }));
import { startAutoSync } from "./auto-sync";
describe("automatic synchronization", () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.reset(); mocks.sync.mockReset().mockImplementation(async () => { mocks.syncState.dirty = false; return { success: true }; }); mocks.refresh.mockReset().mockResolvedValue(undefined); mocks.flush.mockReset(); mocks.applying.mockReturnValue(false); Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); });
  afterEach(() => vi.useRealTimers());
  it("checks once and coalesces edits without polling", async () => {
    const stop = startAutoSync(); await vi.advanceTimersByTimeAsync(0); expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(mocks.sync).not.toHaveBeenCalled();
    mocks.edit(["a"]); await vi.advanceTimersByTimeAsync(2000); mocks.edit(["a", "b"]); await vi.advanceTimersByTimeAsync(3999); expect(mocks.sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(mocks.sync).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(120000); expect(mocks.refresh).toHaveBeenCalledTimes(1); stop();
  });
  it("retries an edit made during an in-flight upload", async () => {
    let finish!: () => void; mocks.sync.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ success: true }); }));
    const stop = startAutoSync(); await vi.advanceTimersByTimeAsync(0); mocks.edit(["a"]); await vi.advanceTimersByTimeAsync(4000); mocks.edit(["b"]); finish(); await vi.advanceTimersByTimeAsync(4000); expect(mocks.sync).toHaveBeenCalledTimes(2); stop();
  });
  it("skips server-applied changes, waits while hidden, and stops", async () => {
    const stop = startAutoSync(); await vi.advanceTimersByTimeAsync(0); mocks.applying.mockReturnValueOnce(true); mocks.edit(["server"]); await vi.advanceTimersByTimeAsync(4000); expect(mocks.sync).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); mocks.edit(["local"]); await vi.advanceTimersByTimeAsync(4000); expect(mocks.sync).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(4000); expect(mocks.sync).toHaveBeenCalledTimes(1); stop(); mocks.edit(["later"]); await vi.advanceTimersByTimeAsync(10000); expect(mocks.sync).toHaveBeenCalledTimes(1);
  });
});
