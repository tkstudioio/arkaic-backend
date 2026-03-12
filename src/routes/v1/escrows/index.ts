import { Hono } from "hono";
import { bearerAuth, type AuthEnv } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkPayment } from "@/routes/v1/escrows/check-payment";
import { collaborate } from "@/routes/v1/escrows/collaborate";
import { refund } from "@/routes/v1/escrows/refund";

export const escrows = new Hono<AuthEnv>();

escrows.use(bearerAuth);

// GET /:escrowId — escrow detail
escrows.get("/:escrowId", async (c) => {
  const escrowId = Number(c.req.param("escrowId"));
  const pubkey = c.get("pubkey");

  const escrow = await prisma.escrow.findUnique({
    where: { id: escrowId },
    include: { buyer: true, seller: true, chat: { include: { product: true } } },
  });

  if (!escrow) return c.json({ error: "Escrow not found" }, 404);

  if (escrow.buyer.pubkey !== pubkey && escrow.seller.pubkey !== pubkey) {
    return c.json({ error: "Forbidden" }, 403);
  }

  return c.json(escrow);
});

escrows.route("/:escrowId/check-payment", checkPayment);
escrows.route("/:escrowId/collaborate", collaborate);
escrows.route("/:escrowId/refund", refund);
