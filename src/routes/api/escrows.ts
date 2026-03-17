import { Hono } from "hono";
import { type AuthEnv, bearerAuth, verifySignature } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildEscrowContext, buildEscrowTransaction } from "@/lib/escrow";
import { createSystemMessage } from "@/lib/system-messages";
import { sendToUser } from "@/routes/ws";
import { arkProvider, indexerProvider } from "@/lib/ark";
import { hex } from "@scure/base";
import { VirtualCoin } from "@arkade-os/sdk";
import { sValidator } from "@hono/standard-validator";
import z from "zod";

export const escrows = new Hono<AuthEnv>();

escrows.use(bearerAuth);

function notifyEscrowUpdate(escrow: {
  buyerPubkey: string;
  sellerPubkey: string;
  address: string;
}) {
  const notification = { type: "escrow_update", address: escrow.address };
  sendToUser(escrow.buyerPubkey, notification);
  sendToUser(escrow.sellerPubkey, notification);
}

// GET /:chatId - Get a chat's escrow
escrows.get("/:chatId", async (c) => {
  const pubkey = c.get("pubkey");
  const chatId = Number(c.req.param("chatId"));

  const escrow = await prisma.escrow.findFirst({
    where: {
      chatId,
      OR: [{ buyerPubkey: pubkey }, { sellerPubkey: pubkey }],
    },
  });

  if (!escrow) return c.json({ error: "Escrow not found" }, 404);
  return c.json(escrow);
});

// POST /:chatId — Create escrow after accepted offer
escrows.post(
  "/:chatId",
  verifySignature,
  sValidator(
    "json",
    z.object({
      chatId: z.number(),
      sellerPubkey: z.string(),
      timelockExpiry: z.number(),
      price: z.number(),
      serverPubkey: z.string(),
      escrowAddress: z.string(),
    }),
  ),
  async (c) => {
    const buyerPubkey = c.get("pubkey");
    const chatId = Number(c.req.param("chatId"));
    const escrow = c.req.valid("json");

    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        OR: [
          {
            buyerPubkey,
          },
        ],
      },
      include: { listing: true },
    });

    if (!chat) return c.json({ error: "Chat not found" }, 404);

    if (chat.buyerPubkey !== buyerPubkey) {
      return c.json({ error: "Only the buyer can create an escrow" }, 403);
    }

    // Find the accepted offer in this chat
    const offer = await prisma.offer.findFirst({
      where: {
        message: { chatId },
        valid: true,
        acceptance: { accepted: true },
      },
      include: { acceptance: true },
    });

    let price: number | undefined;

    if (offer) {
      price = offer.price;
    } else {
      price = chat.listing.price;
    }

    const sellerPubkey = chat.listing.sellerPubkey;
    const { escrowScript, serverPubkey } = await buildEscrowContext(
      buyerPubkey,
      sellerPubkey,
      escrow.timelockExpiry,
    );

    const address = escrowScript.address("tark", serverPubkey).encode();

    const newEscrowValues = {
      address,
      buyerPubkey,
      sellerPubkey,
      serverPubkey: hex.encode(serverPubkey),
      arbiterPubkey: chat.arbiterPubkey,
      price,
      timelockExpiry: escrow.timelockExpiry,
      chatId,
      offerId: offer?.id,
    };

    const newEscrow = await prisma.$transaction(async (tx) => {
      const esc = await tx.escrow.upsert({
        where: { chatId: chat.id },
        update: newEscrowValues,
        create: newEscrowValues,
      });

      await createSystemMessage(
        tx,
        chatId,
        `Escrow created at address ${address}`,
        [buyerPubkey, sellerPubkey],
      );

      return esc;
    });

    notifyEscrowUpdate(newEscrow);

    return c.json(newEscrow, 201);
  },
);

// GET /address/:address — Escrow detail
// NOTE: This endpoint has side effects — it queries the Ark indexer and updates escrow state if funding changes.
escrows.get("/address/:address", async (c) => {
  const pubkey = c.get("pubkey");
  const address = c.req.param("address");

  const escrow = await prisma.escrow.findFirst({
    where: {
      address,
      OR: [{ buyerPubkey: pubkey }, { sellerPubkey: pubkey }],
    },
  });

  if (!escrow) return c.text("Escrow not found", 404);

  try {
    const { escrowScript } = await buildEscrowContext(
      escrow.buyerPubkey,
      escrow.sellerPubkey,
      escrow.timelockExpiry,
    );

    const { vtxos } = await indexerProvider.getVtxos({
      scripts: [hex.encode(escrowScript.pkScript)],
    });

    const total = (vtxos as VirtualCoin[]).reduce(
      (acc, vtxo) => acc + vtxo.value,
      0,
    );

    if (total > 0 && total < escrow.price) {
      try {
        const updatedEscrow = await prisma.$transaction(async (tx) => {
          const esc = await tx.escrow.update({
            where: { address, status: "awaitingFunds" },
            data: { status: "partiallyFunded" },
          });
          await createSystemMessage(
            tx,
            escrow.chatId,
            `Escrow partially funded (${total} of ${escrow.price} sats)`,
            [escrow.buyerPubkey, escrow.sellerPubkey],
          );
          return esc;
        });
        return c.json(updatedEscrow);
      } catch {
        return c.json(escrow);
      }
    }

    if (total >= escrow.price) {
      try {
        const updatedEscrow = await prisma.$transaction(async (tx) => {
          const esc = await tx.escrow.update({
            where: {
              address,
              status: { in: ["awaitingFunds", "partiallyFunded"] },
            },
            data: { status: "fundLocked" },
          });
          await createSystemMessage(
            tx,
            escrow.chatId,
            "Escrow fully funded. Funds are now locked.",
            [escrow.buyerPubkey, escrow.sellerPubkey],
          );
          return esc;
        });
        return c.json(updatedEscrow);
      } catch {
        return c.json(escrow);
      }
    }
  } catch (e) {
    return c.json({ error: "Failed to check escrow funding" }, 502);
  }

  return c.json(escrow);
});

// === Collaborative path ===

// GET /:address/collaborate/seller-psbt
escrows.get("/address/:address/collaborate/seller-psbt", async (c) => {
  const pubkey = c.get("pubkey");
  const address = c.req.param("address");

  const escrow = await prisma.escrow.findUnique({ where: { address } });
  if (!escrow) return c.json({ error: "Escrow not found" }, 404);
  if (escrow.sellerPubkey !== pubkey)
    return c.json({ error: "Forbidden" }, 403);

  if (escrow.status !== "fundLocked") {
    return c.json(
      { error: `Cannot build PSBT in ${escrow.status} status` },
      400,
    );
  }

  try {
    const result = await buildEscrowTransaction(escrow, "collaborative");
    if (result.error) return c.json({ error: result.error }, 400);

    return c.json({
      collaboratePsbt: result.psbt,
      recipientAddress: result.recipientAddress,
    });
  } catch (e) {
    return c.json({ error: "Failed to build collaborative PSBT" }, 502);
  }
});

// POST /:address/collaborate/seller-submit-psbt
escrows.post(
  "/address/:address/collaborate/seller-submit-psbt",
  sValidator("json", z.object({ signedPsbt: z.string() })),
  async (c) => {
    const pubkey = c.get("pubkey");
    const address = c.req.param("address");
    const { signedPsbt } = c.req.valid("json");

    const escrow = await prisma.escrow.findUnique({ where: { address } });
    if (!escrow) return c.json({ error: "Escrow not found" }, 404);
    if (escrow.sellerPubkey !== pubkey)
      return c.json({ error: "Forbidden" }, 403);

    await prisma.$transaction(async (tx) => {
      await tx.escrow.update({
        where: { address },
        data: {
          sellerSignedCollabPsbt: signedPsbt,
          status: "sellerReady",
        },
      });

      await createSystemMessage(
        tx,
        escrow.chatId,
        "Escrow status: seller ready",
        [escrow.buyerPubkey, escrow.sellerPubkey],
      );
    });

    notifyEscrowUpdate(escrow);

    return c.json({ success: true });
  },
);

// GET /:address/collaborate/buyer-psbt
escrows.get("/address/:address/collaborate/buyer-psbt", async (c) => {
  const pubkey = c.get("pubkey");
  const address = c.req.param("address");

  const escrow = await prisma.escrow.findUnique({ where: { address } });
  if (!escrow) return c.json({ error: "Escrow not found" }, 404);
  if (escrow.buyerPubkey !== pubkey) return c.json({ error: "Forbidden" }, 403);

  if (escrow.status !== "sellerReady" || !escrow.sellerSignedCollabPsbt) {
    return c.json({ status: escrow.status, collaboratePsbt: null });
  }

  return c.json({
    status: "sellerReady",
    collaboratePsbt: escrow.sellerSignedCollabPsbt,
  });
});

// POST /:address/collaborate/buyer-submit-psbt
escrows.post(
  "/address/:address/collaborate/buyer-submit-psbt",
  sValidator("json", z.object({ signedPsbt: z.string() })),
  async (c) => {
    const pubkey = c.get("pubkey");
    const address = c.req.param("address");
    const { signedPsbt } = c.req.valid("json");

    const escrow = await prisma.escrow.findUnique({ where: { address } });
    if (!escrow) return c.json({ error: "Escrow not found" }, 404);
    if (escrow.buyerPubkey !== pubkey)
      return c.json({ error: "Forbidden" }, 403);

    if (escrow.status !== "sellerReady") {
      return c.json({ error: "Seller has not signed yet" }, 400);
    }

    try {
      const result = await buildEscrowTransaction(escrow, "collaborative");
      if (result.error) return c.json({ error: result.error }, 400);

      const { arkTxid, signedCheckpointTxs } = await arkProvider.submitTx(
        signedPsbt,
        result.checkpointPsbts,
      );

      await prisma.$transaction(async (tx) => {
        const esc = await tx.escrow.update({
          where: { address },
          data: {
            collabArkTxid: arkTxid,
            serverSignedCheckpoints: JSON.stringify(signedCheckpointTxs),
            status: "buyerSubmitted",
          },
        });

        await createSystemMessage(
          tx,
          escrow.chatId,
          "Escrow status: buyer submitted",
          [escrow.buyerPubkey, escrow.sellerPubkey],
        );

        return esc;
      });

      notifyEscrowUpdate(escrow);

      return c.json({ arkTxid, signedCheckpointTxs });
    } catch (e) {
      return c.json({ error: "Failed to submit transaction" }, 502);
    }
  },
);

// POST /:address/collaborate/buyer-sign-checkpoints
escrows.post(
  "/address/:address/collaborate/buyer-sign-checkpoints",
  sValidator("json", z.object({ signedCheckpointTxs: z.array(z.string()) })),
  async (c) => {
    const pubkey = c.get("pubkey");
    const address = c.req.param("address");
    const { signedCheckpointTxs } = c.req.valid("json");

    const escrow = await prisma.escrow.findUnique({ where: { address } });
    if (!escrow) return c.json({ error: "Escrow not found" }, 404);
    if (escrow.buyerPubkey !== pubkey)
      return c.json({ error: "Forbidden" }, 403);

    if (escrow.status !== "buyerSubmitted") {
      return c.json({ error: "Transaction not submitted yet" }, 400);
    }

    await prisma.$transaction(async (tx) => {
      await tx.escrow.update({
        where: { address },
        data: {
          buyerSignedCheckpoints: JSON.stringify(signedCheckpointTxs),
          status: "buyerCheckpointsSigned",
        },
      });

      await createSystemMessage(
        tx,
        escrow.chatId,
        "Escrow status: buyer checkpoints signed",
        [escrow.buyerPubkey, escrow.sellerPubkey],
      );
    });

    notifyEscrowUpdate(escrow);

    return c.json({ success: true });
  },
);

// GET /:address/collaborate/seller-checkpoints
escrows.get("/address/:address/collaborate/seller-checkpoints", async (c) => {
  const pubkey = c.get("pubkey");
  const address = c.req.param("address");

  const escrow = await prisma.escrow.findUnique({ where: { address } });
  if (!escrow) return c.json({ error: "Escrow not found" }, 404);
  if (escrow.sellerPubkey !== pubkey)
    return c.json({ error: "Forbidden" }, 403);

  if (!escrow.collabArkTxid || !escrow.buyerSignedCheckpoints) {
    return c.json({ status: escrow.status, checkpointTxs: null });
  }

  return c.json({
    status: escrow.status,
    arkTxid: escrow.collabArkTxid,
    checkpointTxs: JSON.parse(escrow.buyerSignedCheckpoints),
  });
});

// POST /:address/collaborate/seller-sign-checkpoints
escrows.post(
  "/address/:address/collaborate/seller-sign-checkpoints",
  sValidator("json", z.object({ signedCheckpointTxs: z.array(z.string()) })),
  async (c) => {
    const pubkey = c.get("pubkey");
    const address = c.req.param("address");
    const { signedCheckpointTxs } = c.req.valid("json");

    const escrow = await prisma.escrow.findUnique({ where: { address } });
    if (!escrow) return c.json({ error: "Escrow not found" }, 404);
    if (escrow.sellerPubkey !== pubkey)
      return c.json({ error: "Forbidden" }, 403);

    if (escrow.status !== "buyerCheckpointsSigned") {
      return c.json({ error: "Buyer has not signed checkpoints yet" }, 400);
    }

    try {
      await arkProvider.finalizeTx(escrow.collabArkTxid!, signedCheckpointTxs);
    } catch (e) {
      return c.json({ error: "Failed to finalize transaction" }, 502);
    }

    await prisma.$transaction(async (tx) => {
      await tx.escrow.update({
        where: { address },
        data: { status: "completed", releasedAt: new Date() },
      });
      await tx.chat.update({
        where: { id: escrow.chatId },
        data: { status: "closed" },
      });
      await createSystemMessage(
        tx,
        escrow.chatId,
        "Escrow completed. Funds released to seller.",
        [escrow.buyerPubkey, escrow.sellerPubkey],
      );
    });

    notifyEscrowUpdate(escrow);

    return c.json({ success: true, arkTxid: escrow.collabArkTxid });
  },
);

// === Refund path ===

// GET /:address/refund/psbt
escrows.get("/address/:address/refund/psbt", async (c) => {
  const pubkey = c.get("pubkey");
  const address = c.req.param("address");

  const escrow = await prisma.escrow.findUnique({ where: { address } });
  if (!escrow) return c.json({ error: "Escrow not found" }, 404);
  if (escrow.buyerPubkey !== pubkey) return c.json({ error: "Forbidden" }, 403);

  try {
    const result = await buildEscrowTransaction(escrow, "refund");
    if (result.error) return c.json({ error: result.error }, 400);

    return c.json({
      refundPsbt: result.psbt,
      recipientAddress: result.recipientAddress,
    });
  } catch (e) {
    return c.json({ error: "Failed to build refund PSBT" }, 502);
  }
});

// POST /:address/refund/submit-signed-psbt
escrows.post(
  "/address/:address/refund/submit-signed-psbt",
  sValidator("json", z.object({ signedPsbt: z.string() })),
  async (c) => {
    const pubkey = c.get("pubkey");
    const address = c.req.param("address");
    const { signedPsbt } = c.req.valid("json");

    const escrow = await prisma.escrow.findUnique({ where: { address } });
    if (!escrow) return c.json({ error: "Escrow not found" }, 404);
    if (escrow.buyerPubkey !== pubkey)
      return c.json({ error: "Forbidden" }, 403);

    try {
      const result = await buildEscrowTransaction(escrow, "refund");
      if (result.error) return c.json({ error: result.error }, 400);

      const { arkTxid, signedCheckpointTxs } = await arkProvider.submitTx(
        signedPsbt,
        result.checkpointPsbts,
      );

      return c.json({ arkTxid, signedCheckpointTxs });
    } catch (e) {
      return c.json({ error: "Failed to submit transaction" }, 502);
    }
  },
);

// POST /address/:address/refund/finalize
escrows.post(
  "/address/:address/refund/finalize",
  sValidator(
    "json",
    z.object({
      arkTxid: z.string(),
      signedCheckpointTxs: z.array(z.string()),
    }),
  ),
  async (c) => {
    const pubkey = c.get("pubkey");
    const address = c.req.param("address");
    const { arkTxid, signedCheckpointTxs } = c.req.valid("json");

    const escrow = await prisma.escrow.findUnique({ where: { address } });
    if (!escrow) return c.json({ error: "Escrow not found" }, 404);
    if (escrow.buyerPubkey !== pubkey)
      return c.json({ error: "Forbidden" }, 403);

    // Allow refund if funds are locked, partially funded, or seller signed but disappeared
    const refundableStatuses = ["fundLocked", "partiallyFunded", "sellerReady"];
    if (!refundableStatuses.includes(escrow.status)) {
      return c.json(
        { error: `Cannot refund escrow in ${escrow.status} status` },
        400,
      );
    }

    try {
      await arkProvider.finalizeTx(arkTxid, signedCheckpointTxs);
    } catch (e) {
      return c.json({ error: "Failed to finalize transaction" }, 502);
    }

    await prisma.$transaction(async (tx) => {
      await tx.escrow.update({
        where: { address },
        data: { status: "refunded" },
      });
      await tx.chat.update({
        where: { id: escrow.chatId },
        data: { status: "closed" },
      });
      await createSystemMessage(
        tx,
        escrow.chatId,
        "Escrow refunded. Funds returned to buyer.",
        [escrow.buyerPubkey, escrow.sellerPubkey],
      );
    });

    notifyEscrowUpdate(escrow);

    return c.json({ success: true, arkTxid });
  },
);
