import { useMusicStore } from "@/store/music-store";
import { useSyncStore } from "@/store/sync-store";
import { checkAndSync, flushSyncOnPageHide, isApplyingSync, refreshFromCloud } from "./sync";

export function startAutoSync() {
  let running = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe = () => {};
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void push(), 4000);
  };
  const push = async () => {
    if (stopped || document.visibilityState === "hidden" || !navigator.onLine || running || !useSyncStore.getState().dirty) return;
    running = true;
    const result = await checkAndSync(true, true);
    running = false;
    if (!stopped && result.success && useSyncStore.getState().dirty) schedule();
  };
  const foreground = async () => {
    if (stopped || document.visibilityState === "hidden" || !navigator.onLine || running) return;
    running = true;
    await refreshFromCloud();
    running = false;
    if (!stopped && useSyncStore.getState().dirty) schedule();
  };
  const hide = () => flushSyncOnPageHide();
  document.addEventListener("visibilitychange", foreground);
  window.addEventListener("online", foreground);
  window.addEventListener("pagehide", hide);
  void Promise.resolve(useMusicStore.persist.rehydrate()).then(() => {
    if (stopped) return;
    unsubscribe = useMusicStore.subscribe((state, previous) => {
      if (isApplyingSync()) return;
      if (JSON.stringify([state.favorites, state.playlists]) !== JSON.stringify([previous.favorites, previous.playlists])) {
        useSyncStore.getState().setDirty(true);
        schedule();
      }
    });
    void foreground();
  });
  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
    document.removeEventListener("visibilitychange", foreground);
    window.removeEventListener("online", foreground);
    window.removeEventListener("pagehide", hide);
  };
}
