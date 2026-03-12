import { Hono } from "hono";
import { prisma } from "@/lib/prisma";
import { bearerAuth, type AuthEnv } from "@/lib/auth";

export const auth = new Hono<AuthEnv>();

auth.use(bearerAuth);

auth.post("/create", async (c) => {
  const pubkey = c.get("pubkey");
  const { accountName } = await c.req.json();

  const account = await prisma.account.create({
    data: { pubkey, accountName },
  });

  console.log(account);

  return c.json(account);
});
