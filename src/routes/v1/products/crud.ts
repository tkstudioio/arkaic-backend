import { Hono } from "hono";
import { prisma } from "../../lib/prisma.js";
import { bearerAuth, type AuthEnv } from "../../lib/auth.js";

export const crud = new Hono<AuthEnv>();

// GET / — list available products (filter out those with active funded escrows)
crud.get("/", async (c) => {
  const unavailableEscrows = await prisma.escrow.findMany({
    where: {
      status: {
        in: [
          "fundLocked",
          "sellerReady",
          "buyerSubmitted",
          "buyerCheckpointsSigned",
          "completed",
        ],
      },
    },
    select: { chat: { select: { productId: true } } },
  });

  const unavailableProductIds = [
    ...new Set(unavailableEscrows.map((e) => e.chat.productId)),
  ];

  const products = await prisma.products.findMany({
    where:
      unavailableProductIds.length > 0
        ? { id: { notIn: unavailableProductIds } }
        : undefined,
    include: { seller: true },
  });

  return c.json(products);
});

// GET /:id — product detail
crud.get("/:id", async (c) => {
  const id = c.req.param("id");
  const includeEvents = c.req.query("include") === "events";
  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
    include: {
      seller: true,
      ...(includeEvents ? { events: { orderBy: { createdAt: "asc" } } } : {}),
    },
  });
  if (!product) return c.json({ error: "Product not found" }, 404);
  return c.json(product);
});

// GET /:id/events — product events
crud.get("/:id/events", async (c) => {
  const id = c.req.param("id");
  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
  });
  if (!product) return c.json({ error: "Product not found" }, 404);
  const events = await prisma.productEvent.findMany({
    where: { productId: product.id },
    orderBy: { createdAt: "asc" },
  });
  return c.json(events);
});

// POST / — create product (auth required)
crud.post("/", bearerAuth, async (c) => {
  const pubkey = c.get("pubkey");
  const body = await c.req.json();
  const { name, price } = body;

  const account = await prisma.account.findUnique({ where: { pubkey } });
  if (!account) return c.json({ error: "Account not found" }, 404);

  const product = await prisma.$transaction(async (tx) => {
    const p = await tx.products.create({
      data: { name, price: Number(price), sellerId: account.id },
    });
    await tx.productEvent.create({
      data: { productId: p.id, action: "created" },
    });
    return p;
  });

  return c.json(product, 201);
});

crud.post("/:id/chats", bearerAuth, async (c) => {
  const productId = Number(c.req.param("id"));
  const pubkey = c.get("pubkey");
  const { text, offerPrice } = await c.req.json();

  const product = await prisma.products.findUnique({
    where: { id: productId },
    include: { seller: true },
  });

  if (!product) return c.json({ error: "Product not found" }, 404);

  if (product.seller.pubkey === pubkey) {
    return c.json(
      { error: "Seller cannot open a chat on their own product" },
      400,
    );
  }

  const buyerAccount = await prisma.account.findUnique({ where: { pubkey } });
  if (!buyerAccount) return c.json({ error: "Account not found" }, 404);

  // Upsert: create chat if not exists, otherwise reuse
  let chat = await prisma.productChat.findUnique({
    where: { productId_buyerId: { productId, buyerId: buyerAccount.id } },
  });

  if (!chat) {
    chat = await prisma.productChat.create({
      data: { productId, buyerId: buyerAccount.id },
    });
  }

  // Create the first/new message
  const hasOffer = offerPrice != null;
  await prisma.chatMessage.create({
    data: {
      chatId: chat.id,
      senderId: buyerAccount.id,
      text: text ?? null,
      offerPrice: hasOffer ? Number(offerPrice) : null,
      offerStatus: hasOffer ? "awaitingAccept" : null,
    },
  });

  const fullChat = await prisma.productChat.findUnique({
    where: { id: chat.id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      buyer: true,
    },
  });

  return c.json(fullChat, 201);
});

// GET /:id/chats — list chats for a product (auth required, seller sees all, buyer sees own)
crud.get("/:id/chats", bearerAuth, async (c) => {
  const productId = Number(c.req.param("id"));
  const pubkey = c.get("pubkey");

  const product = await prisma.products.findUnique({
    where: { id: productId },
    include: { seller: true },
  });

  if (!product) return c.json({ error: "Product not found" }, 404);

  const isSeller = product.seller.pubkey === pubkey;

  if (isSeller) {
    const chats = await prisma.productChat.findMany({
      where: { productId },
      include: {
        buyer: true,
        messages: { orderBy: { createdAt: "asc" } },
        escrow: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    return c.json(chats);
  }

  // Buyer sees only their own chat
  const buyerAccount = await prisma.account.findUnique({ where: { pubkey } });
  if (!buyerAccount) return c.json({ error: "Account not found" }, 404);

  const chats = await prisma.productChat.findMany({
    where: { productId, buyerId: buyerAccount.id },
    include: {
      buyer: true,
      messages: { orderBy: { createdAt: "asc" }, include: { sender: true } },
      escrow: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return c.json(chats);
});
