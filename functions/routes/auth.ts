import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { signJWT } from '@utils/auth';

import type { Env } from '../types/hono';
import { fail, ok } from '@utils/response';

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post(
  '/login',
  zValidator(
    'json',
    z.object({
      password: z.string().min(1, 'Password required'),
    })
  ),
  async (c) => {
    const { password } = c.req.valid('json');
    const env = c.env;

    if (!env.PASSWORD || env.PASSWORD.length < 20 || password !== env.PASSWORD) {
      return fail(c, 'Unauthorized', 401);
    }

    const secret = env.PASSWORD;
    const token = await signJWT(secret);

    const isSecure = c.req.url.startsWith("https");
    // Set Cookie
    const cookie = [
      `auth=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=86400",
      isSecure ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ");

    c.header('Set-Cookie', cookie);
    return ok(c, null, 'Login successful', 200);
  }
);

authRoutes.post('/logout', (c) => {
    const isSecure = c.req.url.startsWith("https");
    const cookie = [
      "auth=",
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
      isSecure ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
  
  c.header('Set-Cookie', cookie);
  return ok(c, null, 'Logout successful', 200);
});


// Site sessions are separate from administrator sessions and never create or modify sync data.
async function getPrivateKey(env: Env): Promise<string | null> {
  const { SYNC_KEY_PREFIX } = await import("@otter-music/shared");
  const prefix = `${SYNC_KEY_PREFIX}private_`;
  let cursor: string | undefined;
  const matches: string[] = [];
  do {
    const result = await env.oh_file_url.list({ prefix, cursor });
    matches.push(...result.keys.map((key: { name: string }) => key.name.slice(SYNC_KEY_PREFIX.length)));
    if (matches.length > 1) return null;
    cursor = result.list_complete ? undefined : result.cursor;
    if (!result.list_complete && !cursor) return null;
  } while (cursor);
  return matches.length === 1 ? matches[0] : null;
}
const siteCookie = (value: string, age: number) =>
  `site=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;

authRoutes.post("/site-login", zValidator("json", z.object({ password: z.string().min(1).max(1024) })), async (c) => {
  const password = c.req.valid("json").password;
  if (!c.env.PASSWORD || c.env.PASSWORD.length < 20 || password !== c.env.PASSWORD) return fail(c, "Unauthorized", 401);
  const syncKey = await getPrivateKey(c.env);
  if (!syncKey) return fail(c, "Private sync key unavailable", 503);
  const { signSiteJWT } = await import("@utils/auth");
  c.header("Set-Cookie", siteCookie(await signSiteJWT(c.env.PASSWORD), 90 * 24 * 60 * 60));
  return ok(c, { syncKey });
});

authRoutes.get("/session", async (c) => {
  if (!c.env.PASSWORD || c.env.PASSWORD.length < 20) return fail(c, "Unauthorized", 401);
  const token = c.req.header("Cookie")?.match(/(?:^|;\s*)site=([^;]+)/)?.[1];
  if (!token) return fail(c, "Unauthorized", 401);
  try {
    const { verifySiteJWT } = await import("@utils/auth");
    await verifySiteJWT(token, c.env.PASSWORD);
  } catch { return fail(c, "Unauthorized", 401); }
  const syncKey = await getPrivateKey(c.env);
  if (!syncKey) return fail(c, "Private sync key unavailable", 503);
  return ok(c, { syncKey });
});

authRoutes.post("/site-logout", (c) => {
  c.header("Set-Cookie", siteCookie("", 0));
  return ok(c, null);
});
