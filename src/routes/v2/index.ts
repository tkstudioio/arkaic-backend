import { Hono } from "hono";
import { auth } from "@/routes/v2/auth";
import { bearerAuth } from "@/lib/auth";

export const v2 = new Hono();

v2.get("/products", bearerAuth, (c) => {
  return c.json([]);
});
v2.route("/auth", auth);
