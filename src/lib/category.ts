import type { PrismaClient } from "@/generated/prisma/client";

type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Returns the given categoryId plus all ancestor IDs up to the root.
 * Used to populate ListingCategory when a listing is created/updated.
 */
export async function collectAncestorIds(
  client: TxClient | PrismaClient,
  categoryId: number,
): Promise<number[]> {
  const ids: number[] = [categoryId];
  let currentId: number | null = categoryId;

  while (currentId !== null) {
    const cat: { childrenOf: number | null } | null = await client.category.findUnique({
      where: { id: currentId },
      select: { childrenOf: true },
    });
    if (!cat || cat.childrenOf === null) break;
    ids.push(cat.childrenOf);
    currentId = cat.childrenOf ?? null;
  }

  return ids;
}
