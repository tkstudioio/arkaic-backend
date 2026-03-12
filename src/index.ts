import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { products } from "./routes/products/index.js";
import { chats } from "./routes/chats/index.js";
import { escrows } from "./routes/escrows/index.js";
import { config } from "./routes/config.js";
import { account } from "./routes/account/index.js";
import { auth } from "./routes/auth/index.js";

const app = new Hono();

app.use("*", cors());

app.route("/products", products);
app.route("/chats", chats);
app.route("/escrows", escrows);
app.route("/account", account);
app.route("/config", config);
app.route("/auth", auth);

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, async () => {
  console.log(`Server running on port ${port}`);
});

export default app;
