import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
const state = vi.hoisted(() => ({ syncKey: null as string | null, setSyncKey: vi.fn((key: string) => { state.syncKey = key; }), clearSyncConfig: vi.fn(() => { state.syncKey = null; }) }));
vi.mock("@/lib/api/config", () => ({ IS_NATIVE: false }));
vi.mock("@/store/sync-store", () => ({ useSyncStore: { getState: () => state, persist: { rehydrate: vi.fn(async () => {}) } } }));
import { SiteGate } from "./SiteGate";
afterEach(() => { vi.unstubAllGlobals(); state.syncKey = null; vi.clearAllMocks(); document.body.innerHTML = ""; });
describe("site login gate", () => {
  it("mounts the player only after login and stores the existing sync key", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 401 })).mockResolvedValueOnce(new Response(JSON.stringify({ data: { syncKey: "private_key_12345678" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<SiteGate><div>播放器</div></SiteGate>); });
    expect(container.textContent).not.toContain("播放器");
    const input = container.querySelector("input")!;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(input, "test-password"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container.textContent).toContain("播放器");
    expect(state.setSyncKey).toHaveBeenCalledWith("private_key_12345678");
    expect(fetchMock.mock.calls[1][0]).toBe("/auth/site-login");
    await act(async () => root.unmount());
  });
});
