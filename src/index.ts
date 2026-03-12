import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { products } from "./routes/v1/products/index.js";
import { chats } from "./routes/v1/chats/index.js";
import { escrows } from "./routes/v1/escrows/index.js";
import { config } from "./routes/v1/config.js";
import { account } from "./routes/v1/account/index.js";
import { auth } from "./routes/v1/auth/index.js";

const v1 = new Hono();

v1.use("*", cors());

v1.route("/products", products);
v1.route("/chats", chats);
v1.route("/escrows", escrows);
v1.route("/account", account);
v1.route("/config", config);
v1.route("/auth", auth);

const v2 = new Hono();

v2.use("*", cors());

v2.route("/products", products);
v2.route("/chats", chats);
v2.route("/escrows", escrows);
v2.route("/account", account);
v2.route("/config", config);
v2.route("/auth", auth);

const port = Number(process.env.PORT) || 3000;

serve({ fetch: v2.fetch, port }, async () => {
  console.log(`Server running on port ${port}`);
});

export default v2;
