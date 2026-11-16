import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { metadataRoutes } from "./routes/metadata";
import { authRoutes } from "./routes/auth";
import { syncRoutesV2 } from "./routes/sync-v2";
import type { Env } from "./types/hono";

export const app = new Hono<{ Bindings: Env }>();
// Private deployment: no outbound fetch routes or media relays.
app.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin) {
    return c.json({ success: false, message: "Forbidden origin" }, 403);
  }
  await next();
});
app.use("*", bodyLimit({ maxSize: 8 * 1024 * 1024 }));
app.get("/health", (c) => c.text("OK"));
app.route("/auth", authRoutes);
app.route("/metadata", metadataRoutes);
app.route("/sync/v2", syncRoutesV2);
// JSON avoids index.html fallback on disabled API paths.
app.notFound((c) => c.json({ success: false, message: "Not found" }, 404));
export type AppType = typeof app;


