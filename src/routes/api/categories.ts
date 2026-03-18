import { Hono } from "hono";
import type { AuthEnv } from "@/lib/auth";
import { bearerAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const categories = new Hono<AuthEnv>();

categories.use(bearerAuth);

categories.get("/", async (c) => {
  const roots = await prisma.category.findMany({
    where: { childrenOf: null },
    select: { name: true, slug: true, childrenOf: true },
    orderBy: { id: "asc" },
  });
  return c.json(roots);
});

categories.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const parent = await prisma.category.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      childrenOf: true,
      children: {
        select: { id: true, name: true, slug: true, childrenOf: true },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!parent) return c.text("Category not found", 404);
  return c.json(parent);
});
