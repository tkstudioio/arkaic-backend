import { Hono } from "hono";
import { prisma } from "../../lib/prisma.js";
import { bearerAuth, type AuthEnv } from "../../lib/auth.js";

export const account = new Hono<AuthEnv>();

account.use(bearerAuth);

account.get("/selling", async (c) => {
  const pubkey = c.get("pubkey");
  const products = await prisma.products.findMany({
    where: { sellerPubkey: pubkey },
    orderBy: { createdAt: "desc" },
  });
  return c.json(products);
});

account.get("/buying", async (c) => {
  const pubkey = c.get("pubkey");
  const chats = await prisma.productChat.findMany({
    where: { buyerPubkey: pubkey },
    include: { product: true },
    orderBy: { updatedAt: "desc" },
  });
  return c.json(chats);
});
