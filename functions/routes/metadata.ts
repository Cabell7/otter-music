import { Hono } from "hono";
import type { Env } from "../types/hono";
import { verifySiteJWT } from "../utils/auth";
import { getPlaylists, getPlaylistDetail, getRecommendPlaylists, getToplist, getAlbum, getArtist } from "../utils/music/netease-api";
import { streamParseRss } from "../utils/rss/parser";
import { getFromCache, putToCache } from "../utils/cache";
import { BILLBOARD_CHART_SLUGS, fetchBillboardChart } from "../utils/music/billboard-api";

export const metadataRoutes = new Hono<{ Bindings: Env }>();
metadataRoutes.use("*", async (c, next) => {
  const token = c.req.header("Cookie")?.match(/(?:^|;\s*)site=([^;]+)/)?.[1];
  if (!token || !c.env.PASSWORD || c.env.PASSWORD.length < 20) return c.json({ error: "Unauthorized" }, 401);
  try { await verifySiteJWT(token, c.env.PASSWORD); } catch { return c.json({ error: "Unauthorized" }, 401); }
  await next();
});
metadataRoutes.use("*", async (c, next) => {
  if (typeof caches === "undefined") return next();
  const cached = await getFromCache(c.req.raw);
  if (cached) { c.res = cached; c.header("Cache-Control", "no-store"); return; }
  await next();
  if (c.res.ok && c.res.headers.get("Content-Type")?.includes("application/json")) {
    c.executionCtx.waitUntil(putToCache(c.req.raw, c.res.clone(), "api"));
  }
});
metadataRoutes.get("/netease/:kind", async (c) => {
  const kind = c.req.param("kind");
  const id = c.req.query("id") || "";
  const cat = c.req.query("cat") || "全部";
  const order = c.req.query("order") || "hot";
  const limit = Number(c.req.query("limit") || 30);
  const offset = Number(c.req.query("offset") || 0);
  if (!["playlists", "playlist", "recommend", "toplist", "album", "artist"].includes(kind)) return c.json({ error: "Not found" }, 404);
  if (["playlist", "album", "artist"].includes(kind) && !/^[0-9]{1,20}$/.test(id)) return c.json({ error: "Invalid id" }, 400);
  if (kind === "playlists" && (!/^[\p{L}\p{N} &+/·-]{1,40}$/u.test(cat) || !["hot", "new"].includes(order) || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000)) return c.json({ error: "Invalid parameters" }, 400);
  try {
    let data: unknown;
    switch (kind) {
      case "playlists": data = (await getPlaylists(cat, order, limit, offset, "")).data; break;
      case "playlist": data = await getPlaylistDetail(id, ""); break;
      case "recommend": data = (await getRecommendPlaylists("")).data; break;
      case "toplist": data = (await getToplist("")).data; break;
      case "album": data = (await getAlbum(id, "")).data; break;
      case "artist": data = (await getArtist(id, "")).data; break;
    }
    return c.json({ success: true, data });
  } catch { return c.json({ error: "Metadata unavailable" }, 502); }
});
metadataRoutes.get("/billboard", async (c) => {
  const chart = c.req.query("chart") || "billboard-global-200";
  const date = c.req.query("date");
  if (!(BILLBOARD_CHART_SLUGS as readonly string[]).includes(chart) || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) return c.json({ error: "Invalid parameters" }, 400);
  try { return c.json({ success: true, data: await fetchBillboardChart(chart, date) }); }
  catch { return c.json({ error: "Chart unavailable" }, 502); }
});

// Fixed sources only; redirects are rejected so the worker never follows an arbitrary URL.
const PODCAST_FEEDS: Record<string, string> = {
  "default-zx7": "https://feed.xyzfm.space/wb39te6k9gqw",
  "default-shengcoffee": "https://www.ximalaya.com/album/51076156.xml",
  "default-bnt": "https://feed.xyzfm.space/vylham8uw3ay",
  "default-zhixing": "https://feed.xyzfm.space/j8yp8gxkmgqr",
  "default-wrzhx": "https://feed.xyzfm.space/ypn9dydpbxpc",
  "default-xsfgs": "https://feed.xyzfm.space/76evp7fxkeu8",
  "default-yzhs": "https://feed.xyzfm.space/hwen8wf69c6g",
  "default-daily": "https://feeds.simplecast.com/54nAGcIl",
  "default-ted-daily": "https://feeds.acast.com/public/shows/67587e77c705e441797aff96",
};
metadataRoutes.get("/podcast", async (c) => {
  const source = c.req.query("source") || "";
  const url = Object.hasOwn(PODCAST_FEEDS, source) ? PODCAST_FEEDS[source] : undefined;
  if (!url) return c.json({ error: "Unknown podcast source" }, 400);
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": "OtterMusic/2.0" } });
    if (!response.ok || !response.body) return c.json({ error: "Podcast upstream failed", upstreamStatus: response.status }, 424);
    const reader = response.body.getReader();
    let bytes = 0;
    const limited = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await reader.read();
          if (result.done) { controller.close(); return; }
          bytes += result.value.byteLength;
          if (bytes > 4 * 1024 * 1024) {
            void reader.cancel().catch(() => {});
            controller.error(new Error("Feed too large"));
            return;
          }
          controller.enqueue(result.value);
        } catch (error) { controller.error(error); }
      },
      cancel() { void reader.cancel().catch(() => {}); },
    });
    return c.json({ success: true, data: await streamParseRss(limited, url) });
  } catch (error) {
    const name = error instanceof Error ? error.name.slice(0, 40) : "Error";
    // Do not expose URLs or arbitrary thrown values in diagnostic output.
    const message = error instanceof Error ? error.message.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 120) : "Unknown error";
    return c.json({ error: "Podcast unavailable", name, message }, 424);
  }
});
