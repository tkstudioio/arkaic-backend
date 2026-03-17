import {
  buildOffchainTx,
  CLTVMultisigTapscript,
  CSVMultisigTapscript,
  DefaultVtxo,
  MultisigTapscript,
  VirtualCoin,
  VtxoScript,
} from "@arkade-os/sdk";
import { arkProvider, getServerPubkey, indexerProvider } from "@/lib/ark";
import { hex, base64 } from "@scure/base";

export function toXOnly(pubkey: Uint8Array): Uint8Array {
  return pubkey.length === 33 ? pubkey.slice(1) : pubkey;
}

export async function buildEscrowContext(
  buyerPubkeyHex: string,
  sellerPubkeyHex: string,
  timelockExpiry: number,
) {
  const serverPubkey = await getServerPubkey();

  const buyerPubkey = toXOnly(hex.decode(buyerPubkeyHex));
  const sellerPubkey = toXOnly(hex.decode(sellerPubkeyHex));

  const refundPath = CLTVMultisigTapscript.encode({
    pubkeys: [buyerPubkey, serverPubkey],
    absoluteTimelock: BigInt(timelockExpiry),
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

export async function buildEscrowTransaction(
  escrow: { buyerPubkey: string; sellerPubkey: string; timelockExpiry: number },
  pathType: "collaborative" | "refund",
) {
  const info = await arkProvider.getInfo();

  const ctx = await buildEscrowContext(
    escrow.buyerPubkey,
    escrow.sellerPubkey,
    escrow.timelockExpiry,
  );

  const recipientPubkey =
    pathType === "collaborative" ? ctx.sellerPubkey : ctx.buyerPubkey;
  const spendPath =
    pathType === "collaborative" ? ctx.collaborativePath : ctx.refundPath;

  const serverUnrollScript = CSVMultisigTapscript.decode(
    hex.decode(info.checkpointTapscript),
  );

  const recipientScript = new DefaultVtxo.Script({
    pubKey: recipientPubkey,
    serverPubKey: ctx.serverPubkey,
    csvTimelock: { type: "seconds" as const, value: info.unilateralExitDelay },
  });

  const { vtxos } = await indexerProvider.getVtxos({
    scripts: [hex.encode(ctx.escrowScript.pkScript)],
    spendableOnly: true,
  });

  if (vtxos.length === 0) {
    return { error: "No spendable VTXOs found" } as const;
  }

  const inputs = vtxos.map((vtxo: VirtualCoin) => ({
    txid: vtxo.txid,
    vout: vtxo.vout,
    value: vtxo.value,
    tapLeafScript: ctx.escrowScript.findLeaf(hex.encode(spendPath)),
    tapTree: ctx.escrowScript.encode(),
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

  const { arkTx, checkpoints } = buildOffchainTx(
    inputs,
    outputs,
    serverUnrollScript,
  );

  const psbt = base64.encode(arkTx.toPSBT());
  const recipientAddress = recipientScript
    .address("tark", ctx.serverPubkey)
    .encode();
  const checkpointPsbts = checkpoints.map((cp) => base64.encode(cp.toPSBT()));

  return { psbt, recipientAddress, checkpointPsbts, error: null } as const;
}
