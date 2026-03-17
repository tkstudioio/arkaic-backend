import type { PrismaClient } from "@/generated/prisma/client";
import { sendToUser } from "@/routes/ws";

type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export const SYSTEM_SENDER = "SYSTEM";

export async function createSystemMessage(
  tx: TxClient | PrismaClient,
  chatId: number,
  content: string,
  notifyPubkeys: string[],
) {
  const msg = await tx.message.create({
    data: {
      chatId,
      message: content,
      senderPubkey: null,
      isSystem: true,
    },
  });

  for (const pubkey of notifyPubkeys) {
    sendToUser(pubkey, { type: "new_message", chatId });
  }

  return msg;
}
