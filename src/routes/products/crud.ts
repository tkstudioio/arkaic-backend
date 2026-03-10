import { Hono } from "hono";
import { prisma } from "../../lib/prisma.js";
import { VirtualCoin } from "@arkade-os/sdk";
import { indexerProvider } from "../../lib/ark.js";
import { hex } from "@scure/base";
import { buildEscrowContext } from "../../lib/escrow.js";

export const crud = new Hono();

crud.get("/", async (c) => {
  return c.json(await prisma.products.findMany());
});

crud.get("/:id", async (c) => {
  const id = c.req.param("id");
  const includeEvents = c.req.query("include") === "events";
  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
    include: includeEvents
      ? { events: { orderBy: { createdAt: "asc" } } }
      : undefined,
  });
  if (!product) return c.json({ error: "Product not found" }, 404);
  return c.json(product);
});

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

crud.post("/", async (c) => {
  const body = await c.req.json();
  const { nome, prezzo, sellerPubkey } = body;
  const product = await prisma.$transaction(async (tx) => {
    const p = await tx.products.create({
      data: { nome, prezzo: Number(prezzo), sellerPubkey },
    });
    await tx.productEvent.create({
      data: { productId: p.id, action: "created" },
    });
    return p;
  });

  return c.json(product, 201);
});

crud.get("/:id/check-payment", async (c) => {
  const id = c.req.param("id");

  const product = await prisma.products.findUnique({
    where: { id: Number(id) },
  });

  if (!product) return c.text("Product not found", 404);

  const buyerPubkeyString = c.req.query("buyerPubkey");
  const timelockExpiry = c.req.query("timelockExpiry");

  if (!buyerPubkeyString || !timelockExpiry)
    return c.text("Missing buyerPubkey or timelockExpiry", 400);

  const { escrowScript } = await buildEscrowContext(
    buyerPubkeyString,
    product.sellerPubkey,
    Number(timelockExpiry),
  );

  const { vtxos } = await indexerProvider.getVtxos({
    scripts: [hex.encode(escrowScript.pkScript)],
  });

  const total = (vtxos as VirtualCoin[]).reduce(
    (acc, vtxo) => acc + vtxo.value,
    0,
  );

  if (total < product.prezzo) return c.text("Awaiting payment", 404);

  const updatedProduct = await prisma.$transaction(async (tx) => {
    const p = await tx.products.update({
      where: { id: product.id },
      data: {
        status: "fundLocked",
        buyerPubkey: buyerPubkeyString,
        timelockExpiry: Number(timelockExpiry),
      },
    });
    await tx.productEvent.create({
      data: { productId: product.id, action: "funds_locked" },
    });
    return p;
  });

  return c.json(updatedProduct);
});
