import { arkProvider } from "@/lib/ark";
import { type AuthEnv, bearerAuth, verifySignature } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Hono } from "hono";

export const chats = new Hono<AuthEnv>();

chats.use(bearerAuth);

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

  if (!chat) c.text("Chat not found", 404);
  return c.json(chat);
});

chats.get("/seller/:listingId", async (c) => {
  const pubkey = c.get("pubkey");
  const listingId = c.req.param("listingId");

  const chat = await prisma.chat.findMany({
    where: {
      listingId: Number(listingId),
      listing: { sellerPubkey: pubkey },
    },

    include: {
      buyer: true,
      messages: { orderBy: { sentAt: "desc" }, take: 1 },
    },
  });

  if (!chat) c.text("Chat not found", 404);
  return c.json(chat);
});

chats.post("/:listingId", verifySignature, async (c) => {
  const buyerPubkey = c.get("pubkey");
  const signature = c.get("signature");
  const listingId = c.req.param("listingId");

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
