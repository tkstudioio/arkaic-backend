import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { products } from "@/routes/v1/products";
import { chats } from "@/routes/v1/chats";
import { escrows } from "@/routes/v1/escrows";
import { config } from "@/routes/v1/config";
import { account } from "@/routes/v1/account";
import { auth } from "@/routes/v1/auth";
import { v2 } from "@/routes/v2";

const app = new Hono();

app.use("*", cors());

// app.route("/products", products);
// app.route("/chats", chats);
// app.route("/escrows", escrows);
// app.route("/account", account);
// app.route("/config", config);
// app.route("/auth", auth);

app.route("/v2", v2);

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, async () => {
  console.log(`Server running on port ${port}`);
});

export default app;
