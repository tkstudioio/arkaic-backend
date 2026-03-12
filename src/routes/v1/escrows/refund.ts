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

export const refund = new Hono();

refund.get("/psbt", async (c) => {
  const escrowId = Number(c.req.param("escrowId"));

  const escrow = await prisma.escrow.findUnique({
    where: { id: escrowId },
    include: { buyer: true, seller: true },
  });

  if (!escrow) return c.json({ error: "Escrow not found" }, 404);

  const info = await arkProvider.getInfo();

  const { escrowScript, refundPath, buyerPubkey, serverPubkey } =
    await buildEscrowContext(
      escrow.buyer.pubkey,
      escrow.seller.pubkey,
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
    value: BigInt(vtxo.value),
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

refund.post("/submit-signed-psbt", async (c) => {
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

  const info = await arkProvider.getInfo();

  const { escrowScript, refundPath, buyerPubkey, serverPubkey } =
    await buildEscrowContext(
      escrow.buyer.pubkey,
      escrow.seller.pubkey,
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
    value: BigInt(vtxo.value),
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

  const { arkTxid, signedCheckpointTxs } = await arkProvider.submitTx(
    signedPsbt,
    checkpointPsbts.map((cp: Uint8Array) => base64.encode(cp)),
  );

  await prisma.productEvent.create({
    data: {
      productId: escrow.chat.productId,
      action: "refund_submitted",
      metadata: JSON.stringify({ arkTxid, escrowId: escrow.id }),
    },
  });

  console.log("=== REFUND SUBMITTED ===");
  console.log("Escrow ID:", escrow.id);
  console.log("Ark TX ID:", arkTxid);
  console.log("========================");

  return c.json({
    arkTxid,
    signedCheckpointTxs,
    nextStep:
      "Sign checkpoint txs with buyer key and call POST /escrows/:escrowId/refund/finalize",
  });
});

refund.post("/finalize", async (c) => {
  const escrowId = Number(c.req.param("escrowId"));
  const { arkTxid, signedCheckpointTxs } = await c.req.json();

  if (!arkTxid || !signedCheckpointTxs) {
    return c.json(
      { error: "arkTxid and signedCheckpointTxs are required" },
      400,
    );
  }

  const escrow = await prisma.escrow.findUnique({
    where: { id: escrowId },
    include: { chat: true },
  });

  if (!escrow) return c.json({ error: "Escrow not found" }, 404);

  if (escrow.status === "refunded") {
    return c.json({ error: "Already refunded" }, 400);
  }

  await arkProvider.finalizeTx(arkTxid, signedCheckpointTxs);

  console.log("=== REFUND FINALIZED ===");
  console.log("Escrow ID:", escrow.id);
  console.log("Ark TX ID:", arkTxid);
  console.log("========================");

  await prisma.$transaction(async (tx) => {
    await tx.escrow.update({
      where: { id: escrow.id },
      data: { status: "refunded" },
    });
    await tx.productEvent.create({
      data: {
        productId: escrow.chat.productId,
        action: "refund_finalized",
        metadata: JSON.stringify({ arkTxid, escrowId: escrow.id }),
      },
    });
  });

  return c.json({ success: true, arkTxid });
});
