import { Hono } from "hono";
import type { Env } from "../types/hono";
import { verifySiteJWT } from "../utils/auth";
import { getPlaylists, getPlaylistDetail, getRecommendPlaylists, getToplist, getAlbum, getArtist } from "../utils/music/netease-api";
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
