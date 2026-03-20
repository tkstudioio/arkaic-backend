import { type AuthEnv, bearerAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Hono } from "hono";

export const favorites = new Hono<AuthEnv>();

favorites.use(bearerAuth);

favorites.get("/", async (c) => {
  const pubkey = c.get("pubkey");
  const take = Math.min(Number(c.req.query("limit")) || 20, 100);
  const skip = Number(c.req.query("offset")) || 0;

  const [favs, total] = await Promise.all([
    prisma.favorite.findMany({
      where: { accountPubkey: pubkey },
      include: {
        listing: {
          include: {
            seller: true,
            category: true,
            attributes: {
              include: {
                attribute: true,
                value: true,
                multiValues: { include: { value: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    }),
    prisma.favorite.count({ where: { accountPubkey: pubkey } }),
  ]);

  return c.json({ favorites: favs, total });
});

favorites.post("/:listingId", async (c) => {
  const pubkey = c.get("pubkey");
  const listingId = Number(c.req.param("listingId"));

  if (isNaN(listingId)) return c.text("Invalid listingId", 400);

  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) return c.text("Listing not found", 404);

  if (listing.sellerPubkey === pubkey) {
    return c.text("Cannot favorite your own listing", 400);
  }

  const favorite = await prisma.favorite.upsert({
    where: { accountPubkey_listingId: { accountPubkey: pubkey, listingId } },
    create: { accountPubkey: pubkey, listingId },
    update: {},
  });

  return c.json(favorite, 201);
});

favorites.delete("/:listingId", async (c) => {
  const pubkey = c.get("pubkey");
  const listingId = Number(c.req.param("listingId"));

  if (isNaN(listingId)) return c.text("Invalid listingId", 400);

  await prisma.favorite.deleteMany({
    where: { accountPubkey: pubkey, listingId },
  });

  return c.json({ deleted: true });
});
