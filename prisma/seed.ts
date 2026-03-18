import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: process.env["DATABASE_URL"] ?? "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  const clothing = await prisma.category.upsert({
    where: { slug: "clothing" },
    update: {},
    create: { name: "Clothing", slug: "clothing" },
  });
  const electronics = await prisma.category.upsert({
    where: { slug: "electronics" },
    update: {},
    create: { name: "Electronics", slug: "electronics" },
  });
  for (const [name, slug] of [
    ["Shoes", "shoes"],
    ["Bags", "bags"],
  ]) {
    await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { name, slug, childrenOf: clothing.id },
    });
  }
  for (const [name, slug] of [
    ["Phones", "phones"],
    ["Laptops", "laptops"],
  ]) {
    await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { name, slug, childrenOf: electronics.id },
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
