import { Hono } from "hono";
import type { AuthEnv } from "@/lib/auth";
import { bearerAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const attributes = new Hono<AuthEnv>();

attributes.use(bearerAuth);

attributes.get("/", async (c) => {
  const allAttributes = await prisma.attribute.findMany({
    include: {
      values: { select: { id: true, value: true } },
    },
    orderBy: { id: "asc" },
  });
  return c.json(allAttributes);
});

attributes.get("/by-category/:categoryId", async (c) => {
  const categoryId = Number(c.req.param("categoryId"));
  if (isNaN(categoryId)) return c.text("Invalid categoryId", 400);

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) return c.text("Category not found", 404);

  const categoryAttributes = await prisma.categoryAttribute.findMany({
    where: { categoryId },
    include: {
      attribute: {
        include: {
          values: { select: { id: true, value: true } },
        },
      },
    },
    orderBy: { attribute: { name: "asc" } },
  });

  const result = categoryAttributes.map((ca) => ({
    attributeId: ca.attribute.id,
    name: ca.attribute.name,
    slug: ca.attribute.slug,
    type: ca.attribute.type,
    required: ca.required,
    isFilterable: ca.isFilterable,
    values: ca.attribute.values,
  }));

  return c.json(result);
});

attributes.get("/filters/:categoryId", async (c) => {
  const categoryId = Number(c.req.param("categoryId"));
  if (isNaN(categoryId)) return c.text("Invalid categoryId", 400);

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) return c.text("Category not found", 404);

  const filterableAttrs = await prisma.categoryAttribute.findMany({
    where: { categoryId, isFilterable: true },
    include: { attribute: true },
  });

  const filters = [];

  for (const ca of filterableAttrs) {
    if (ca.attribute.type === "select") {
      const usedValues = await prisma.listingAttribute.findMany({
        where: {
          attributeId: ca.attributeId,
          valueId: { not: null },
          listing: { categoryId },
        },
        select: { value: { select: { id: true, value: true } } },
        distinct: ["valueId"],
      });

      const mappedValues = usedValues.map((uv) => uv.value).filter(Boolean);
      if (mappedValues.length > 0) {
        filters.push({
          attributeId: ca.attribute.id,
          name: ca.attribute.name,
          slug: ca.attribute.slug,
          type: ca.attribute.type,
          values: mappedValues,
        });
      }
    } else if (ca.attribute.type === "boolean") {
      const count = await prisma.listingAttribute.count({
        where: {
          attributeId: ca.attributeId,
          listing: { categoryId },
        },
      });

      if (count > 0) {
        filters.push({
          attributeId: ca.attribute.id,
          name: ca.attribute.name,
          slug: ca.attribute.slug,
          type: ca.attribute.type,
          values: null,
        });
      }
    }
  }

  return c.json(filters);
});
