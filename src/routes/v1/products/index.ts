import { Hono } from "hono";
import { crud } from "@/routes/v1/products/crud";

export const products = new Hono();
products.route("/", crud);
