import { type AuthEnv, bearerAuth, verifySignature } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sValidator } from "@hono/standard-validator";
import { Hono } from "hono";
import z from "zod";

export const messages = new Hono<AuthEnv>();

messages.use(bearerAuth);

messages.post(
  "/:chatId",
  verifySignature,
  sValidator(
    "json",
    z.object({
      message: z.string().optional(),
      offeredPrice: z.number().optional(),
    }),
  ),
  async (c) => {
    const senderPubkey = c.get("pubkey");
    const signature = c.get("signature");
    const chatId = c.req.param("chatId");
    const message = c.req.valid("json");

    const chat = await prisma.chat.findFirst({
      where: {
        id: Number(chatId),
      },
    });

    if (!chat) {
      return c.text("Chat not found", 404);
    }

    if (!message.offeredPrice) {
      const newMessage = await prisma.message.create({
        data: {
          chatId: Number(chatId),
          message: message.message,
          senderPubkey,
          signature,
        },
      });

      return c.json(newMessage);
    }

    const transaction = await prisma.$transaction(async (tx) => {
      await tx.message.create({
        data: {
          chatId: Number(chatId),
          message: message.message,
          senderPubkey,
          signature,
        },
      });

      await tx.offer.create({
        data: {
          productId: escrow.chat.productId,
          action: "seller_signed_psbt",
          metadata: JSON.stringify({ escrowId: escrow.id }),
        },
      });
    });

    return c.json(transaction);
  },
);
