import { createMiddleware } from "hono/factory";

export type AuthEnv = { Variables: { pubkey: string } };

export const bearerAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const pubkey = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!pubkey) return c.json({ error: "Missing pubkey in Bearer token" }, 401);
  c.set("pubkey", pubkey);

  await next();
});
