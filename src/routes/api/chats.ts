import { type AuthEnv, bearerAuth, verifySignature } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Hono } from "hono";

export const chats = new Hono<AuthEnv>();

chats.use(bearerAuth);

// Get all seller's chat of a specific listing
chats.get("/seller/:listingId", async (c) => {
  const pubkey = c.get("pubkey");
  const listingId = c.req.param("listingId");

  const chats = await prisma.chat.findMany({
    where: {
      listingId: Number(listingId),
      listing: { sellerPubkey: pubkey },
    },

    include: {
      buyer: true,
      messages: { orderBy: { sentAt: "desc" }, take: 1 },
    },
  });

  return c.json(chats);
});

// Get a chat's escrow
chats.get("/:chatId/escrow", async (c) => {
  const pubkey = c.get("pubkey");
  const chatId = Number(c.req.param("chatId"));

  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      OR: [
        {
          buyerPubkey: pubkey,
        },
        {
          listing: { sellerPubkey: pubkey },
        },
      ],
    },
    include: { listing: true },
  });

  if (
    !chat ||
    (chat.buyerPubkey !== pubkey && chat.listing.sellerPubkey !== pubkey)
  ) {
    return c.text("Chat not found", 404);
  }

  const escrow = await prisma.escrow.findUnique({
    where: { chatId },
  });

  if (!escrow) return c.text("Escrow not found", 404);
  return c.json(escrow, 200);
});

// Get a chat's last offer
chats.get("/:chatId/offer", async (c) => {
  const pubkey = c.get("pubkey");
  const chatId = Number(c.req.param("chatId"));

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { listing: true },
  });

  // Check authorization first - return 404 if not authorized to prevent chat existence leak
  if (
    !chat ||
    (chat.buyerPubkey !== pubkey && chat.listing.sellerPubkey !== pubkey)
  ) {
    return c.text("Chat not found", 404);
  }

  const offerMessage = await prisma.message.findFirst({
    where: { chatId, offer: { valid: true } },
    include: {
      offer: { include: { acceptance: true } },
    },
    orderBy: { sentAt: "desc" },
  });

  if (!offerMessage?.offer) return c.body(null, 204);

  return c.json(offerMessage?.offer, 200);
});

// Get a chat by chatId
chats.get("/:chatId", async (c) => {
  const pubkey = c.get("pubkey");
  const chatId = c.req.param("chatId");

  const chat = await prisma.chat.findFirst({
    where: {
      id: Number(chatId),
      OR: [
        {
          buyerPubkey: pubkey,
        },
        {
          listing: { sellerPubkey: pubkey },
        },
      ],
    },
    include: {
      buyer: true,
      escrow: true,
      messages: {
        include: { sender: true, offer: { include: { acceptance: true } } },
      },
      listing: { include: { seller: true } },
    },
  });

  if (!chat) return c.text("Chat not found", 404);
  return c.json(chat);
});

// Create a chat for a specific listing
chats.post("/:listingId", verifySignature, async (c) => {
  const buyerPubkey = c.get("pubkey");
  const signature = c.get("signature")!;
  const listingId = c.req.param("listingId");

  const listing = await prisma.listing.findUnique({
    where: { id: Number(listingId) },
  });

  if (!listing) return c.text("Listing not found", 404);

  if (buyerPubkey === listing.sellerPubkey) {
    return c.text("Cannot create a chat on your own listing", 403);
  }

  const existingChat = await prisma.chat.findFirst({
    where: {
      buyerPubkey,
      listingId: Number(listingId),
    },
    include: {
      messages: {
        orderBy: { sentAt: "desc" },
        take: 1,
      },
    },
  });

  if (existingChat) return c.json(existingChat);

  const newChat = await prisma.chat.create({
    data: {
      buyerPubkey,
      listingId: Number(listingId),
      signature,
    },
    include: { messages: true },
  });

  return c.json(newChat);
});
