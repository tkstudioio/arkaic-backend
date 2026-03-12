import { Hono } from "hono";
import { prisma } from "@/lib/prisma";
import { bearerAuth, type AuthEnv } from "@/lib/auth";

export const account = new Hono<AuthEnv>();

account.use(bearerAuth);

account.get("/selling", async (c) => {
  const pubkey = c.get("pubkey");
  const seller = await prisma.account.findUnique({ where: { pubkey } });
  if (!seller) return c.json({ error: "Account not found" }, 404);

  const products = await prisma.products.findMany({
    where: { sellerId: seller.id },
    orderBy: { createdAt: "desc" },
  });
  return c.json(products);
});

account.get("/buying", async (c) => {
  const pubkey = c.get("pubkey");
  const buyer = await prisma.account.findUnique({ where: { pubkey } });
  if (!buyer) return c.json({ error: "Account not found" }, 404);

  const chatsList = await prisma.productChat.findMany({
    where: { buyerId: buyer.id },
    include: { product: { include: { seller: true } }, escrow: true },
    orderBy: { updatedAt: "desc" },
  });
  return c.json(chatsList);
});
