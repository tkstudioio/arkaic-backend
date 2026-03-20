import { arkProvider } from "@/lib/ark";
import { type AuthEnv, bearerAuth, verifySignature } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { collectAncestorIds } from "@/lib/category";
import { Prisma } from "@/generated/prisma/client";
import { sValidator } from "@hono/standard-validator";
import { Hono } from "hono";
import z from "zod";

export const listings = new Hono<AuthEnv>();

listings.use(bearerAuth);

const attributeInputSchema = z.object({
  attributeId: z.number().int().positive(),
  valueId: z.number().int().positive().optional(),
  valueBool: z.boolean().optional(),
  valueText: z.string().optional(),
  valueIds: z.array(z.number().int().positive()).min(1).optional(),
});

async function validateAttributes(
  attributeInputs: z.infer<typeof attributeInputSchema>[],
  categoryId: number,
) {
  const seenIds = new Set<number>();
  for (const input of attributeInputs) {
    if (seenIds.has(input.attributeId)) {
      return {
        error: `Duplicate attributeId ${input.attributeId} in attributes array`,
      };
    }
    seenIds.add(input.attributeId);
  }

  const category = await prisma.category.findUnique({
    where: { id: categoryId },
  });
  if (!category) return { error: "Category not found" };

  const categoryAttrs = await prisma.categoryAttribute.findMany({
    where: { categoryId },
    include: { attribute: true },
  });

  for (const input of attributeInputs) {
    const attr = await prisma.attribute.findUnique({
      where: { id: input.attributeId },
    });
    if (!attr) return { error: `Attribute ${input.attributeId} not found` };

    const catAttr = categoryAttrs.find(
      (ca) => ca.attributeId === input.attributeId,
    );
    if (!catAttr) {
      return {
        error: `Attribute '${attr.slug}' is not valid for category '${category.name}'`,
      };
    }

    if (attr.type === "select") {
      if (input.valueId === undefined) {
        return {
          error: `Attribute '${attr.slug}' is a select type and requires a valueId`,
        };
      }
      if (input.valueBool !== undefined || input.valueIds !== undefined) {
        return {
          error: `Attribute '${attr.slug}' is a select type and must not have valueBool or valueIds`,
        };
      }
      const attrValue = await prisma.attributeValue.findUnique({
        where: { id: input.valueId },
      });
      if (!attrValue || attrValue.attributeId !== attr.id) {
        return {
          error: `valueId ${input.valueId} is not a valid value for attribute '${attr.slug}'`,
        };
      }
    } else if (attr.type === "boolean") {
      if (input.valueBool === undefined) {
        return {
          error: `Attribute '${attr.slug}' is a boolean type and requires valueBool`,
        };
      }
      if (input.valueId !== undefined || input.valueIds !== undefined) {
        return {
          error: `Attribute '${attr.slug}' is a boolean type and must not have valueId or valueIds`,
        };
      }
    } else if (attr.type === "text") {
      if (input.valueText === undefined || input.valueText.trim() === "") {
        return {
          error: `Attribute '${attr.slug}' is a text type and requires valueText`,
        };
      }
      if (
        input.valueId !== undefined ||
        input.valueBool !== undefined ||
        input.valueIds !== undefined
      ) {
        return {
          error: `Attribute '${attr.slug}' is a text type and must not have valueId, valueBool, or valueIds`,
        };
      }
    } else if (attr.type === "range") {
      if (input.valueText === undefined || input.valueText.trim() === "") {
        return {
          error: `Attribute '${attr.slug}' is a range type and requires valueText`,
        };
      }
      const numericValue = Number(input.valueText);
      if (isNaN(numericValue)) {
        return {
          error: `Attribute '${attr.slug}' requires a numeric valueText`,
        };
      }
      if (
        attr.rangeMin !== null &&
        attr.rangeMin !== undefined &&
        numericValue < attr.rangeMin
      ) {
        return {
          error: `Attribute '${attr.slug}' value must be >= ${attr.rangeMin}`,
        };
      }
      if (
        attr.rangeMax !== null &&
        attr.rangeMax !== undefined &&
        numericValue > attr.rangeMax
      ) {
        return {
          error: `Attribute '${attr.slug}' value must be <= ${attr.rangeMax}`,
        };
      }
      if (
        input.valueId !== undefined ||
        input.valueBool !== undefined ||
        input.valueIds !== undefined
      ) {
        return {
          error: `Attribute '${attr.slug}' is a range type and must only have valueText`,
        };
      }
    } else if (attr.type === "date") {
      if (input.valueText === undefined || input.valueText.trim() === "") {
        return {
          error: `Attribute '${attr.slug}' is a date type and requires valueText`,
        };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.valueText)) {
        return {
          error: `Attribute '${attr.slug}' requires an ISO date (YYYY-MM-DD) in valueText`,
        };
      }
      const parsed = new Date(input.valueText);
      if (isNaN(parsed.getTime())) {
        return {
          error: `Attribute '${attr.slug}' has an invalid date in valueText`,
        };
      }
      if (
        input.valueId !== undefined ||
        input.valueBool !== undefined ||
        input.valueIds !== undefined
      ) {
        return {
          error: `Attribute '${attr.slug}' is a date type and must only have valueText`,
        };
      }
    } else if (attr.type === "multi_select") {
      if (!input.valueIds || input.valueIds.length === 0) {
        return {
          error: `Attribute '${attr.slug}' is a multi_select type and requires valueIds`,
        };
      }
      if (
        input.valueId !== undefined ||
        input.valueBool !== undefined ||
        input.valueText !== undefined
      ) {
        return {
          error: `Attribute '${attr.slug}' is a multi_select type and must only have valueIds`,
        };
      }
      if (new Set(input.valueIds).size !== input.valueIds.length) {
        return { error: `Attribute '${attr.slug}' has duplicate valueIds` };
      }
      for (const vid of input.valueIds) {
        const attrValue = await prisma.attributeValue.findUnique({
          where: { id: vid },
        });
        if (!attrValue || attrValue.attributeId !== attr.id) {
          return {
            error: `valueId ${vid} is not a valid value for attribute '${attr.slug}'`,
          };
        }
      }
    }
  }

  const requiredAttrs = categoryAttrs.filter((ca) => ca.required);
  for (const req of requiredAttrs) {
    const provided = attributeInputs.find(
      (a) => a.attributeId === req.attributeId,
    );
    if (!provided) {
      return { error: `Required attribute '${req.attribute.name}' is missing` };
    }
  }

  return { error: null };
}

const listingInclude = {
  seller: true,
  category: true,
  attributes: {
    include: {
      attribute: true,
      value: true,
      multiValues: {
        include: { value: true },
      },
    },
  },
  _count: { select: { favorites: true } },
} as const;

listings.post(
  "/",
  verifySignature,
  sValidator(
    "json",
    z.object({
      name: z.string().min(3),
      price: z.number().min(100),
      description: z.string().min(12).optional(),
      categoryId: z.number().int().positive().optional(),
      attributes: z.array(attributeInputSchema).optional(),
    }),
  ),
  async (c) => {
    const { dust } = await arkProvider.getInfo();
    const sellerPubkey = c.get("pubkey");
    const signature = c.get("signature")!;

    const { name, price, description, categoryId, attributes } = c.req.valid("json");

    if (price <= dust)
      return c.text(
        "Product price can't be less than ark provider's dust fee.",
        400,
      );

    if (attributes !== undefined && categoryId === undefined) {
      return c.text("categoryId is required when attributes are provided", 400);
    }

    if (categoryId !== undefined) {
      const cat = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!cat) return c.text("Category not found", 404);
    }

    if (attributes !== undefined && categoryId !== undefined) {
      const validation = await validateAttributes(attributes, categoryId);
      if (validation.error) return c.text(validation.error, 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const listing = await tx.listing.create({
        data: { name, price, description, sellerPubkey, signature, categoryId },
      });

      if (categoryId !== undefined) {
        const ancestorIds = await collectAncestorIds(tx, categoryId);
        await tx.listingCategory.createMany({
          data: ancestorIds.map((cid) => ({ listingId: listing.id, categoryId: cid })),
        });
      }

      if (attributes && attributes.length > 0) {
        await tx.listingAttribute.createMany({
          data: attributes.map((attr) => ({
            listingId: listing.id,
            attributeId: attr.attributeId,
            valueId: attr.valueId ?? null,
            valueBool: attr.valueBool ?? null,
            valueText: attr.valueText ?? null,
            valueFloat: attr.valueText ? Number(attr.valueText) || null : null,
          })),
        });

        const multiSelectInputs = attributes.filter((a) => a.valueIds && a.valueIds.length > 0);
        if (multiSelectInputs.length > 0) {
          const createdLAs = await tx.listingAttribute.findMany({
            where: {
              listingId: listing.id,
              attributeId: { in: multiSelectInputs.map((a) => a.attributeId) },
            },
          });

          const laMap = new Map(createdLAs.map((la) => [la.attributeId, la.id]));

          const multiValueRows: { listingAttributeId: number; valueId: number }[] = [];
          for (const input of multiSelectInputs) {
            const laId = laMap.get(input.attributeId);
            if (!laId) continue;
            for (const vid of input.valueIds!) {
              multiValueRows.push({ listingAttributeId: laId, valueId: vid });
            }
          }

          await tx.listingAttributeValue.createMany({ data: multiValueRows });
        }
      }

      return tx.listing.findUnique({
        where: { id: listing.id },
        include: listingInclude,
      });
    });

    return c.json(result, 201);
  },
);

listings.patch(
  "/:id",
  verifySignature,
  sValidator(
    "json",
    z.object({
      name: z.string().min(3).optional(),
      price: z.number().min(100).optional(),
      description: z.string().min(12).optional(),
      categoryId: z.number().int().positive().nullable().optional(),
      attributes: z.array(attributeInputSchema).optional(),
    }),
  ),
  async (c) => {
    const pubkey = c.get("pubkey");
    const signature = c.get("signature")!;
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return c.text("Invalid id", 400);
    const { name, price, description, categoryId, attributes } = c.req.valid("json");

    const listing = await prisma.listing.findFirst({
      where: { id, sellerPubkey: pubkey },
    });

    if (!listing) return c.text("Listing not found", 404);

    const activeEscrow = await prisma.escrow.findFirst({
      where: {
        chat: { listingId: id },
        status: { notIn: ["completed", "refunded"] },
      },
    });

    if (activeEscrow) {
      return c.json(
        { error: "Cannot modify a listing with an active escrow" },
        409,
      );
    }

    if (price !== undefined) {
      const { dust } = await arkProvider.getInfo();
      if (price <= dust)
        return c.text(
          "Product price can't be less than ark provider's dust fee.",
          400,
        );
    }

    if (categoryId !== undefined && categoryId !== null) {
      const cat = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!cat) return c.text("Category not found", 404);
    }

    const effectiveCategoryId =
      categoryId !== undefined ? categoryId : listing.categoryId;

    if (attributes && attributes.length > 0) {
      if (!effectiveCategoryId) {
        return c.text("categoryId is required when attributes are provided", 400);
      }
      const validation = await validateAttributes(attributes, effectiveCategoryId);
      if (validation.error) return c.text(validation.error, 400);
    }

    const updateData: Prisma.ListingUncheckedUpdateInput = { signature };
    if (name !== undefined) updateData.name = name;
    if (price !== undefined) updateData.price = price;
    if (description !== undefined) updateData.description = description;
    if (categoryId !== undefined) updateData.categoryId = categoryId;

    const updated = await prisma.$transaction(async (tx) => {
      if (categoryId !== undefined || attributes !== undefined) {
        await tx.listingAttribute.deleteMany({ where: { listingId: id } });
      }

      await tx.listing.update({
        where: { id },
        data: updateData,
      });

      if (categoryId !== undefined) {
        await tx.listingCategory.deleteMany({ where: { listingId: id } });
        if (categoryId !== null) {
          const ancestorIds = await collectAncestorIds(tx, categoryId);
          await tx.listingCategory.createMany({
            data: ancestorIds.map((cid) => ({ listingId: id, categoryId: cid })),
          });
        }
      }

      if (attributes && attributes.length > 0) {
        await tx.listingAttribute.createMany({
          data: attributes.map((attr) => ({
            listingId: id,
            attributeId: attr.attributeId,
            valueId: attr.valueId ?? null,
            valueBool: attr.valueBool ?? null,
            valueText: attr.valueText ?? null,
            valueFloat: attr.valueText ? Number(attr.valueText) || null : null,
          })),
        });

        const multiSelectInputs = attributes.filter((a) => a.valueIds && a.valueIds.length > 0);
        if (multiSelectInputs.length > 0) {
          const createdLAs = await tx.listingAttribute.findMany({
            where: {
              listingId: id,
              attributeId: { in: multiSelectInputs.map((a) => a.attributeId) },
            },
          });

          const laMap = new Map(createdLAs.map((la) => [la.attributeId, la.id]));

          const multiValueRows: { listingAttributeId: number; valueId: number }[] = [];
          for (const input of multiSelectInputs) {
            const laId = laMap.get(input.attributeId);
            if (!laId) continue;
            for (const vid of input.valueIds!) {
              multiValueRows.push({ listingAttributeId: laId, valueId: vid });
            }
          }

          await tx.listingAttributeValue.createMany({ data: multiValueRows });
        }
      }

      return tx.listing.findUnique({
        where: { id },
        include: listingInclude,
      });
    });

    return c.json(updated);
  },
);

listings.get("/", async (c) => {
  const pubkey = c.get("pubkey");
  const take = Math.min(Number(c.req.query("limit")) || 20, 100);
  const skip = Number(c.req.query("offset")) || 0;

  const categoryIdParam = c.req.query("categoryId");
  const categoryId =
    categoryIdParam !== undefined ? Number(categoryIdParam) : undefined;

  const minPriceParam = c.req.query("minPrice");
  const minPrice = minPriceParam !== undefined ? Number(minPriceParam) : undefined;
  const maxPriceParam = c.req.query("maxPrice");
  const maxPrice = maxPriceParam !== undefined ? Number(maxPriceParam) : undefined;

  if (minPrice !== undefined && (isNaN(minPrice) || minPrice < 0)) {
    return c.text("Invalid minPrice", 400);
  }
  if (maxPrice !== undefined && (isNaN(maxPrice) || maxPrice <= 0)) {
    return c.text("Invalid maxPrice", 400);
  }
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    return c.text("minPrice cannot exceed maxPrice", 400);
  }

  const search = c.req.query("search")?.trim() || undefined;
  const sortParam = c.req.query("sort") || "newest";

  const allowedSortValues = ["price_asc", "price_desc", "newest", "oldest"] as const;
  if (!(allowedSortValues as readonly string[]).includes(sortParam)) {
    return c.text("Invalid sort value", 400);
  }

  const attributeFilters: {
    attributeId: number;
    valueIds?: number[];
    valueBool?: boolean;
    rangeMin?: number;
    rangeMax?: number;
  }[] = [];

  for (const [key, rawVal] of Object.entries(c.req.queries())) {
    const match = key.match(/^attr_(\d+)$/);
    if (!match || !rawVal) continue;
    const attributeId = Number(match[1]);
    const values = rawVal;

    if (values[0] === "true" || values[0] === "false") {
      attributeFilters.push({ attributeId, valueBool: values[0] === "true" });
    } else if (values[0]?.includes(",")) {
      const [minStr, maxStr] = values[0].split(",");
      const rangeMin = minStr ? Number(minStr) : undefined;
      const rangeMax = maxStr ? Number(maxStr) : undefined;
      attributeFilters.push({ attributeId, rangeMin, rangeMax });
    } else {
      attributeFilters.push({ attributeId, valueIds: values.map(Number).filter((n) => !isNaN(n)) });
    }
  }

  const where: Prisma.ListingWhereInput = {
    sellerPubkey: { not: pubkey },
  };

  let categoryIds: number[] | undefined;
  if (categoryId !== undefined) {
    // Filter via the denormalized ListingCategory ancestry index.
    // The join table already contains all ancestor IDs for each listing,
    // so a single categoryId match is sufficient for full subtree coverage.
    where.categories = { some: { categoryId } };
    // categoryIds is still needed for attribute filter validation below
    categoryIds = [categoryId];
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    where.price = {};
    if (minPrice !== undefined) (where.price as Prisma.IntFilter).gte = minPrice;
    if (maxPrice !== undefined) (where.price as Prisma.IntFilter).lte = maxPrice;
  }

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
    ];
  }

  if (attributeFilters.length > 0) {
    if (categoryId === undefined) {
      return c.text("categoryId is required when using attribute filters", 400);
    }

    const filterableCategoryAttrs = await prisma.categoryAttribute.findMany({
      where: {
        categoryId: { in: categoryIds },
        isFilterable: true,
      },
      select: { attributeId: true },
    });
    const filterableAttrIds = new Set(filterableCategoryAttrs.map((ca) => ca.attributeId));

    for (const f of attributeFilters) {
      if (!filterableAttrIds.has(f.attributeId)) {
        return c.text(`Attribute ${f.attributeId} is not filterable for category ${categoryId}`, 400);
      }
    }

    where.AND = attributeFilters.map((f) => {
      if (f.rangeMin !== undefined || f.rangeMax !== undefined) {
        return {
          attributes: {
            some: {
              attributeId: f.attributeId,
              ...(f.rangeMin !== undefined ? { valueFloat: { gte: f.rangeMin } } : {}),
              ...(f.rangeMax !== undefined ? { valueFloat: { lte: f.rangeMax } } : {}),
            },
          },
        };
      }

      if (f.valueIds) {
        return {
          attributes: {
            some: {
              attributeId: f.attributeId,
              OR: [
                { valueId: { in: f.valueIds } },
                { multiValues: { some: { valueId: { in: f.valueIds } } } },
              ],
            },
          },
        };
      }

      if (f.valueBool !== undefined) {
        return {
          attributes: {
            some: {
              attributeId: f.attributeId,
              valueBool: f.valueBool,
            },
          },
        };
      }

      return {};
    });
  }

  const orderByMap: Record<string, Prisma.ListingOrderByWithRelationInput> = {
    price_asc: { price: "asc" },
    price_desc: { price: "desc" },
    newest: { id: "desc" },
    oldest: { id: "asc" },
  };
  const orderBy = orderByMap[sortParam];

  const [allListings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      include: listingInclude,
      take,
      skip,
      orderBy,
    }),
    prisma.listing.count({ where }),
  ]);

  const favoritedListingIds = new Set(
    (
      await prisma.favorite.findMany({
        where: { accountPubkey: pubkey, listingId: { in: allListings.map((l) => l.id) } },
        select: { listingId: true },
      })
    ).map((f) => f.listingId),
  );

  const listingsWithFav = allListings.map((l) => ({
    ...l,
    isFavorited: favoritedListingIds.has(l.id),
  }));

  return c.json({ listings: listingsWithFav, total });
});

listings.get("/my-listings", async (c) => {
  const pubkey = c.get("pubkey");

  const myListings = await prisma.listing.findMany({
    where: { sellerPubkey: pubkey },
    include: listingInclude,
  });

  return c.json({ listings: myListings, total: myListings.length });
});

listings.get("/:id", async (c) => {
  const pubkey = c.get("pubkey");
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.text("Invalid id", 400);

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      seller: true,
      category: { include: { parent: true } },
      chats: { include: { escrow: { select: { status: true } } } },
      attributes: {
        include: {
          attribute: true,
          value: true,
          multiValues: {
            include: { value: true },
          },
        },
      },
      _count: { select: { favorites: true } },
    },
  });

  if (!listing) return c.text("Listing not found", 404);

  const fav = await prisma.favorite.findUnique({
    where: { accountPubkey_listingId: { accountPubkey: pubkey, listingId: id } },
  });

  return c.json({ ...listing, isFavorited: !!fav });
});
