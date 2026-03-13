import { arkProvider } from "@/lib/ark";
import { type AuthEnv, bearerAuth, verifySignature } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sValidator } from "@hono/standard-validator";
import { Hono } from "hono";
import z from "zod";

export const listings = new Hono<AuthEnv>();

listings.use(bearerAuth);

listings.post(
  "/",
  verifySignature,
  sValidator(
    "json",
    z.object({ name: z.string().min(3), price: z.number().min(100) }),
  ),
  async (c) => {
    const { dust } = await arkProvider.getInfo();
    const sellerPubkey = c.get("pubkey");
    const signature = c.get("signature");

    const listing = c.req.valid("json");

    if (listing.price <= dust)
      return c.text(
        "Product price can't be less than ark provider's dust fee.",
        400,
      );

    const newListing = await prisma.listing.create({
      data: { ...listing, sellerPubkey, signature },
    });

    return c.json(newListing);
  },
);

listings.get("/", async (c) => {
  const loggerPubkey = c.get("pubkey");

  const listings = await prisma.listing.findMany({
    where: {
      sellerPubkey: { not: loggerPubkey },
    },
    include: { seller: true },
  });

  return c.json(listings);
});

listings.get("/my-listings", async (c) => {
  const loggerPubkey = c.get("pubkey");

  const myListings = await prisma.listing.findMany({
    where: { sellerPubkey: loggerPubkey },
    include: { seller: true },
  });

  return c.json(myListings);
});

listings.get("/:id", async (c) => {
  const id = c.req.param("id");

  const listing = await prisma.listing.findUnique({
    where: { id: Number(id) },
    include: { seller: true },
  });

  if (!listing) return c.text("Listing not found", 404);

  return c.json(listing);
});
