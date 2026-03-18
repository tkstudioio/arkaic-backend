import { arkProvider } from "@/lib/ark";
import { type AuthEnv, bearerAuth, verifySignature } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
});

async function validateAttributes(
  attributeInputs: z.infer<typeof attributeInputSchema>[],
  categoryId: number,
) {
  const seenIds = new Set<number>();
  for (const input of attributeInputs) {
    if (seenIds.has(input.attributeId)) {
      return { error: `Duplicate attributeId ${input.attributeId} in attributes array` };
    }
    seenIds.add(input.attributeId);
  }

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) return { error: "Category not found" };

  const categoryAttrs = await prisma.categoryAttribute.findMany({
    where: { categoryId },
    include: { attribute: true },
  });

  for (const input of attributeInputs) {
    const attr = await prisma.attribute.findUnique({ where: { id: input.attributeId } });
    if (!attr) return { error: `Attribute ${input.attributeId} not found` };

    const catAttr = categoryAttrs.find((ca) => ca.attributeId === input.attributeId);
    if (!catAttr) {
      return { error: `Attribute '${attr.slug}' is not valid for category '${category.name}'` };
    }

    if (attr.type === "select") {
      if (input.valueId === undefined) {
        return { error: `Attribute '${attr.slug}' is a select type and requires a valueId` };
      }
      if (input.valueBool !== undefined) {
        return { error: `Attribute '${attr.slug}' is a select type and must not have valueBool` };
      }
      const attrValue = await prisma.attributeValue.findUnique({ where: { id: input.valueId } });
      if (!attrValue || attrValue.attributeId !== attr.id) {
        return { error: `valueId ${input.valueId} is not a valid value for attribute '${attr.slug}'` };
      }
    } else if (attr.type === "boolean") {
      if (input.valueBool === undefined) {
        return { error: `Attribute '${attr.slug}' is a boolean type and requires valueBool` };
      }
      if (input.valueId !== undefined) {
        return { error: `Attribute '${attr.slug}' is a boolean type and must not have valueId` };
      }
    }
  }

  const requiredAttrs = categoryAttrs.filter((ca) => ca.required);
  for (const req of requiredAttrs) {
    const provided = attributeInputs.find((a) => a.attributeId === req.attributeId);
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
    },
  },
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

      if (attributes && attributes.length > 0) {
        await tx.listingAttribute.createMany({
          data: attributes.map((attr) => ({
            listingId: listing.id,
            attributeId: attr.attributeId,
            valueId: attr.valueId ?? null,
            valueBool: attr.valueBool ?? null,
          })),
        });
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

      if (attributes && attributes.length > 0) {
        await tx.listingAttribute.createMany({
          data: attributes.map((attr) => ({
            listingId: id,
            attributeId: attr.attributeId,
            valueId: attr.valueId ?? null,
            valueBool: attr.valueBool ?? null,
          })),
        });
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

  const attributeFilters: { attributeId: number; valueIds?: number[]; valueBool?: boolean }[] = [];

  for (const [key, rawVal] of Object.entries(c.req.queries())) {
    const match = key.match(/^attr_(\d+)$/);
    if (!match || !rawVal) continue;
    const attributeId = Number(match[1]);
    const values = rawVal;

    if (values[0] === "true" || values[0] === "false") {
      attributeFilters.push({ attributeId, valueBool: values[0] === "true" });
    } else {
      attributeFilters.push({ attributeId, valueIds: values.map(Number).filter((n) => !isNaN(n)) });
    }
  }

  const attributeWhere =
    attributeFilters.length > 0
      ? {
          AND: attributeFilters.map((f) => ({
            attributes: {
              some: {
                attributeId: f.attributeId,
                ...(f.valueIds ? { valueId: { in: f.valueIds } } : {}),
                ...(f.valueBool !== undefined ? { valueBool: f.valueBool } : {}),
              },
            },
          })),
        }
      : {};

  const allListings = await prisma.listing.findMany({
    where: {
      sellerPubkey: { not: pubkey },
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...attributeWhere,
    },
    include: listingInclude,
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
    include: listingInclude,
  });

  return c.json(myListings);
});

listings.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.text("Invalid id", 400);

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      seller: true,
      category: { include: { parent: true } },
      attributes: {
        include: {
          attribute: true,
          value: true,
        },
      },
    },
  });

  if (!listing) return c.text("Listing not found", 404);

  return c.json(listing);
});
