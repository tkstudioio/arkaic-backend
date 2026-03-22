import { type AuthEnv, bearerAuth, verifySignature } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSystemMessage } from "@/lib/system-messages";
import { sendToUser } from "@/routes/ws";
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
    const signature = c.get("signature")!;
    const chatId = Number(c.req.param("chatId"));
    const body = c.req.valid("json");

    const chat = await prisma.chat.findFirst({
      where: { id: chatId },
      include: { listing: true },
    });

    if (!chat) {
      return c.text("Chat not found", 404);
    }

    if (senderPubkey !== chat.buyerPubkey && senderPubkey !== chat.listing.sellerPubkey) {
      return c.text("Forbidden", 403);
    }

    if (body.offeredPrice === undefined) {
      const newMessage = await prisma.message.create({
        data: {
          chatId,
          message: body.message,
          senderPubkey,
          signature,
        },
      });

      const notification = { type: "new_message", chatId };
      sendToUser(chat.buyerPubkey, notification);
      sendToUser(chat.listing.sellerPubkey, notification);

      return c.json(newMessage);
    }

    if (chat.buyerPubkey !== senderPubkey) {
      return c.text("Only the buyer can make offers", 403);
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.offer.updateMany({
        where: { message: { chatId }, valid: true },
        data: { valid: false },
      });

      const newMessage = await tx.message.create({
        data: {
          chatId,
          message: body.message,
          senderPubkey,
          signature,
        },
      });

      const offer = await tx.offer.create({
        data: {
          messageId: newMessage.id,
          price: body.offeredPrice!,
        },
      });

      await createSystemMessage(tx, chatId, `Offer of ${body.offeredPrice} sats submitted`, [
        chat.buyerPubkey,
        chat.listing.sellerPubkey,
      ]);

      return { ...newMessage, offer };
    });

    const notification = {
      type: "new_offer",
      chatId,
      price: body.offeredPrice,
    };
    sendToUser(chat.buyerPubkey, notification);
    sendToUser(chat.listing.sellerPubkey, notification);

    return c.json(result);
  },
);

messages.post(
  "/:chatId/offers/:offerId/respond",
  verifySignature,
  sValidator(
    "json",
    z.object({
      accepted: z.boolean(),
    }),
  ),
  async (c) => {
    const pubkey = c.get("pubkey");
    const signature = c.get("signature")!;
    const chatId = Number(c.req.param("chatId"));
    const offerId = Number(c.req.param("offerId"));
    const { accepted } = c.req.valid("json");

    const offer = await prisma.offer.findUnique({
      where: { id: offerId },
      include: {
        message: { include: { chat: { include: { listing: true } } } },
        acceptance: true,
      },
    });

    if (!offer) {
      return c.text("Offer not found", 404);
    }

    // Verify the offer belongs to this chat
    if (offer.message.chatId !== chatId) {
      return c.text("Offer not found", 404);
    }

    if (!offer.valid) {
      return c.text("Offer is no longer valid", 400);
    }

    if (offer.acceptance) {
      return c.text("Offer already responded to", 400);
    }

    if (offer.message.chat.listing.sellerPubkey !== pubkey) {
      return c.text("Only the seller can respond to offers", 403);
    }

    const acceptance = await prisma.$transaction(async (tx) => {
      const acc = await tx.offerAcceptance.create({
        data: {
          offerId,
          signature,
          accepted,
        },
      });

      const statusText = accepted ? "accepted" : "rejected";
      await createSystemMessage(tx, chatId, `Offer ${statusText}`, [
        offer.message.chat.buyerPubkey,
        offer.message.chat.listing.sellerPubkey,
      ]);

      return acc;
    });

    const notification = {
      type: accepted ? "offer_accepted" : "offer_rejected",
      chatId,
      offerId,
    };
    sendToUser(offer.message.chat.buyerPubkey, notification);
    sendToUser(offer.message.chat.listing.sellerPubkey, notification);

    return c.json(acceptance);
  },
);

messages.get("/:chatId/offers/active", async (c) => {
  const pubkey = c.get("pubkey");
  const chatId = Number(c.req.param("chatId"));

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { listing: true },
  });

  // Verify user is buyer or seller of this chat
  if (!chat || (chat.buyerPubkey !== pubkey && chat.listing.sellerPubkey !== pubkey)) {
    return c.text("Chat not found", 404);
  }

  const offer = await prisma.offer.findFirst({
    where: { message: { chatId }, valid: true },
    orderBy: { createdAt: "desc" },
    include: { message: true, acceptance: true },
  });

  if (!offer) {
    return c.text("No active offer found", 404);
  }

  return c.json(offer);
});
