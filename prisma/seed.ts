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

async function createAttribute(name: string, slug: string, type: "select" | "boolean") {
  return prisma.attribute.upsert({
    where: { slug },
    update: { name, type },
    create: { name, slug, type },
  });
}

async function createAttributeValue(attributeId: number, value: string) {
  const existing = await prisma.attributeValue.findFirst({
    where: { attributeId, value },
  });
  if (existing) return existing;
  return prisma.attributeValue.create({
    data: { attributeId, value },
  });
}

async function linkCategoryAttribute(
  categoryId: number,
  attributeId: number,
  options: { required?: boolean; isFilterable?: boolean } = {}
) {
  return prisma.categoryAttribute.upsert({
    where: { categoryId_attributeId: { categoryId, attributeId } },
    update: { required: options.required ?? false, isFilterable: options.isFilterable ?? true },
    create: {
      categoryId,
      attributeId,
      required: options.required ?? false,
      isFilterable: options.isFilterable ?? true,
    },
  });
}

async function main() {
  // Remove old orphaned slugs from previous taxonomy
  // First delete CategoryAttribute records that reference these categories to avoid FK violations
  const orphanedSlugs = [
    "unisex",
    "unisex-streetwear",
    "unisex-vintage",
    "unisex-activewear",
    "unisex-loungewear",
    "unisex-basics",
    "women-shoes",
    "women-bags",
    "women-accessories",
    "women-knitwear",
    "women-hoodies",
    "women-jackets-coats",
    "women-lingerie",
    "women-trousers",
    "men-shoes",
    "men-bags-backpacks",
    "men-accessories",
    "men-knitwear",
    "men-hoodies",
    "men-jackets-coats",
    "men-tracksuits",
    "men-underwear",
    "men-trousers",
    "kids-0-2",
    "kids-3-12",
    "kids-shoes",
    "kids-accessories",
    "kids-swimwear",
    "kids-sportswear",
  ];
  const orphanedCategories = await prisma.category.findMany({
    where: { slug: { in: orphanedSlugs } },
    select: { id: true },
  });
  if (orphanedCategories.length > 0) {
    const orphanedIds = orphanedCategories.map((c) => c.id);
    await prisma.categoryAttribute.deleteMany({
      where: { categoryId: { in: orphanedIds } },
    });
  }

  await prisma.category.deleteMany({
    where: { slug: { in: orphanedSlugs } },
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

  // ===== ATTRIBUTES =====

  const brand = await createAttribute("Brand", "brand", "select");
  const condition = await createAttribute("Condition", "condition", "select");
  const clothingSize = await createAttribute("Clothing Size", "clothing-size", "select");
  const color = await createAttribute("Color", "color", "select");
  const shoeSize = await createAttribute("Shoe Size", "shoe-size", "select");
  const vintage = await createAttribute("Vintage", "vintage", "boolean");

  // ===== ATTRIBUTE VALUES =====

  for (const v of ["Nike", "Adidas", "Puma", "New Balance", "Gucci", "Prada", "Zara", "H&M", "Other"]) {
    await createAttributeValue(brand.id, v);
  }

  for (const v of ["New with tags", "Like new", "Good", "Fair"]) {
    await createAttributeValue(condition.id, v);
  }

  for (const v of ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"]) {
    await createAttributeValue(clothingSize.id, v);
  }

  for (const v of ["Black", "White", "Red", "Blue", "Green", "Yellow", "Pink", "Brown", "Grey", "Beige", "Multicolor"]) {
    await createAttributeValue(color.id, v);
  }

  for (const v of ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"]) {
    await createAttributeValue(shoeSize.id, v);
  }

  // ===== CATEGORY-ATTRIBUTE ASSOCIATIONS =====

  const womenClothingCategories = await prisma.category.findMany({
    where: {
      childrenOf: women.id,
      slug: {
        notIn: [
          ...["shoes-sneakers", "shoes-boots", "shoes-ankle-boots", "shoes-heels", "shoes-sandals", "shoes-loafers", "shoes-sport"].map(s => `women-${s}`),
          ...["bags-handbags", "bags-shoulder-crossbody", "bags-backpacks", "bags-clutches", "bags-totes"].map(s => `women-${s}`),
          ...["accessories-belts", "accessories-sunglasses", "accessories-hats", "accessories-scarves", "accessories-jewellery", "accessories-watches", "accessories-gloves"].map(s => `women-${s}`),
        ],
      },
    },
  });

  for (const cat of womenClothingCategories) {
    await linkCategoryAttribute(cat.id, brand.id, { required: false, isFilterable: true });
    await linkCategoryAttribute(cat.id, condition.id, { required: true, isFilterable: true });
    await linkCategoryAttribute(cat.id, clothingSize.id, { required: true, isFilterable: true });
    await linkCategoryAttribute(cat.id, color.id, { required: false, isFilterable: true });
    await linkCategoryAttribute(cat.id, vintage.id, { required: false, isFilterable: true });
  }

  const womenShoeCats = await prisma.category.findMany({
    where: { childrenOf: women.id, slug: { startsWith: "women-shoes-" } },
  });
  for (const cat of womenShoeCats) {
    await linkCategoryAttribute(cat.id, brand.id, { required: false, isFilterable: true });
    await linkCategoryAttribute(cat.id, condition.id, { required: true, isFilterable: true });
    await linkCategoryAttribute(cat.id, shoeSize.id, { required: true, isFilterable: true });
    await linkCategoryAttribute(cat.id, color.id, { required: false, isFilterable: true });
    await linkCategoryAttribute(cat.id, vintage.id, { required: false, isFilterable: true });
  }

  const menClothingCategories = await prisma.category.findMany({
    where: {
      childrenOf: men.id,
      slug: {
        notIn: [
          ...["shoes-sneakers", "shoes-boots", "shoes-formal", "shoes-loafers", "shoes-sandals", "shoes-sport"].map(s => `men-${s}`),
          ...["bags-backpacks", "bags-shoulder-crossbody", "bags-briefcases", "bags-holdalls"].map(s => `men-${s}`),
          ...["accessories-belts", "accessories-sunglasses", "accessories-hats", "accessories-scarves", "accessories-watches", "accessories-wallets", "accessories-gloves", "accessories-ties"].map(s => `men-${s}`),
        ],
      },
    },
  });
  for (const cat of menClothingCategories) {
    await linkCategoryAttribute(cat.id, brand.id, { required: false, isFilterable: true });
    await linkCategoryAttribute(cat.id, condition.id, { required: true, isFilterable: true });
    await linkCategoryAttribute(cat.id, clothingSize.id, { required: true, isFilterable: true });
    await linkCategoryAttribute(cat.id, color.id, { required: false, isFilterable: true });
    await linkCategoryAttribute(cat.id, vintage.id, { required: false, isFilterable: true });
  }

  const menShoeCats = await prisma.category.findMany({
    where: { childrenOf: men.id, slug: { startsWith: "men-shoes-" } },
  });
  for (const cat of menShoeCats) {
    await linkCategoryAttribute(cat.id, brand.id, { required: false, isFilterable: true });
    await linkCategoryAttribute(cat.id, condition.id, { required: true, isFilterable: true });
    await linkCategoryAttribute(cat.id, shoeSize.id, { required: true, isFilterable: true });
    await linkCategoryAttribute(cat.id, color.id, { required: false, isFilterable: true });
    await linkCategoryAttribute(cat.id, vintage.id, { required: false, isFilterable: true });
  }

  console.log("Seed completed: 3 roots, 88 subcategories, 6 attributes, category-attribute links");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
