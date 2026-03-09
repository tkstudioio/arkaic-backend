import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import {
  buildOffchainTx,
  CLTVMultisigTapscript,
  CSVMultisigTapscript,
  DefaultVtxo,
  MultisigTapscript,
  Transaction,
  VirtualCoin,
  VtxoScript,
} from "@arkade-os/sdk";
import { arkProvider, getServerPubkey, indexerProvider } from "../lib/ark.js";

import { base64, hex } from "@scure/base";

export const products = new Hono();

function toXOnly(pubkey: Uint8Array): Uint8Array {
  return pubkey.length === 33 ? pubkey.slice(1) : pubkey;
}

async function buildEscrowContext(
  buyerPubkeyHex: string,
  sellerPubkeyHex: string,
  timelockExpiry: number,
) {
  const serverPubkey = await getServerPubkey();

  const buyerPubkey = toXOnly(hex.decode(buyerPubkeyHex));
  const sellerPubkey = toXOnly(hex.decode(sellerPubkeyHex));

  const refundPath = CLTVMultisigTapscript.encode({
    pubkeys: [buyerPubkey, serverPubkey],
    absoluteTimelock: timelockExpiry,
  }).script;

  const collaborativePath = MultisigTapscript.encode({
    pubkeys: [buyerPubkey, sellerPubkey, serverPubkey],
  }).script;

  const escrowScript = new VtxoScript([refundPath, collaborativePath]);

  return {
    escrowScript,
    refundPath,
    collaborativePath,
    buyerPubkey,
    sellerPubkey,
    serverPubkey,
  };
}

products.get("/", async (c) => {
  return c.json(await prisma.products.findMany());
});

products.get("/:id", async (c) => {
  const id = c.req.param("id");
  const products = await prisma.products.findUnique({
    where: { id: Number(id) },
  });
  if (!products) return c.json({ error: "Product not found" }, 404);
  return c.json(products);
});

products.post("/", async (c) => {
  const body = await c.req.json();
  const { nome, prezzo, sellerPubkey } = body;
  const products = await prisma.products.create({
    data: { nome, prezzo: Number(prezzo), sellerPubkey },
  });

  return c.json(products, 201);
});

products.get("/:id/check-payment", async (c) => {
  const id = c.req.param("id");

  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
  });

  if (!product) return c.text("Product not found", 404);

  const buyerPubkeyString = c.req.query("buyerPubkey");
  const timelockExpiry = c.req.query("timelockExpiry");

  if (!buyerPubkeyString || !timelockExpiry)
    return c.text("Missing buyerPubkey or timelockExpiry", 400);

  const sellerPubkeyBytes = hex.decode(product.sellerPubkey);
  const sellerPubkey =
    sellerPubkeyBytes.length === 33
      ? sellerPubkeyBytes.slice(1)
      : sellerPubkeyBytes;

  const buyerPubkeyBytes = hex.decode(buyerPubkeyString);
  const buyerPubkey =
    buyerPubkeyBytes.length === 33
      ? buyerPubkeyBytes.slice(1)
      : buyerPubkeyBytes;

  const serverPubkey = await getServerPubkey();

  const refundPath = CLTVMultisigTapscript.encode({
    pubkeys: [buyerPubkey, serverPubkey],
    absoluteTimelock: Number(timelockExpiry),
  }).script;

  const collaborativePath = MultisigTapscript.encode({
    pubkeys: [buyerPubkey, sellerPubkey, serverPubkey],
  }).script;

  const escrowScript = new VtxoScript([refundPath, collaborativePath]);

  const { vtxos } = await indexerProvider.getVtxos({
    scripts: [hex.encode(escrowScript.pkScript)],
  });

  const total = (vtxos as VirtualCoin[]).reduce(
    (acc, vtxo) => acc + vtxo.value,
    0,
  );

  if (total < product.prezzo) return c.text("Awaiting payment", 404);

  const updatedProduct = await prisma.products.update({
    where: { id: product.id },
    data: {
      status: "fundLocked",
      buyerPubkey: buyerPubkeyString,
      timelockExpiry: Number(timelockExpiry),
    },
  });

  return c.json(updatedProduct);
});

// Build the unsigned refund PSBT for the buyer to sign.
products.get("/:id/get-psbts", async (c) => {
  const id = c.req.param("id");

  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
  });

  if (!product) return c.json({ error: "Product not found" }, 404);

  if (!product.timelockExpiry || !product.buyerPubkey) {
    return c.json({ error: "Escrow not configured" }, 400);
  }

  const serverPubkey = await getServerPubkey();
  const info = await arkProvider.getInfo();

  const buyerPubkeyBytes = hex.decode(product.buyerPubkey);
  const buyerPubkey =
    buyerPubkeyBytes.length === 33
      ? buyerPubkeyBytes.slice(1)
      : buyerPubkeyBytes;

  const sellerPubkeyBytes = hex.decode(product.sellerPubkey);
  const sellerPubkey =
    sellerPubkeyBytes.length === 33
      ? sellerPubkeyBytes.slice(1)
      : sellerPubkeyBytes;

  const refundPath = CLTVMultisigTapscript.encode({
    pubkeys: [buyerPubkey, serverPubkey],
    absoluteTimelock: Number(product.timelockExpiry),
  }).script;

  const collaborativePath = MultisigTapscript.encode({
    pubkeys: [buyerPubkey, sellerPubkey, serverPubkey],
  }).script;

  const escrowScript = new VtxoScript([refundPath, collaborativePath]);

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

// Bob sends his signed PSBT here. Server submits and returns checkpoint txs for buyer to co-sign.
products.post("/:id/refund", async (c) => {
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

  const serverPubkey = await getServerPubkey();
  const info = await arkProvider.getInfo();

  const buyerPubkeyBytes = hex.decode(product.buyerPubkey);
  const buyerPubkey =
    buyerPubkeyBytes.length === 33
      ? buyerPubkeyBytes.slice(1)
      : buyerPubkeyBytes;

  const sellerPubkeyBytes = hex.decode(product.sellerPubkey);
  const sellerPubkey =
    sellerPubkeyBytes.length === 33
      ? sellerPubkeyBytes.slice(1)
      : sellerPubkeyBytes;

  const refundPath = CLTVMultisigTapscript.encode({
    pubkeys: [buyerPubkey, serverPubkey],
    absoluteTimelock: Number(product.timelockExpiry),
  }).script;

  const collaborativePath = MultisigTapscript.encode({
    pubkeys: [buyerPubkey, sellerPubkey, serverPubkey],
  }).script;

  const escrowScript = new VtxoScript([refundPath, collaborativePath]);

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

  console.log("=== REFUND SUBMITTED ===");
  console.log("Product ID:", product.id);
  console.log("Ark TX ID:", arkTxid);
  console.log("========================");

  return c.json({
    arkTxid,
    signedCheckpointTxs,
    nextStep:
      "Sign checkpoint txs with buyer key and call POST /products/:id/finalize-refund",
  });
});

// Bob sends buyer-signed checkpoints to finalize the refund.
products.post("/:id/finalize-refund", async (c) => {
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

  await prisma.products.update({
    where: { id: product.id },
    data: { status: "refunded" },
  });

  return c.json({ success: true, arkTxid });
});

// Build the unsigned collaborative PSBT for the seller to sign.
// The seller calls this to get the PSBT that spends from escrow via the collaborative path.
products.get("/:id/collaborate-psbts", async (c) => {
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

// Seller sends their signed collaborative PSBT. Backend submits to Ark and returns checkpoints for seller to sign.
products.post("/:id/collaborate", async (c) => {
  const id = c.req.param("id");
  const { signedPsbt } = await c.req.json();

  if (!signedPsbt) {
    return c.json({ error: "sellerSignedPsbt is required" }, 400);
  }

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

  const { checkpoints } = buildOffchainTx(inputs, outputs, serverUnrollScript);
  const checkpointPsbts = checkpoints.map((cp: Transaction) => cp.toPSBT());

  // Submit seller-signed PSBT to Ark (server co-signs)
  const { arkTxid, signedCheckpointTxs } = await arkProvider.submitTx(
    signedPsbt,
    checkpointPsbts.map((cp: Uint8Array) => base64.encode(cp)),
  );

  // Save seller-signed PSBT and arkTxid, but do NOT set sellerReady yet
  await prisma.products.update({
    where: { id: product.id },
    data: {
      sellerSignedCollabPsbt: signedPsbt,
      collabArkTxid: arkTxid,
    },
  });

  console.log("=== COLLABORATE SUBMITTED ===");
  console.log("Product ID:", product.id);
  console.log("Ark TX ID:", arkTxid);
  console.log("=============================");

  return c.json({
    signedCheckpointTxs,
    nextStep:
      "Sign checkpoint txs with seller key and call POST /products/:id/collaborate-checkpoints",
  });
});

// Seller sends their signed checkpoint txs. Backend saves them, status -> sellerReady.
products.post("/:id/collaborate-checkpoints", async (c) => {
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

  await prisma.products.update({
    where: { id: product.id },
    data: {
      sellerSignedCheckpoints: JSON.stringify(signedCheckpointTxs),
      status: "sellerReady",
    },
  });

  console.log("=== SELLER READY ===");
  console.log("Product ID:", product.id);
  console.log("====================");

  return c.json({ success: true, message: "Waiting for buyer confirmation" });
});

// Buyer checks if the seller is ready and gets the PSBT to sign.
products.get("/:id/collab-status", async (c) => {
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

// Buyer sends the fully signed PSBT (buyer + seller sigs). Backend finalizes with seller-signed checkpoints.
products.post("/:id/confirm-collaborate", async (c) => {
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

  if (!product.collabArkTxid || !product.sellerSignedCheckpoints) {
    return c.json({ error: "Collaborate not fully prepared" }, 400);
  }

  const sellerSignedCheckpoints = JSON.parse(product.sellerSignedCheckpoints);

  await arkProvider.finalizeTx(product.collabArkTxid, sellerSignedCheckpoints);

  console.log("=== COLLABORATE FINALIZED ===");
  console.log("Product ID:", product.id);
  console.log("Ark TX ID:", product.collabArkTxid);
  console.log("=============================");

  await prisma.products.update({
    where: { id: product.id },
    data: { status: "payed" },
  });

  return c.json({ success: true, arkTxid: product.collabArkTxid });
});
