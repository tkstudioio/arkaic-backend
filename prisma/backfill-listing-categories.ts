import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { collectAncestorIds } from "../src/lib/category";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./dev.db",
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const listings = await prisma.listing.findMany({
    where: { categoryId: { not: null } },
    select: { id: true, categoryId: true },
  });

  let count = 0;
  for (const listing of listings) {
    await prisma.$transaction(async (tx) => {
      const ancestorIds = await collectAncestorIds(tx, listing.categoryId!);
      await tx.listingCategory.deleteMany({ where: { listingId: listing.id } });
      await tx.listingCategory.createMany({
        data: ancestorIds.map((cid) => ({ listingId: listing.id, categoryId: cid })),
      });
    });
    count++;
  }

  console.log(`Backfilled ${count} listings.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
