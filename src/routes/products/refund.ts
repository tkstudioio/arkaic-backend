import { Hono } from "hono";
import { prisma } from "../../lib/prisma.js";
import {
  buildOffchainTx,
  CSVMultisigTapscript,
  DefaultVtxo,
  Transaction,
  VirtualCoin,
} from "@arkade-os/sdk";
import { arkProvider, indexerProvider } from "../../lib/ark.js";
import { base64, hex } from "@scure/base";
import { buildEscrowContext } from "../../lib/escrow.js";

export const refund = new Hono();

// Build the unsigned refund PSBT for the buyer to sign.
refund.get("/psbt", async (c) => {
  const id = c.req.param("id");

  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
  });

  if (!product) return c.json({ error: "Product not found" }, 404);

  if (!product.timelockExpiry || !product.buyerPubkey) {
    return c.json({ error: "Escrow not configured" }, 400);
  }

  const info = await arkProvider.getInfo();

  const { escrowScript, refundPath, buyerPubkey, serverPubkey } =
    await buildEscrowContext(
      product.buyerPubkey,
      product.sellerPubkey,
      product.timelockExpiry,
    );

  const serverUnrollScript = CSVMultisigTapscript.decode(
    hex.decode(info.checkpointTapscript),
  );

  // Build recipient script using DefaultVtxo (forfeit + exit paths)
  const recipientScript = new DefaultVtxo.Script({
    pubKey: buyerPubkey,
    serverPubKey: serverPubkey,
    csvTimelock: { type: "seconds" as const, value: info.unilateralExitDelay },
  });

  // Find spendable VTXOs at the escrow address
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

// Buyer sends signed PSBT. Server submits and returns checkpoint txs for buyer to co-sign.
refund.post("/submit-signed-psbt", async (c) => {
  const id = c.req.param("id");
  const { signedPsbt } = await c.req.json();

  if (!signedPsbt) {
    return c.json({ error: "signedPsbt is required" }, 400);
  }

  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
  });

  if (!product) return c.json({ error: "Product not found" }, 404);

  if (!product.timelockExpiry || !product.buyerPubkey) {
    return c.json({ error: "Escrow not configured" }, 400);
  }

  const info = await arkProvider.getInfo();

  const { escrowScript, refundPath, buyerPubkey, serverPubkey } =
    await buildEscrowContext(
      product.buyerPubkey,
      product.sellerPubkey,
      product.timelockExpiry,
    );

  const serverUnrollScript = CSVMultisigTapscript.decode(
    hex.decode(info.checkpointTapscript),
  );

  // Build recipient script using DefaultVtxo (forfeit + exit paths)
  const recipientScript = new DefaultVtxo.Script({
    pubKey: buyerPubkey,
    serverPubKey: serverPubkey,
    csvTimelock: { type: "seconds" as const, value: info.unilateralExitDelay },
  });

  // Find spendable VTXOs at the escrow address
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

  // Submit buyer-signed PSBT to Ark (server co-signs)
  const { arkTxid, signedCheckpointTxs } = await arkProvider.submitTx(
    signedPsbt,
    checkpointPsbts.map((cp: Uint8Array) => base64.encode(cp)),
  );

  await prisma.productEvent.create({
    data: {
      productId: product.id,
      action: "refund_submitted",
      metadata: JSON.stringify({ arkTxid }),
    },
  });

  console.log("=== REFUND SUBMITTED ===");
  console.log("Product ID:", product.id);
  console.log("Ark TX ID:", arkTxid);
  console.log("========================");

  return c.json({
    arkTxid,
    signedCheckpointTxs,
    nextStep:
      "Sign checkpoint txs with buyer key and call POST /products/finalize-refund",
  });
});

// Buyer sends buyer-signed checkpoints to finalize the refund.
refund.post("/finalize", async (c) => {
  const id = c.req.param("id");
  const { arkTxid, signedCheckpointTxs } = await c.req.json();

  if (!arkTxid || !signedCheckpointTxs) {
    return c.json(
      { error: "arkTxid and signedCheckpointTxs are required" },
      400,
    );
  }

  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
  });

  if (!product) return c.json({ error: "Product not found" }, 404);

  if (product.status === "refunded") {
    return c.json({ error: "Already refunded" }, 400);
  }

  await arkProvider.finalizeTx(arkTxid, signedCheckpointTxs);

  console.log("=== REFUND FINALIZED ===");
  console.log("Product ID:", product.id);
  console.log("Ark TX ID:", arkTxid);
  console.log("========================");

  await prisma.$transaction(async (tx) => {
    await tx.products.update({
      where: { id: product.id },
      data: { status: "refunded" },
    });
    await tx.productEvent.create({
      data: {
        productId: product.id,
        action: "refund_finalized",
        metadata: JSON.stringify({ arkTxid }),
      },
    });
  });

  return c.json({ success: true, arkTxid });
});
