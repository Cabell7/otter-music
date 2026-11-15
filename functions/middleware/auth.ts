import { createMiddleware } from "hono/factory";
import { verifyJWT } from "@utils/auth";
import type { Env } from "../types/hono";
import { fail } from "@utils/response";

export const authMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (!c.env.PASSWORD || c.env.PASSWORD.length < 20) return fail(c, "Admin not configured", 503);
  const token = c.req.header("Cookie")?.match(/(?:^|;\s*)auth=([^;]+)/)?.[1];
  if (!token) return fail(c, "Unauthorized", 401);
  try {
    await verifyJWT(token, c.env.PASSWORD);
  } catch {
    return fail(c, "Unauthorized", 401);
  }
  await next();
});
