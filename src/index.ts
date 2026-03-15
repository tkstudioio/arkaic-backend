import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { auth } from "@/routes/auth";
import { listings } from "@/routes/listings";
import { chats } from "@/routes/chats";
import { messages } from "@/routes/messages";
import { escrows } from "@/routes/escrows";

const app = new Hono();

app.use("*", cors());

app.route("/chats", chats);
app.route("/messages", messages);
app.route("/listings", listings);
app.route("/escrows", escrows);
app.route("/auth", auth);

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, async () => {
  console.log(`Server running on port ${port}`);
});

export default app;
