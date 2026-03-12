import { Hono } from "hono";
import { prisma } from "@/lib/prisma";
import { VirtualCoin } from "@arkade-os/sdk";
import { indexerProvider } from "@/lib/ark";
import { hex } from "@scure/base";
import { buildEscrowContext } from "@/lib/escrow";

export const checkPayment = new Hono();

checkPayment.get("/", async (c) => {
  const escrowId = Number(c.req.param("escrowId"));

  const escrow = await prisma.escrow.findUnique({
    where: { id: escrowId },
    include: { buyer: true, seller: true, chat: true },
  });

  if (!escrow) return c.json({ error: "Escrow not found" }, 404);

  const { escrowScript } = await buildEscrowContext(
    escrow.buyer.pubkey,
    escrow.seller.pubkey,
    escrow.timelockExpiry,
  );

  const { vtxos } = await indexerProvider.getVtxos({
    scripts: [hex.encode(escrowScript.pkScript)],
  });

  const total = (vtxos as VirtualCoin[]).reduce(
    (acc, vtxo) => acc + vtxo.value,
    0,
  );

  if (total < escrow.value) return c.text("Awaiting payment", 404);

  const updatedEscrow = await prisma.$transaction(async (tx) => {
    const e = await tx.escrow.update({
      where: { id: escrow.id },
      data: { status: "fundLocked" },
    });
    await tx.productEvent.create({
      data: {
        productId: escrow.chat.productId,
        action: "funds_locked",
        metadata: JSON.stringify({ escrowId: escrow.id }),
      },
    });
    return e;
  });

  return c.json(updatedEscrow);
});
