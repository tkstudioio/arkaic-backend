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
    z.object({
      name: z.string().min(3),
      price: z.number().min(100),
      categoryId: z.number().int().positive().optional(),
    }),
  ),
  async (c) => {
    const { dust } = await arkProvider.getInfo();
    const sellerPubkey = c.get("pubkey");
    const signature = c.get("signature")!;

    const { name, price, categoryId } = c.req.valid("json");

    if (price <= dust)
      return c.text(
        "Product price can't be less than ark provider's dust fee.",
        400,
      );

    if (categoryId !== undefined) {
      const cat = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!cat) return c.text("Category not found", 404);
    }

    const newListing = await prisma.listing.create({
      data: { name, price, sellerPubkey, signature, categoryId },
      include: { category: true },
    });

    return c.json(newListing);
  },
);

listings.get("/", async (c) => {
  const pubkey = c.get("pubkey");
  const take = Math.min(Number(c.req.query("limit")) || 20, 100);
  const skip = Number(c.req.query("offset")) || 0;
  const categoryIdParam = c.req.query("categoryId");
  const categoryId = categoryIdParam !== undefined ? Number(categoryIdParam) : undefined;

  const allListings = await prisma.listing.findMany({
    where: {
      sellerPubkey: { not: pubkey },
      ...(categoryId !== undefined ? { categoryId } : {}),
    },
    include: { seller: true, category: true },
    take,
    skip,
    orderBy: { id: "desc" },
  });

  return c.json(allListings);
});

listings.get("/my-listings", async (c) => {
  const pubkey = c.get("pubkey");

  const myListings = await prisma.listing.findMany({
    where: { sellerPubkey: pubkey },
    include: { seller: true, category: true },
  });

  return c.json(myListings);
});

listings.get("/:id", async (c) => {
  const id = c.req.param("id");

  const listing = await prisma.listing.findUnique({
    where: { id: Number(id) },
    include: { seller: true, category: true },
  });

  if (!listing) return c.text("Listing not found", 404);

  return c.json(listing);
});
