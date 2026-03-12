import { Hono } from "hono";
import { bearerAuth, type AuthEnv } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { checkPayment } from "./check-payment.js";
import { collaborate } from "./collaborate.js";
import { refund } from "./refund.js";

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
