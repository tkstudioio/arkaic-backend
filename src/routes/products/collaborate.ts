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

export const collaborate = new Hono();

// Build the unsigned collaborative PSBT for the seller to sign.
collaborate.get("/seller-psbt", async (c) => {
  const id = c.req.param("id");

  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
  });

  if (!product) return c.json({ error: "Product not found" }, 404);

  if (!product.timelockExpiry || !product.buyerPubkey) {
    return c.json({ error: "Escrow not configured" }, 400);
  }

  const info = await arkProvider.getInfo();

  const { escrowScript, collaborativePath, sellerPubkey, serverPubkey } =
    await buildEscrowContext(
      product.buyerPubkey,
      product.sellerPubkey,
      product.timelockExpiry,
    );

  const serverUnrollScript = CSVMultisigTapscript.decode(
    hex.decode(info.checkpointTapscript),
  );

  // Recipient is the seller
  const recipientScript = new DefaultVtxo.Script({
    pubKey: sellerPubkey,
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

// Seller sends their signed collaborative PSBT. Backend saves it (does NOT submit yet — needs buyer sig too for 3-of-3).
collaborate.post("/seller-submit-psbt", async (c) => {
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

  await prisma.$transaction(async (tx) => {
    await tx.products.update({
      where: { id: product.id },
      data: {
        sellerSignedCollabPsbt: signedPsbt,
        status: "sellerReady",
      },
    });
    await tx.productEvent.create({
      data: { productId: product.id, action: "seller_signed_psbt" },
    });
  });

  return c.json({
    success: true,
    nextStep:
      "Buyer retrieves seller-signed PSBT via GET /products/:id/collab-status, adds their signature, and calls POST /products/:id/confirm-collaborate",
  });
});

// Buyer checks if the seller is ready and gets the PSBT to sign.
collaborate.get("/buyer-psbt", async (c) => {
  const id = c.req.param("id");

  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
  });

  if (!product) return c.json({ error: "Product not found" }, 404);

  if (product.status !== "sellerReady" || !product.sellerSignedCollabPsbt) {
    return c.json({ status: product.status, buyerPsbt: null });
  }

  return c.json({
    status: "sellerReady",
    collaboratePsbt: product.sellerSignedCollabPsbt,
  });
});

// Buyer sends the fully signed PSBT (buyer + seller sigs). Backend submits to Ark and returns checkpoints for buyer to sign.
collaborate.post("/buyer-submit-psbt", async (c) => {
  const id = c.req.param("id");
  const { signedPsbt } = await c.req.json();

  if (!signedPsbt) {
    return c.json({ error: "signedPsbt is required" }, 400);
  }

  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
  });

  if (!product) return c.json({ error: "Product not found" }, 404);

  if (product.status !== "sellerReady") {
    return c.json({ error: "Seller has not signed yet" }, 400);
  }

  if (!product.sellerSignedCollabPsbt) {
    return c.json({ error: "Seller PSBT not found" }, 400);
  }

  if (!product.timelockExpiry || !product.buyerPubkey) {
    return c.json({ error: "Escrow not configured" }, 400);
  }

  const info = await arkProvider.getInfo();

  const { escrowScript, collaborativePath, sellerPubkey, serverPubkey } =
    await buildEscrowContext(
      product.buyerPubkey,
      product.sellerPubkey,
      product.timelockExpiry,
    );

  const serverUnrollScript = CSVMultisigTapscript.decode(
    hex.decode(info.checkpointTapscript),
  );

  // Recipient is the seller
  const recipientScript = new DefaultVtxo.Script({
    pubKey: sellerPubkey,
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

  // Submit fully-signed PSBT (buyer + seller) to Ark — server adds its 3rd signature
  const { arkTxid, signedCheckpointTxs } = await arkProvider.submitTx(
    signedPsbt,
    checkpointPsbts.map((cp: Uint8Array) => base64.encode(cp)),
  );

  // Save arkTxid and server-signed checkpoints (buyer still needs to sign before seller)
  await prisma.$transaction(async (tx) => {
    await tx.products.update({
      where: { id: product.id },
      data: {
        collabArkTxid: arkTxid,
        serverSignedCheckpoints: JSON.stringify(signedCheckpointTxs),
        status: "buyerSubmitted",
      },
    });
    await tx.productEvent.create({
      data: {
        productId: product.id,
        action: "buyer_signed_psbt",
        metadata: JSON.stringify({ arkTxid }),
      },
    });
  });

  return c.json({
    arkTxid,
    signedCheckpointTxs,
    nextStep:
      "Buyer signs checkpoint txs and calls POST /products/:id/buyer-sign-checkpoints, then seller retrieves via GET /products/:id/collab-checkpoints, signs them, and calls POST /products/:id/collaborate-checkpoints",
  });
});

// Buyer sends their signed checkpoint txs (server-signed + buyer-signed). Needed before seller can sign.
collaborate.post("/buyer-sign-checkpoints", async (c) => {
  const id = c.req.param("id");
  const { signedCheckpointTxs } = await c.req.json();

  if (!signedCheckpointTxs) {
    return c.json({ error: "signedCheckpointTxs is required" }, 400);
  }

  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
  });

  if (!product) return c.json({ error: "Product not found" }, 404);

  if (!product.collabArkTxid) {
    return c.json({ error: "Collaborate not submitted yet" }, 400);
  }

  await prisma.$transaction(async (tx) => {
    await tx.products.update({
      where: { id: product.id },
      data: {
        buyerSignedCheckpoints: JSON.stringify(signedCheckpointTxs),
        status: "buyerCheckpointsSigned",
      },
    });
    await tx.productEvent.create({
      data: { productId: product.id, action: "buyer_signed_checkpoints" },
    });
  });

  console.log("=== BUYER SIGNED CHECKPOINTS ===");
  console.log("Product ID:", product.id);
  console.log("================================");

  return c.json({
    success: true,
    nextStep:
      "Seller retrieves checkpoints via GET /products/:id/collab-checkpoints, signs them, and calls POST /products/:id/collaborate-checkpoints",
  });
});

// Seller polls for checkpoint txs to sign (available after buyer signs checkpoints).
collaborate.get("/seller-checkpoints", async (c) => {
  const id = c.req.param("id");

  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
  });

  if (!product) return c.json({ error: "Product not found" }, 404);

  if (!product.collabArkTxid || !product.buyerSignedCheckpoints) {
    return c.json({ status: product.status, checkpointTxs: null });
  }

  return c.json({
    status: product.status,
    arkTxid: product.collabArkTxid,
    checkpointTxs: JSON.parse(product.buyerSignedCheckpoints),
  });
});

// Seller sends their signed checkpoint txs. Backend finalizes the Ark tx.
collaborate.post("/seller-sign-checkpoints", async (c) => {
  const id = c.req.param("id");
  const { signedCheckpointTxs } = await c.req.json();

  if (!signedCheckpointTxs) {
    return c.json({ error: "signedCheckpointTxs is required" }, 400);
  }

  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
  });

  if (!product) return c.json({ error: "Product not found" }, 404);

  if (!product.collabArkTxid) {
    return c.json({ error: "Collaborate not submitted yet" }, 400);
  }

  await arkProvider.finalizeTx(product.collabArkTxid, signedCheckpointTxs);

  console.log("=== COLLABORATE FINALIZED ===");
  console.log("Product ID:", product.id);
  console.log("Ark TX ID:", product.collabArkTxid);
  console.log("=============================");

  await prisma.$transaction(async (tx) => {
    await tx.products.update({
      where: { id: product.id },
      data: { status: "payed" },
    });
    await tx.productEvent.create({
      data: {
        productId: product.id,
        action: "seller_signed_checkpoints",
        metadata: JSON.stringify({ arkTxid: product.collabArkTxid }),
      },
    });
  });

  return c.json({ success: true, arkTxid: product.collabArkTxid });
});
