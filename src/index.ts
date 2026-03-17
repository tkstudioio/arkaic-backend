import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { setupWebSocket } from "@/routes/ws";
import { api } from "@/routes/api";

const app = new Hono();

app.use("*", cors());

app.route("/api", api);
const { injectWebSocket } = setupWebSocket(app);

const port = Number(process.env.PORT) || 3000;

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on port ${port}`);
});

injectWebSocket(server);

export default app;
