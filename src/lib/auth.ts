import { createMiddleware } from "hono/factory";

export type AuthEnv = { Variables: { pubkey: string } };

export const bearerAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const jwt = c.req.header("Authorization")?.replace("Bearer ", "");

  console.log(jwt);
  await next();
});
