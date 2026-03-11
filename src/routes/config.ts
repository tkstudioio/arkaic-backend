import { Hono } from "hono";

export const config = new Hono();

config.get("/", (c) => {
  return c.json({ asp: "https://mutinynet.arkade.sh" });
});
