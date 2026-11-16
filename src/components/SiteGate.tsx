import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { IS_NATIVE } from "@/lib/api/config";
import { useSyncStore } from "@/store/sync-store";

type Status = "loading" | "login" | "ready" | "unavailable";

async function acceptSession(response: Response) {
  if (!response.ok) return response.status === 401 ? "login" : "unavailable";
  const payload = await response.json();
  const key = payload?.data?.syncKey;
  if (typeof key !== "string" || !key) return "unavailable";
  await useSyncStore.persist.rehydrate();
  const current = useSyncStore.getState();
  if (current.syncKey !== key) {
    current.clearSyncConfig();
    useSyncStore.getState().setSyncKey(key);
  }
  return "ready";
}

export function SiteGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(IS_NATIVE ? "ready" : "loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (IS_NATIVE) return;
    let active = true;
    fetch("/auth/session", { credentials: "same-origin", cache: "no-store" })
      .then(acceptSession)
      .then((next) => { if (active) setStatus(next); })
      .catch(() => { if (active) setStatus("unavailable"); });
    return () => { active = false; };
  }, []);
  const login = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const entered = password;
    setPassword("");
    try {
      const response = await fetch("/auth/site-login", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: entered }),
      });
      const next = await acceptSession(response);
      if (next === "login") setError("密码不正确，请重试。");
      else if (next === "unavailable") setError("暂时无法连接，请稍后重试。");
      else setStatus(next);
    } catch { setError("暂时无法连接，请稍后重试。"); }
  };
  if (status === "ready") return <>{children}</>;
  if (status === "loading") return <main className="min-h-screen grid place-items-center">正在连接…</main>;
  if (status === "unavailable") return <main className="min-h-screen grid place-items-center"><div>暂时无法连接。 <button onClick={() => window.location.reload()}>重试</button></div></main>;
  return <main className="min-h-screen grid place-items-center p-6"><form onSubmit={login} className="w-full max-w-sm space-y-4"><h1 className="text-2xl font-semibold">Otter Music</h1><label className="block">访问密码<input autoFocus required type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 block w-full rounded border p-3" autoComplete="current-password" /></label>{error && <p role="alert">{error}</p>}<button className="w-full rounded bg-blue-600 p-3 text-white" type="submit">登录</button></form></main>;
}
