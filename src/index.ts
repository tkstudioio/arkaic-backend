import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { products } from "./routes/products/index.js";

const app = new Hono();

app.use("*", cors());

app.route("/products", products);

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, async () => {
  console.log(`Server running on port ${port}`);
});

export default app;
