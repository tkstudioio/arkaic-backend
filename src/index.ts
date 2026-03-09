import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import {
  arkProvider,
  getNetworkTimeSeconds,
  getServerPubkey,
  indexerProvider,
} from "./lib/ark.js";
import { prisma } from "./lib/prisma.js";
import {
  ArkAddress,
  buildOffchainTx,
  CLTVMultisigTapscript,
  CSVMultisigTapscript,
  MultisigTapscript,
  networks,
  Transaction,
  VirtualCoin,
  VtxoScript,
} from "@arkade-os/sdk";
import { base64, hex } from "@scure/base";
import { products } from "./routes/products.js";

const app = new Hono();

app.use("*", cors());

async function getCurrentTimeSeconds(): Promise<number> {
  try {
    return await getNetworkTimeSeconds();
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}

function toXOnly(pubkeyHex: string): Uint8Array {
  const raw = hex.decode(pubkeyHex);
  return raw.length === 33 ? raw.slice(1) : raw;
}

function buildEscrowScript(
  buyerKey: Uint8Array,
  sellerKey: Uint8Array,
  serverPubkey: Uint8Array,
  timelockExpiry: bigint,
) {
  const collaborativePath = MultisigTapscript.encode({
    pubkeys: [buyerKey, sellerKey, serverPubkey],
  }).script;

  const refundPath = CLTVMultisigTapscript.encode({
    pubkeys: [buyerKey, serverPubkey],
    absoluteTimelock: timelockExpiry,
  }).script;

  const escrowScript = new VtxoScript([collaborativePath, refundPath]);

  return { escrowScript, collaborativePath, refundPath };
}

function buildBuyerRecipientScript(
  buyerKey: Uint8Array,
  serverPubkey: Uint8Array,
) {
  return new VtxoScript([
    MultisigTapscript.encode({
      pubkeys: [buyerKey, serverPubkey],
    }).script,
  ]);
}

function getLegacyRefundRecipientAddress(
  buyerKey: Uint8Array,
  serverPubkey: Uint8Array,
) {
  return buildBuyerRecipientScript(buyerKey, serverPubkey)
    .address(networks.mutinynet.hrp, serverPubkey)
    .encode();
}

function resolveRefundRecipient(
  listing: { refundRecipientAddress: string | null },
  buyerKey: Uint8Array,
  serverPubkey: Uint8Array,
) {
  if (listing.refundRecipientAddress) {
    const decoded = ArkAddress.decode(listing.refundRecipientAddress);
    return {
      recipientPkScript: decoded.pkScript,
      recipientAddress: listing.refundRecipientAddress,
      recipientType: "walletAddress",
    } as const;
  }

  const legacyAddress = getLegacyRefundRecipientAddress(buyerKey, serverPubkey);
  return {
    recipientPkScript: buildBuyerRecipientScript(buyerKey, serverPubkey)
      .pkScript,
    recipientAddress: legacyAddress,
    recipientType: "legacyBuyerServerScript",
  } as const;
}

app.route("/products", products);

// // Bob sends his signed PSBT here to claim the refund.
// // Server rebuilds checkpoints, submits to Ark, and finalizes.
// app.post("/listings/:listingId/claim", async (c) => {
//   const listingId = Number(c.req.param("listingId"));
//   const { signedPsbt } = await c.req.json();

//   if (!signedPsbt) {
//     return c.json({ error: "signedPsbt is required" }, 400);
//   }

//   const listing = await prisma.listing.findUnique({
//     where: { id: listingId },
//   });

//   if (!listing) {
//     return c.json({ error: "Listing not found" }, 404);
//   }

//   if (listing.status === "refunded") {
//     return c.json({ error: "Already refunded" }, 400);
//   }

//   if (
//     !listing.timelockExpiry ||
//     !listing.buyerPubkey ||
//     !listing.escrowAddress
//   ) {
//     return c.json({ error: "Escrow not configured" }, 400);
//   }

//   const now = await getCurrentTimeSeconds();
//   if (now < listing.timelockExpiry) {
//     return c.json(
//       {
//         error: "Timelock not yet expired",
//         currentNetworkTime: now,
//         timelockExpiry: listing.timelockExpiry,
//       },
//       400,
//     );
//   }

//   const serverPubkey = await getServerPubkey();
//   const info = await arkProvider.getInfo();

//   const buyerKey = toXOnly(listing.buyerPubkey);
//   const sellerKey = toXOnly(listing.sellerPubkey);

//   const { escrowScript, refundPath } = buildEscrowScript(
//     buyerKey,
//     sellerKey,
//     serverPubkey,
//     BigInt(listing.timelockExpiry),
//   );

//   const serverUnrollScript = CSVMultisigTapscript.decode(
//     hex.decode(info.checkpointTapscript),
//   );

//   const { recipientPkScript, recipientAddress, recipientType } =
//     resolveRefundRecipient(listing, buyerKey, serverPubkey);

//   const decodedAddr = ArkAddress.decode(listing.escrowAddress);
//   const script = hex.encode(decodedAddr.pkScript);

//   const { vtxos } = await indexerProvider.getVtxos({
//     scripts: [script],
//     spendableOnly: true,
//   });

//   if (vtxos.length === 0) {
//     return c.json({ error: "No spendable VTXOs found" }, 400);
//   }

//   const inputs = vtxos.map((vtxo: VirtualCoin) => ({
//     txid: vtxo.txid,
//     vout: vtxo.vout,
//     value: BigInt(vtxo.value),
//     tapLeafScript: escrowScript.findLeaf(hex.encode(refundPath)),
//     tapTree: escrowScript.encode(),
//   }));

//   const totalValue = vtxos.reduce(
//     (sum: bigint, vtxo: VirtualCoin) => sum + BigInt(vtxo.value),
//     0n,
//   );

//   const outputs = [
//     {
//       amount: totalValue,
//       script: recipientPkScript,
//     },
//   ];

//   const { checkpoints } = buildOffchainTx(inputs, outputs, serverUnrollScript);

//   const checkpointPsbts = checkpoints.map((cp: Transaction) => cp.toPSBT());

//   // Submit buyer-signed PSBT to Ark (server co-signs)
//   const { arkTxid, signedCheckpointTxs } = await arkProvider.submitTx(
//     signedPsbt,
//     checkpointPsbts.map((cp: Uint8Array) => base64.encode(cp)),
//   );

//   console.log("=== REFUND SUBMITTED ===");
//   console.log("Listing ID:", listing.id);
//   console.log("Ark TX ID:", arkTxid);
//   console.log("Refund recipient:", recipientAddress, `(${recipientType})`);
//   console.log("========================");

//   return c.json({
//     arkTxid,
//     signedCheckpointTxs,
//     refundRecipientAddressUsed: recipientAddress,
//     refundRecipientType: recipientType,
//     nextStep: "Sign checkpoint txs with buyer key and call POST /listings/:listingId/finalize",
//   });
// });

// // Bob sends buyer-signed checkpoints to finalize the refund.
// app.post("/listings/:listingId/finalize", async (c) => {
//   const listingId = Number(c.req.param("listingId"));
//   const body = await c.req.json();
//   const { arkTxid, signedCheckpoints, signedCheckpointTxs } = body;
//   const checkpointsToFinalize = signedCheckpoints ?? signedCheckpointTxs;

//   if (!arkTxid || !checkpointsToFinalize) {
//     return c.json(
//       {
//         error:
//           "arkTxid and signedCheckpoints are required (accepted aliases: signedCheckpoints, signedCheckpointTxs)",
//       },
//       400,
//     );
//   }

//   const listing = await prisma.listing.findUnique({
//     where: { id: listingId },
//   });

//   if (!listing) {
//     return c.json({ error: "Listing not found" }, 404);
//   }

//   await arkProvider.finalizeTx(arkTxid, checkpointsToFinalize);

//   console.log("=== REFUND FINALIZED ===");
//   console.log("Listing ID:", listing.id);
//   console.log("Ark TX ID:", arkTxid);
//   console.log("========================");

//   await prisma.listing.update({
//     where: { id: listing.id },
//     data: { status: "refunded" },
//   });

//   return c.json({ success: true, arkTxid });
// });

// app.get("/listings/:listingId/refund-status", async (c) => {
//   const listingId = Number(c.req.param("listingId"));

//   const listing = await prisma.listing.findUnique({
//     where: { id: listingId },
//   });

//   if (!listing) {
//     return c.json({ error: "Listing not found" }, 404);
//   }

//   if (!listing.buyerPubkey) {
//     return c.json({ error: "Buyer pubkey not set" }, 400);
//   }

//   const serverPubkey = await getServerPubkey();
//   const buyerKey = toXOnly(listing.buyerPubkey);
//   const { recipientPkScript, recipientAddress, recipientType } =
//     resolveRefundRecipient(listing, buyerKey, serverPubkey);
//   const recipientScriptHex = hex.encode(recipientPkScript);

//   const { vtxos } = await indexerProvider.getVtxos({
//     scripts: [recipientScriptHex],
//     spendableOnly: true,
//   });

//   const totalReceived = vtxos.reduce(
//     (sum: bigint, vtxo: VirtualCoin) => sum + BigInt(vtxo.value),
//     0n,
//   );

//   return c.json({
//     listingId: listing.id,
//     listingStatus: listing.status,
//     recipientAddress,
//     recipientType,
//     recipientScriptHex,
//     spendableVtxoCount: vtxos.length,
//     totalReceived: totalReceived.toString(),
//     vtxos: vtxos.map((vtxo: VirtualCoin) => ({
//       txid: vtxo.txid,
//       vout: vtxo.vout,
//       value: String(vtxo.value),
//       spentBy: vtxo.spentBy,
//       expireAt: vtxo.expireAt,
//       createdAt: vtxo.createdAt,
//     })),
//   });
// });

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, async () => {
  console.log(`Server running on port ${port}`);
});

export default app;
