import { Hono } from "hono";
import { prisma } from "../../lib/prisma.js";
import { bearerAuth, type AuthEnv } from "../../lib/auth.js";

export const chats = new Hono<AuthEnv>();

chats.use(bearerAuth);

// GET /:chatId — chat detail with messages
chats.get("/:chatId", async (c) => {
  const chatId = Number(c.req.param("chatId"));
  const pubkey = c.get("pubkey");

  const chat = await prisma.productChat.findUnique({
    where: { id: chatId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      buyer: true,
      product: { include: { seller: true } },
      escrow: true,
    },
  });

  if (!chat) return c.json({ error: "Chat not found" }, 404);

  if (chat.buyer.pubkey !== pubkey && chat.product.seller.pubkey !== pubkey) {
    return c.json({ error: "Forbidden" }, 403);
  }

  return c.json(chat);
});

// POST /:chatId/messages — send message or counter-offer
chats.post("/:chatId/messages", async (c) => {
  const chatId = Number(c.req.param("chatId"));
  const pubkey = c.get("pubkey");
  const { text, offerPrice } = await c.req.json();

  const chat = await prisma.productChat.findUnique({
    where: { id: chatId },
    include: { buyer: true, product: { include: { seller: true } } },
  });

  if (!chat) return c.json({ error: "Chat not found" }, 404);

  if (chat.buyer.pubkey !== pubkey && chat.product.seller.pubkey !== pubkey) {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (chat.status === "concluded") {
    return c.json({ error: "Chat is concluded" }, 400);
  }

  const senderId =
    chat.buyer.pubkey === pubkey ? chat.buyerId : chat.product.sellerId;

  const hasOffer = offerPrice != null;

  if (hasOffer) {
    if (chat.agreedPrice != null) {
      return c.json({ error: "An offer has already been accepted" }, 400);
    }

    // Auto-reject any previous awaitingAccept offer in this chat
    await prisma.chatMessage.updateMany({
      where: { chatId, offerStatus: "awaitingAccept" },
      data: { offerStatus: "rejected" },
    });
  }

  const message = await prisma.chatMessage.create({
    data: {
      chatId,
      senderId,
      text: text ?? null,
      offerPrice: hasOffer ? Number(offerPrice) : null,
      offerStatus: hasOffer ? "awaitingAccept" : null,
    },
  });

  await prisma.productChat.update({
    where: { id: chatId },
    data: { updatedAt: new Date() },
  });

  return c.json(message, 201);
});

// POST /:chatId/offers/:messageId/accept — accept an offer
chats.post("/:chatId/offers/:messageId/accept", async (c) => {
  const chatId = Number(c.req.param("chatId"));
  const messageId = Number(c.req.param("messageId"));
  const pubkey = c.get("pubkey");

  const chat = await prisma.productChat.findUnique({
    where: { id: chatId },
    include: { buyer: true, product: { include: { seller: true } } },
  });

  if (!chat) return c.json({ error: "Chat not found" }, 404);

  if (chat.buyer.pubkey !== pubkey && chat.product.seller.pubkey !== pubkey) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    include: { sender: true },
  });

  if (!message || message.chatId !== chatId) {
    return c.json({ error: "Message not found" }, 404);
  }

  if (!message.offerPrice || message.offerStatus !== "awaitingAccept") {
    return c.json({ error: "Offer is not awaiting acceptance" }, 400);
  }

  if (message.sender.pubkey === pubkey) {
    return c.json({ error: "Cannot accept your own offer" }, 400);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const msg = await tx.chatMessage.update({
      where: { id: messageId },
      data: { offerStatus: "accepted" },
    });

    await tx.productChat.update({
      where: { id: chatId },
      data: { agreedPrice: message.offerPrice, updatedAt: new Date() },
    });

    return msg;
  });

  return c.json(updated);
});

// POST /:chatId/offers/:messageId/reject — reject an offer
chats.post("/:chatId/offers/:messageId/reject", async (c) => {
  const chatId = Number(c.req.param("chatId"));
  const messageId = Number(c.req.param("messageId"));
  const pubkey = c.get("pubkey");

  const chat = await prisma.productChat.findUnique({
    where: { id: chatId },
    include: { buyer: true, product: { include: { seller: true } } },
  });

  if (!chat) return c.json({ error: "Chat not found" }, 404);

  if (chat.buyer.pubkey !== pubkey && chat.product.seller.pubkey !== pubkey) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    include: { sender: true },
  });

  if (!message || message.chatId !== chatId) {
    return c.json({ error: "Message not found" }, 404);
  }

  if (!message.offerPrice || message.offerStatus !== "awaitingAccept") {
    return c.json({ error: "Offer is not awaiting acceptance" }, 400);
  }

  if (message.sender.pubkey === pubkey) {
    return c.json({ error: "Cannot reject your own offer" }, 400);
  }

  const updated = await prisma.chatMessage.update({
    where: { id: messageId },
    data: { offerStatus: "rejected" },
  });

  return c.json(updated);
});

// POST /:chatId/accept — buyer accepts, creates escrow
chats.post("/:chatId/accept", async (c) => {
  const chatId = Number(c.req.param("chatId"));
  const pubkey = c.get("pubkey");
  const { timelockExpiry } = await c.req.json();

  if (!timelockExpiry) {
    return c.json({ error: "timelockExpiry is required" }, 400);
  }

  const chat = await prisma.productChat.findUnique({
    where: { id: chatId },
    include: {
      buyer: true,
      product: { include: { seller: true } },
      escrow: true,
    },
  });

  if (!chat) return c.json({ error: "Chat not found" }, 404);

  if (chat.buyer.pubkey !== pubkey) {
    return c.json({ error: "Only the buyer can accept" }, 403);
  }

  if (chat.escrow) {
    return c.json({ error: "Escrow already exists for this chat" }, 400);
  }

  const agreedPrice = chat.agreedPrice ?? chat.product.price;

  const escrow = await prisma.escrow.create({
    data: {
      chatId,
      sellerId: chat.product.seller.id,
      buyerId: chat.buyer.id,
      value: agreedPrice,
      timelockExpiry: Number(timelockExpiry),
    },
  });

  await prisma.productEvent.create({
    data: {
      productId: chat.product.id,
      action: "escrow_created",
      metadata: JSON.stringify({ escrowId: escrow.id, value: agreedPrice }),
    },
  });

  return c.json(escrow, 201);
});
