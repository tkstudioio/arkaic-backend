import { Hono } from "hono";
import { type AuthEnv, bearerAuth, verifySignature } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildEscrowContext } from "@/lib/escrow";
import { arkProvider, indexerProvider } from "@/lib/ark";
import { hex, base64 } from "@scure/base";
import {
  buildOffchainTx,
  CSVMultisigTapscript,
  DefaultVtxo,
  Transaction,
  VirtualCoin,
} from "@arkade-os/sdk";
import { sValidator } from "@hono/standard-validator";
import z from "zod";
import _ from "lodash";

export const escrows = new Hono<AuthEnv>();

escrows.use(bearerAuth);

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

    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
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

    const newEscrow = await prisma.escrow.upsert({
      where: { chatId: chat.id },
      update: newEscrowValues,
      create: newEscrowValues,
    });

    return c.json(newEscrow, 201);
  },
);

// GET /address/:address — Escrow detail
// NOTE: This endpoint has side effects — it queries the Ark indexer and updates escrow state if funding changes.
// This is intentional for real-time tracking but violates REST principles. Consider this when caching or polling.
escrows.get("/address/:address", async (c) => {
  const pubkey = c.get("pubkey");
  const address = c.req.param("address");

  const escrow = await prisma.escrow.findFirst({
    where: {
      address,
      OR: [
        {
          buyerPubkey: pubkey,
        },
        {
          sellerPubkey: pubkey,
        },
      ],
    },
  });

  if (!escrow) return c.text("Escrow not found", 404);

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
    await prisma.escrow.updateMany({
      where: { address, status: "awaitingFunds" },
      data: { status: "partiallyFunded" },
    });

    const updatedEscrow = await prisma.escrow.findFirst({ where: { address } });
    return c.json(updatedEscrow);
  }

  if (total >= escrow.price) {
    await prisma.escrow.updateMany({
      where: {
        address,
        OR: [
          {
            status: "awaitingFunds",
          },

          {
            status: "partiallyFunded",
          },
        ],
      },
      data: { status: "fundLocked" },
    });
    const updatedEscrow = await prisma.escrow.findFirst({ where: { address } });
    return c.json(updatedEscrow);
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

  const info = await arkProvider.getInfo();

  const { escrowScript, collaborativePath, sellerPubkey, serverPubkey } =
    await buildEscrowContext(
      escrow.buyerPubkey,
      escrow.sellerPubkey,
      escrow.timelockExpiry,
    );

  const serverUnrollScript = CSVMultisigTapscript.decode(
    hex.decode(info.checkpointTapscript),
  );

  const recipientScript = new DefaultVtxo.Script({
    pubKey: sellerPubkey,
    serverPubKey: serverPubkey,
    csvTimelock: { type: "seconds" as const, value: info.unilateralExitDelay },
  });

  const { vtxos } = await indexerProvider.getVtxos({
    scripts: [hex.encode(escrowScript.pkScript)],
    spendableOnly: true,
  });

  if (vtxos.length === 0) {
    return c.json({ error: "No spendable VTXOs found" }, 400);
  }

  const inputs = vtxos.map((vtxo: VirtualCoin) => ({
    txid: vtxo.txid,
    vout: vtxo.vout,
    value: vtxo.value,
    tapLeafScript: escrowScript.findLeaf(hex.encode(collaborativePath)),
    tapTree: escrowScript.encode(),
  }));

  const totalValue = vtxos.reduce(
    (sum: bigint, vtxo: VirtualCoin) => sum + BigInt(vtxo.value),
    0n,
  );

  const outputs = [
    {
      amount: totalValue,
      script: recipientScript.pkScript,
    },
  ];

  const { arkTx } = buildOffchainTx(inputs, outputs, serverUnrollScript);
  const collaboratePsbt = base64.encode(arkTx.toPSBT());

  const recipientAddress = recipientScript
    .address("tark", serverPubkey)
    .encode();

  return c.json({ collaboratePsbt, recipientAddress });
});

// POST /:address/collaborate/seller-submit-psbt
escrows.post("/address/:address/collaborate/seller-submit-psbt", async (c) => {
  const pubkey = c.get("pubkey");
  const address = c.req.param("address");
  const { signedPsbt } = await c.req.json();

  if (!signedPsbt) return c.json({ error: "signedPsbt is required" }, 400);

  const escrow = await prisma.escrow.findUnique({ where: { address } });
  if (!escrow) return c.json({ error: "Escrow not found" }, 404);
  if (escrow.sellerPubkey !== pubkey)
    return c.json({ error: "Forbidden" }, 403);

  await prisma.escrow.update({
    where: { address },
    data: {
      sellerSignedCollabPsbt: signedPsbt,
      status: "sellerReady",
    },
  });

  return c.json({ success: true });
});

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
escrows.post("/address/:address/collaborate/buyer-submit-psbt", async (c) => {
  const pubkey = c.get("pubkey");
  const address = c.req.param("address");
  const { signedPsbt } = await c.req.json();

  if (!signedPsbt) return c.json({ error: "signedPsbt is required" }, 400);

  const escrow = await prisma.escrow.findUnique({ where: { address } });
  if (!escrow) return c.json({ error: "Escrow not found" }, 404);
  if (escrow.buyerPubkey !== pubkey) return c.json({ error: "Forbidden" }, 403);

  if (escrow.status !== "sellerReady") {
    return c.json({ error: "Seller has not signed yet" }, 400);
  }

  const info = await arkProvider.getInfo();

  const { escrowScript, collaborativePath, sellerPubkey, serverPubkey } =
    await buildEscrowContext(
      escrow.buyerPubkey,
      escrow.sellerPubkey,
      escrow.timelockExpiry,
    );

  const serverUnrollScript = CSVMultisigTapscript.decode(
    hex.decode(info.checkpointTapscript),
  );

  const recipientScript = new DefaultVtxo.Script({
    pubKey: sellerPubkey,
    serverPubKey: serverPubkey,
    csvTimelock: { type: "seconds" as const, value: info.unilateralExitDelay },
  });

  const { vtxos } = await indexerProvider.getVtxos({
    scripts: [hex.encode(escrowScript.pkScript)],
    spendableOnly: true,
  });

  if (vtxos.length === 0) {
    return c.json({ error: "No spendable VTXOs found" }, 400);
  }

  const inputs = vtxos.map((vtxo: VirtualCoin) => ({
    txid: vtxo.txid,
    vout: vtxo.vout,
    value: vtxo.value,
    tapLeafScript: escrowScript.findLeaf(hex.encode(collaborativePath)),
    tapTree: escrowScript.encode(),
  }));

  const totalValue = vtxos.reduce(
    (sum: bigint, vtxo: VirtualCoin) => sum + BigInt(vtxo.value),
    0n,
  );

  const outputs = [
    {
      amount: totalValue,
      script: recipientScript.pkScript,
    },
  ];

  const { checkpoints } = buildOffchainTx(inputs, outputs, serverUnrollScript);
  const checkpointPsbts = checkpoints.map((cp: Transaction) => cp.toPSBT());

  const { arkTxid, signedCheckpointTxs } = await arkProvider.submitTx(
    signedPsbt,
    checkpointPsbts.map((cp: Uint8Array) => base64.encode(cp)),
  );

  await prisma.escrow.update({
    where: { address },
    data: {
      collabArkTxid: arkTxid,
      serverSignedCheckpoints: JSON.stringify(signedCheckpointTxs),
      status: "buyerSubmitted",
    },
  });

  return c.json({ arkTxid, signedCheckpointTxs });
});

// POST /:address/collaborate/buyer-sign-checkpoints
escrows.post(
  "/address/:address/collaborate/buyer-sign-checkpoints",
  async (c) => {
    const pubkey = c.get("pubkey");
    const address = c.req.param("address");
    const { signedCheckpointTxs } = await c.req.json();

    if (!signedCheckpointTxs) {
      return c.json({ error: "signedCheckpointTxs is required" }, 400);
    }

    const escrow = await prisma.escrow.findUnique({ where: { address } });
    if (!escrow) return c.json({ error: "Escrow not found" }, 404);
    if (escrow.buyerPubkey !== pubkey)
      return c.json({ error: "Forbidden" }, 403);

    if (!escrow.collabArkTxid) {
      return c.json({ error: "Collaborate not submitted yet" }, 400);
    }

    await prisma.escrow.update({
      where: { address },
      data: {
        buyerSignedCheckpoints: JSON.stringify(signedCheckpointTxs),
        status: "buyerCheckpointsSigned",
      },
    });

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
  async (c) => {
    const pubkey = c.get("pubkey");
    const address = c.req.param("address");
    const { signedCheckpointTxs } = await c.req.json();

    if (!signedCheckpointTxs) {
      return c.json({ error: "signedCheckpointTxs is required" }, 400);
    }

    const escrow = await prisma.escrow.findUnique({ where: { address } });
    if (!escrow) return c.json({ error: "Escrow not found" }, 404);
    if (escrow.sellerPubkey !== pubkey)
      return c.json({ error: "Forbidden" }, 403);

    if (!escrow.collabArkTxid) {
      return c.json({ error: "Collaborate not submitted yet" }, 400);
    }

    await arkProvider.finalizeTx(escrow.collabArkTxid, signedCheckpointTxs);

    await prisma.$transaction(async (tx) => {
      await tx.escrow.update({
        where: { address },
        data: { status: "completed", releasedAt: new Date() },
      });
      await tx.chat.update({
        where: { id: escrow.chatId },
        data: { status: "closed" },
      });
    });

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

  const info = await arkProvider.getInfo();

  const { escrowScript, refundPath, buyerPubkey, serverPubkey } =
    await buildEscrowContext(
      escrow.buyerPubkey,
      escrow.sellerPubkey,
      escrow.timelockExpiry,
    );

  const serverUnrollScript = CSVMultisigTapscript.decode(
    hex.decode(info.checkpointTapscript),
  );

  const recipientScript = new DefaultVtxo.Script({
    pubKey: buyerPubkey,
    serverPubKey: serverPubkey,
    csvTimelock: { type: "seconds" as const, value: info.unilateralExitDelay },
  });

  const { vtxos } = await indexerProvider.getVtxos({
    scripts: [hex.encode(escrowScript.pkScript)],
    spendableOnly: true,
  });

  if (vtxos.length === 0) {
    return c.json({ error: "No refundable VTXOs found" }, 400);
  }

  const inputs = vtxos.map((vtxo: VirtualCoin) => ({
    txid: vtxo.txid,
    vout: vtxo.vout,
    value: vtxo.value,
    tapLeafScript: escrowScript.findLeaf(hex.encode(refundPath)),
    tapTree: escrowScript.encode(),
  }));

  const totalValue = vtxos.reduce(
    (sum: bigint, vtxo: VirtualCoin) => sum + BigInt(vtxo.value),
    0n,
  );

  const outputs = [
    {
      amount: totalValue,
      script: recipientScript.pkScript,
    },
  ];

  const { arkTx } = buildOffchainTx(inputs, outputs, serverUnrollScript);
  const refundPsbt = base64.encode(arkTx.toPSBT());

  const recipientAddress = recipientScript
    .address("tark", serverPubkey)
    .encode();

  return c.json({ refundPsbt, recipientAddress });
});

// POST /:address/refund/submit-signed-psbt
escrows.post("/address/:address/refund/submit-signed-psbt", async (c) => {
  const pubkey = c.get("pubkey");
  const address = c.req.param("address");
  const { signedPsbt } = await c.req.json();

  if (!signedPsbt) return c.json({ error: "signedPsbt is required" }, 400);

  const escrow = await prisma.escrow.findUnique({ where: { address } });
  if (!escrow) return c.json({ error: "Escrow not found" }, 404);
  if (escrow.buyerPubkey !== pubkey) return c.json({ error: "Forbidden" }, 403);

  const info = await arkProvider.getInfo();

  const { escrowScript, refundPath, buyerPubkey, serverPubkey } =
    await buildEscrowContext(
      escrow.buyerPubkey,
      escrow.sellerPubkey,
      escrow.timelockExpiry,
    );

  const serverUnrollScript = CSVMultisigTapscript.decode(
    hex.decode(info.checkpointTapscript),
  );

  const recipientScript = new DefaultVtxo.Script({
    pubKey: buyerPubkey,
    serverPubKey: serverPubkey,
    csvTimelock: { type: "seconds" as const, value: info.unilateralExitDelay },
  });

  const { vtxos } = await indexerProvider.getVtxos({
    scripts: [hex.encode(escrowScript.pkScript)],
    spendableOnly: true,
  });

  if (vtxos.length === 0) {
    return c.json({ error: "No spendable VTXOs found" }, 400);
  }

  const inputs = vtxos.map((vtxo: VirtualCoin) => ({
    txid: vtxo.txid,
    vout: vtxo.vout,
    value: vtxo.value,
    tapLeafScript: escrowScript.findLeaf(hex.encode(refundPath)),
    tapTree: escrowScript.encode(),
  }));

  const totalValue = vtxos.reduce(
    (sum: bigint, vtxo: VirtualCoin) => sum + BigInt(vtxo.value),
    0n,
  );

  const outputs = [
    {
      amount: totalValue,
      script: recipientScript.pkScript,
    },
  ];

  const { checkpoints } = buildOffchainTx(inputs, outputs, serverUnrollScript);
  const checkpointPsbts = checkpoints.map((cp: Transaction) => cp.toPSBT());

  try {
    const { arkTxid, signedCheckpointTxs } = await arkProvider.submitTx(
      signedPsbt,
      checkpointPsbts.map((cp: Uint8Array) => base64.encode(cp)),
    );

    // Update escrow state to reflect transaction submission
    await prisma.escrow.update({
      where: { address },
      data: { status: "buyerSubmitted" },
    });

    return c.json({ arkTxid, signedCheckpointTxs });
  } catch (e) {
    console.log(e);
    return c.json({ error: "Failed to submit transaction" }, 500);
  }
});

// POST /address/:address/refund/finalize
escrows.post("/address/:address/refund/finalize", async (c) => {
  const pubkey = c.get("pubkey");
  const address = c.req.param("address");
  const { arkTxid, signedCheckpointTxs } = await c.req.json();

  if (!arkTxid || !signedCheckpointTxs) {
    return c.json(
      { error: "arkTxid and signedCheckpointTxs are required" },
      400,
    );
  }

  const escrow = await prisma.escrow.findUnique({ where: { address } });
  if (!escrow) return c.json({ error: "Escrow not found" }, 404);
  if (escrow.buyerPubkey !== pubkey) return c.json({ error: "Forbidden" }, 403);

  // Only allow refund if escrow is in fundLocked or partiallyFunded state
  if (escrow.status !== "fundLocked" && escrow.status !== "partiallyFunded") {
    return c.json(
      { error: `Cannot refund escrow in ${escrow.status} status` },
      400,
    );
  }

  try {
    await arkProvider.finalizeTx(arkTxid, signedCheckpointTxs);
  } catch (e) {
    return c.json({ error: "Failed to finalize transaction" }, 500);
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
  });

  return c.json({ success: true, arkTxid });
});
