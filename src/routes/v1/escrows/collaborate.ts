import { Hono } from "hono";
import { prisma } from "@/lib/prisma";
import {
  buildOffchainTx,
  CSVMultisigTapscript,
  DefaultVtxo,
  Transaction,
  VirtualCoin,
} from "@arkade-os/sdk";
import { arkProvider, indexerProvider } from "@/lib/ark";
import { base64, hex } from "@scure/base";
import { buildEscrowContext } from "@/lib/escrow";

export const collaborate = new Hono();

collaborate.get("/seller-psbt", async (c) => {
  const escrowId = Number(c.req.param("escrowId"));

  const escrow = await prisma.escrow.findUnique({
    where: { id: escrowId },
    include: { buyer: true, seller: true },
  });

  if (!escrow) return c.json({ error: "Escrow not found" }, 404);

  const info = await arkProvider.getInfo();

  const { escrowScript, collaborativePath, sellerPubkey, serverPubkey } =
    await buildEscrowContext(
      escrow.buyer.pubkey,
      escrow.seller.pubkey,
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
    value: BigInt(vtxo.value),
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

collaborate.post("/seller-submit-psbt", async (c) => {
  const escrowId = Number(c.req.param("escrowId"));
  const { signedPsbt } = await c.req.json();

  if (!signedPsbt) {
    return c.json({ error: "signedPsbt is required" }, 400);
  }

  const escrow = await prisma.escrow.findUnique({
    where: { id: escrowId },
    include: { chat: true },
  });

  if (!escrow) return c.json({ error: "Escrow not found" }, 404);

  await prisma.$transaction(async (tx) => {
    await tx.escrow.update({
      where: { id: escrow.id },
      data: {
        sellerSignedCollabPsbt: signedPsbt,
        status: "sellerReady",
      },
    });
    await tx.productEvent.create({
      data: {
        productId: escrow.chat.productId,
        action: "seller_signed_psbt",
        metadata: JSON.stringify({ escrowId: escrow.id }),
      },
    });
  });

  return c.json({
    success: true,
    nextStep:
      "Buyer retrieves seller-signed PSBT via GET /escrows/:escrowId/collaborate/buyer-psbt, adds their signature, and calls POST /escrows/:escrowId/collaborate/buyer-submit-psbt",
  });
});

collaborate.get("/buyer-psbt", async (c) => {
  const escrowId = Number(c.req.param("escrowId"));

  const escrow = await prisma.escrow.findUnique({
    where: { id: escrowId },
  });

  if (!escrow) return c.json({ error: "Escrow not found" }, 404);

  if (escrow.status !== "sellerReady" || !escrow.sellerSignedCollabPsbt) {
    return c.json({ status: escrow.status, buyerPsbt: null });
  }

  return c.json({
    status: "sellerReady",
    collaboratePsbt: escrow.sellerSignedCollabPsbt,
  });
});

collaborate.post("/buyer-submit-psbt", async (c) => {
  const escrowId = Number(c.req.param("escrowId"));
  const { signedPsbt } = await c.req.json();

  if (!signedPsbt) {
    return c.json({ error: "signedPsbt is required" }, 400);
  }

  const escrow = await prisma.escrow.findUnique({
    where: { id: escrowId },
    include: { buyer: true, seller: true, chat: true },
  });

  if (!escrow) return c.json({ error: "Escrow not found" }, 404);

  if (escrow.status !== "sellerReady") {
    return c.json({ error: "Seller has not signed yet" }, 400);
  }

  if (!escrow.sellerSignedCollabPsbt) {
    return c.json({ error: "Seller PSBT not found" }, 400);
  }

  const info = await arkProvider.getInfo();

  const { escrowScript, collaborativePath, sellerPubkey, serverPubkey } =
    await buildEscrowContext(
      escrow.buyer.pubkey,
      escrow.seller.pubkey,
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
    value: BigInt(vtxo.value),
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

  await prisma.$transaction(async (tx) => {
    await tx.escrow.update({
      where: { id: escrow.id },
      data: {
        collabArkTxid: arkTxid,
        serverSignedCheckpoints: JSON.stringify(signedCheckpointTxs),
        status: "buyerSubmitted",
      },
    });
    await tx.productEvent.create({
      data: {
        productId: escrow.chat.productId,
        action: "buyer_signed_psbt",
        metadata: JSON.stringify({ arkTxid, escrowId: escrow.id }),
      },
    });
  });

  return c.json({
    arkTxid,
    signedCheckpointTxs,
    nextStep:
      "Buyer signs checkpoint txs and calls POST /escrows/:escrowId/collaborate/buyer-sign-checkpoints",
  });
});

collaborate.post("/buyer-sign-checkpoints", async (c) => {
  const escrowId = Number(c.req.param("escrowId"));
  const { signedCheckpointTxs } = await c.req.json();

  if (!signedCheckpointTxs) {
    return c.json({ error: "signedCheckpointTxs is required" }, 400);
  }

  const escrow = await prisma.escrow.findUnique({
    where: { id: escrowId },
    include: { chat: true },
  });

  if (!escrow) return c.json({ error: "Escrow not found" }, 404);

  if (!escrow.collabArkTxid) {
    return c.json({ error: "Collaborate not submitted yet" }, 400);
  }

  await prisma.$transaction(async (tx) => {
    await tx.escrow.update({
      where: { id: escrow.id },
      data: {
        buyerSignedCheckpoints: JSON.stringify(signedCheckpointTxs),
        status: "buyerCheckpointsSigned",
      },
    });
    await tx.productEvent.create({
      data: {
        productId: escrow.chat.productId,
        action: "buyer_signed_checkpoints",
        metadata: JSON.stringify({ escrowId: escrow.id }),
      },
    });
  });

  console.log("=== BUYER SIGNED CHECKPOINTS ===");
  console.log("Escrow ID:", escrow.id);
  console.log("================================");

  return c.json({
    success: true,
    nextStep:
      "Seller retrieves checkpoints via GET /escrows/:escrowId/collaborate/seller-checkpoints and signs them",
  });
});

collaborate.get("/seller-checkpoints", async (c) => {
  const escrowId = Number(c.req.param("escrowId"));

  const escrow = await prisma.escrow.findUnique({
    where: { id: escrowId },
  });

  if (!escrow) return c.json({ error: "Escrow not found" }, 404);

  if (!escrow.collabArkTxid || !escrow.buyerSignedCheckpoints) {
    return c.json({ status: escrow.status, checkpointTxs: null });
  }

  return c.json({
    status: escrow.status,
    arkTxid: escrow.collabArkTxid,
    checkpointTxs: JSON.parse(escrow.buyerSignedCheckpoints),
  });
});

collaborate.post("/seller-sign-checkpoints", async (c) => {
  const escrowId = Number(c.req.param("escrowId"));
  const { signedCheckpointTxs } = await c.req.json();

  if (!signedCheckpointTxs) {
    return c.json({ error: "signedCheckpointTxs is required" }, 400);
  }

  const escrow = await prisma.escrow.findUnique({
    where: { id: escrowId },
    include: { chat: true },
  });

  if (!escrow) return c.json({ error: "Escrow not found" }, 404);

  if (!escrow.collabArkTxid) {
    return c.json({ error: "Collaborate not submitted yet" }, 400);
  }

  await arkProvider.finalizeTx(escrow.collabArkTxid, signedCheckpointTxs);

  console.log("=== COLLABORATE FINALIZED ===");
  console.log("Escrow ID:", escrow.id);
  console.log("Ark TX ID:", escrow.collabArkTxid);
  console.log("=============================");

  await prisma.$transaction(async (tx) => {
    await tx.escrow.update({
      where: { id: escrow.id },
      data: { status: "completed" },
    });
    await tx.productChat.update({
      where: { id: escrow.chatId },
      data: { status: "concluded" },
    });
    await tx.productEvent.create({
      data: {
        productId: escrow.chat.productId,
        action: "seller_signed_checkpoints",
        metadata: JSON.stringify({ arkTxid: escrow.collabArkTxid, escrowId: escrow.id }),
      },
    });
  });

  return c.json({ success: true, arkTxid: escrow.collabArkTxid });
});
