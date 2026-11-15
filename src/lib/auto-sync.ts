import { useMusicStore } from "@/store/music-store";
import { checkAndSync } from "./sync";

// One request per two minutes while visible; edits are coalesced for 15 seconds.
// The server skips KV.put when the merged snapshot is unchanged.
export function startAutoSync() {
  let running = false;
  let stopped = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastAttempt = 0;
  const run = async () => {
    if (stopped || document.visibilityState === "hidden" || !navigator.onLine) return;
    if (running) { pending = true; return; }
    if (Date.now() - lastAttempt < 60_000) { schedule(); return; }
    lastAttempt = Date.now();
    running = true;
    const before = useMusicStore.getState();
    const snapshot = JSON.stringify([before.favorites, before.playlists]);
    try { await checkAndSync(true); }
    finally {
      running = false;
      const after = useMusicStore.getState();
      if (!stopped && (pending || snapshot !== JSON.stringify([after.favorites, after.playlists]))) {
        pending = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), Math.max(15_000, 60_000 - (Date.now() - lastAttempt)));
  };
  const unsubscribe = useMusicStore.subscribe((state, previous) => {
    if (state.favorites !== previous.favorites || state.playlists !== previous.playlists) {
      // Applying a server response also changes references; do not echo it back.
      if (!running) schedule();
    }
  });
  const foreground = () => { if (document.visibilityState !== "hidden") void run(); };
  document.addEventListener("visibilitychange", foreground);
  window.addEventListener("online", foreground);
  const interval = setInterval(() => void run(), 120_000);
  // Allow both async persisted stores to finish hydration first.
  void Promise.resolve(useMusicStore.persist.rehydrate()).then(() => { if (!stopped) void run(); });
  return () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(interval);
    unsubscribe();
    document.removeEventListener("visibilitychange", foreground);
    window.removeEventListener("online", foreground);
  };
}
