import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { readFileSync } from "fs";
import { resolve } from "path";

const adapter = new PrismaBetterSqlite3({
  url: process.env["DATABASE_URL"] ?? "file:./dev.db",
});

const prisma = new PrismaClient({ adapter });

// ========================
// JSON TYPES
// ========================

interface JsonAttributeRef {
  slug: string;
  required?: boolean;
  isFilterable?: boolean;
}

interface JsonCategory {
  name: string;
  slug: string;
  attributes?: JsonAttributeRef[];
  children?: JsonCategory[];
}

interface JsonAttribute {
  name: string;
  slug: string;
  type: "select" | "boolean" | "text" | "range" | "date" | "multi_select";
  values?: string[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

interface MarketplaceData {
  categories: JsonCategory[];
  attributes: JsonAttribute[];
}

// ========================
// HELPERS
// ========================

async function upsertCategory(name: string, slug: string, parentId?: number) {
  return prisma.category.upsert({
    where: { slug },
    update: { name, childrenOf: parentId ?? null },
    create: { name, slug, childrenOf: parentId ?? null },
  });
}

async function upsertAttribute(attr: JsonAttribute) {
  return prisma.attribute.upsert({
    where: { slug: attr.slug },
    update: {
      name: attr.name,
      type: attr.type,
      rangeMin: attr.min ?? null,
      rangeMax: attr.max ?? null,
      rangeStep: attr.step ?? null,
      rangeUnit: attr.unit ?? null,
    },
    create: {
      name: attr.name,
      slug: attr.slug,
      type: attr.type,
      rangeMin: attr.min ?? null,
      rangeMax: attr.max ?? null,
      rangeStep: attr.step ?? null,
      rangeUnit: attr.unit ?? null,
    },
  });
}

async function upsertAttributeValue(attributeId: number, value: string) {
  const existing = await prisma.attributeValue.findFirst({
    where: { attributeId, value },
  });
  if (existing) return existing;
  return prisma.attributeValue.create({ data: { attributeId, value } });
}

async function linkCategoryAttribute(
  categoryId: number,
  attributeId: number,
  options: { required?: boolean; isFilterable?: boolean } = {},
) {
  return prisma.categoryAttribute.upsert({
    where: { categoryId_attributeId: { categoryId, attributeId } },
    update: {
      required: options.required ?? false,
      isFilterable: options.isFilterable ?? true,
    },
    create: {
      categoryId,
      attributeId,
      required: options.required ?? false,
      isFilterable: options.isFilterable ?? true,
    },
  });
}

// ========================
// RECURSIVE CATEGORY SEED
// ========================

async function seedCategories(
  categories: JsonCategory[],
  attributeMap: Map<string, number>,
  parentId?: number,
) {
  for (const cat of categories) {
    const created = await upsertCategory(cat.name, cat.slug, parentId);

    if (cat.attributes) {
      for (const attrRef of cat.attributes) {
        const attributeId = attributeMap.get(attrRef.slug);
        if (!attributeId) {
          console.warn(`  Warning: attribute slug "${attrRef.slug}" not found, skipping`);
          continue;
        }
        await linkCategoryAttribute(created.id, attributeId, {
          required: attrRef.required ?? false,
          isFilterable: attrRef.isFilterable ?? true,
        });
      }
    }

    if (cat.children?.length) {
      await seedCategories(cat.children, attributeMap, created.id);
    }
  }
}

// ========================
// MAIN
// ========================

async function main() {
  console.log("Starting seed...");

  const dataPath = resolve(process.cwd(), "data/marketplace.json");
  const data: MarketplaceData = JSON.parse(readFileSync(dataPath, "utf-8"));

  // Seed attributes and build slug → id map
  const attributeMap = new Map<string, number>();

  for (const attr of data.attributes) {
    const created = await upsertAttribute(attr);
    attributeMap.set(attr.slug, created.id);

    if (attr.values) {
      for (const value of attr.values) {
        await upsertAttributeValue(created.id, value);
      }
    }
  }

  console.log(`Seeded ${data.attributes.length} attributes`);

  // Seed categories recursively
  await seedCategories(data.categories, attributeMap);

  const categoryCount = await prisma.category.count();
  console.log(`Seed completed: ${categoryCount} categories, ${data.attributes.length} attributes`);
}

// ========================
// EXECUTION
// ========================

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
