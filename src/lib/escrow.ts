import {
  CLTVMultisigTapscript,
  MultisigTapscript,
  VtxoScript,
} from "@arkade-os/sdk";
import { getServerPubkey } from "@/lib/ark";
import { hex } from "@scure/base";

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
