import { Hono } from "hono";
import { crud } from "./crud.js";

export const products = new Hono();
products.route("/", crud);
