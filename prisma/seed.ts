import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({
  url: process.env["DATABASE_URL"] ?? "file:./dev.db",
});

const prisma = new PrismaClient({ adapter });

async function createCategory(name: string, slug: string, parentId?: number) {
  return prisma.category.upsert({
    where: { slug },
    update: { name, childrenOf: parentId ?? null },
    create: {
      name,
      slug,
      childrenOf: parentId ?? null,
    },
  });
}

async function main() {
  // Remove old orphaned slugs from previous taxonomy
  await prisma.category.deleteMany({
    where: {
      slug: {
        in: [
          // old unisex root + subcategories
          "unisex",
          "unisex-streetwear",
          "unisex-vintage",
          "unisex-activewear",
          "unisex-loungewear",
          "unisex-basics",
          // old flat women nodes replaced by granular ones
          "women-shoes",
          "women-bags",
          "women-accessories",
          "women-knitwear",
          "women-hoodies",
          "women-jackets-coats",
          "women-lingerie",
          "women-trousers",
          // old flat men nodes replaced by granular ones
          "men-shoes",
          "men-bags-backpacks",
          "men-accessories",
          "men-knitwear",
          "men-hoodies",
          "men-jackets-coats",
          "men-tracksuits",
          "men-underwear",
          "men-trousers",
          // old flat kids nodes replaced
          "kids-0-2",
          "kids-3-12",
          "kids-shoes",
          "kids-accessories",
          "kids-swimwear",
          "kids-sportswear",
        ],
      },
    },
  });

  // ===== ROOT CATEGORIES =====
  const women = await createCategory("Women", "women");
  const men = await createCategory("Men", "men");
  const kids = await createCategory("Kids", "kids");

  // ===== WOMEN — Clothing =====
  for (const [name, slug] of [
    ["Dresses", "dresses"],
    ["Tops & T-shirts", "tops-tshirts"],
    ["Shirts & Blouses", "shirts-blouses"],
    ["Knitwear & Cardigans", "knitwear"],
    ["Sweatshirts & Hoodies", "sweatshirts-hoodies"],
    ["Jackets & Blazers", "jackets-blazers"],
    ["Coats & Trench Coats", "coats"],
    ["Trousers & Leggings", "trousers-leggings"],
    ["Jeans", "jeans"],
    ["Skirts", "skirts"],
    ["Shorts", "shorts"],
    ["Jumpsuits & Playsuits", "jumpsuits"],
    ["Sportswear", "sportswear"],
    ["Underwear & Nightwear", "underwear-nightwear"],
    ["Swimwear", "swimwear"],
    ["Socks & Tights", "socks-tights"],
  ]) {
    await createCategory(name, `women-${slug}`, women.id);
  }

  // ===== WOMEN — Shoes =====
  for (const [name, slug] of [
    ["Sneakers", "shoes-sneakers"],
    ["Boots", "shoes-boots"],
    ["Ankle Boots", "shoes-ankle-boots"],
    ["Heels & Formal Shoes", "shoes-heels"],
    ["Sandals & Flip Flops", "shoes-sandals"],
    ["Loafers & Ballet Flats", "shoes-loafers"],
    ["Sport Shoes", "shoes-sport"],
  ]) {
    await createCategory(name, `women-${slug}`, women.id);
  }

  // ===== WOMEN — Bags =====
  for (const [name, slug] of [
    ["Handbags", "bags-handbags"],
    ["Shoulder & Crossbody Bags", "bags-shoulder-crossbody"],
    ["Backpacks", "bags-backpacks"],
    ["Clutches & Evening Bags", "bags-clutches"],
    ["Tote Bags", "bags-totes"],
  ]) {
    await createCategory(name, `women-${slug}`, women.id);
  }

  // ===== WOMEN — Accessories =====
  for (const [name, slug] of [
    ["Belts", "accessories-belts"],
    ["Sunglasses", "accessories-sunglasses"],
    ["Hats & Caps", "accessories-hats"],
    ["Scarves", "accessories-scarves"],
    ["Jewellery", "accessories-jewellery"],
    ["Watches", "accessories-watches"],
    ["Gloves", "accessories-gloves"],
  ]) {
    await createCategory(name, `women-${slug}`, women.id);
  }

  // ===== MEN — Clothing =====
  for (const [name, slug] of [
    ["T-shirts & Polo", "tshirts-polo"],
    ["Shirts", "shirts"],
    ["Knitwear", "knitwear"],
    ["Sweatshirts & Hoodies", "sweatshirts-hoodies"],
    ["Jackets & Blazers", "jackets-blazers"],
    ["Coats", "coats"],
    ["Trousers & Chinos", "trousers-chinos"],
    ["Jeans", "jeans"],
    ["Shorts", "shorts"],
    ["Cargo Pants", "cargo-pants"],
    ["Tracksuits & Joggers", "tracksuits-joggers"],
    ["Suits & Tailoring", "suits-tailoring"],
    ["Sportswear", "sportswear"],
    ["Underwear & Socks", "underwear-socks"],
    ["Swimwear", "swimwear"],
  ]) {
    await createCategory(name, `men-${slug}`, men.id);
  }

  // ===== MEN — Shoes =====
  for (const [name, slug] of [
    ["Sneakers", "shoes-sneakers"],
    ["Boots", "shoes-boots"],
    ["Formal Shoes", "shoes-formal"],
    ["Loafers & Moccasins", "shoes-loafers"],
    ["Sandals", "shoes-sandals"],
    ["Sport Shoes", "shoes-sport"],
  ]) {
    await createCategory(name, `men-${slug}`, men.id);
  }

  // ===== MEN — Bags =====
  for (const [name, slug] of [
    ["Backpacks", "bags-backpacks"],
    ["Shoulder & Crossbody Bags", "bags-shoulder-crossbody"],
    ["Briefcases", "bags-briefcases"],
    ["Holdalls & Travel Bags", "bags-holdalls"],
  ]) {
    await createCategory(name, `men-${slug}`, men.id);
  }

  // ===== MEN — Accessories =====
  for (const [name, slug] of [
    ["Belts", "accessories-belts"],
    ["Sunglasses", "accessories-sunglasses"],
    ["Hats & Caps", "accessories-hats"],
    ["Scarves", "accessories-scarves"],
    ["Watches", "accessories-watches"],
    ["Wallets", "accessories-wallets"],
    ["Gloves", "accessories-gloves"],
    ["Ties & Bow Ties", "accessories-ties"],
  ]) {
    await createCategory(name, `men-${slug}`, men.id);
  }

  // ===== KIDS — Baby (0-2 years) =====
  for (const [name, slug] of [
    ["Baby Bodysuits & Onesies", "baby-bodysuits"],
    ["Baby Sets & Outfits", "baby-sets"],
    ["Baby Shoes", "baby-shoes"],
    ["Baby Accessories", "baby-accessories"],
  ]) {
    await createCategory(name, `kids-${slug}`, kids.id);
  }

  // ===== KIDS — Girls (2-14 years) =====
  for (const [name, slug] of [
    ["Girls Dresses & Skirts", "girls-dresses-skirts"],
    ["Girls Tops & T-shirts", "girls-tops-tshirts"],
    ["Girls Trousers & Jeans", "girls-trousers-jeans"],
    ["Girls Jackets & Coats", "girls-jackets-coats"],
    ["Girls Sportswear", "girls-sportswear"],
    ["Girls Swimwear", "girls-swimwear"],
    ["Girls Shoes", "girls-shoes"],
    ["Girls Accessories", "girls-accessories"],
  ]) {
    await createCategory(name, `kids-${slug}`, kids.id);
  }

  // ===== KIDS — Boys (2-14 years) =====
  for (const [name, slug] of [
    ["Boys T-shirts & Shirts", "boys-tshirts-shirts"],
    ["Boys Trousers & Jeans", "boys-trousers-jeans"],
    ["Boys Shorts", "boys-shorts"],
    ["Boys Jackets & Coats", "boys-jackets-coats"],
    ["Boys Sportswear", "boys-sportswear"],
    ["Boys Swimwear", "boys-swimwear"],
    ["Boys Shoes", "boys-shoes"],
    ["Boys Accessories", "boys-accessories"],
  ]) {
    await createCategory(name, `kids-${slug}`, kids.id);
  }

  console.log("Seed completed: 3 roots, 88 subcategories");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
