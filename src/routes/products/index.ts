import { Hono } from "hono";
import { crud } from "./crud.js";
import { refund } from "./refund.js";
import { collaborate } from "./collaborate.js";

export const products = new Hono();
products.route("/", crud);
products.route("/:id/refund", refund);
products.route("/:id/collaborate", collaborate);
