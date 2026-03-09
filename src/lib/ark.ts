import {
  ESPLORA_URL,
  EsploraProvider,
  RestArkProvider,
  RestIndexerProvider,
} from "@arkade-os/sdk";
import { hex } from "@scure/base";

const ARK_SERVER_URL = "https://mutinynet.arkade.sh";

export const arkProvider = new RestArkProvider(ARK_SERVER_URL);
export const indexerProvider = new RestIndexerProvider(ARK_SERVER_URL);
const onchainProvider = new EsploraProvider(ESPLORA_URL.mutinynet);

export async function getServerPubkey(): Promise<Uint8Array> {
  const info = await arkProvider.getInfo();
  const raw = hex.decode(info.signerPubkey);
  return raw.length === 33 ? raw.slice(1) : raw;
}

export async function getNetworkTimeSeconds(): Promise<number> {
  const tip = await onchainProvider.getChainTip();
  return tip.time;
}
