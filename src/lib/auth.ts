import { toXOnly } from "./escrow";
import { schnorr } from "./schnorr";
import { hex } from "@scure/base";
import { createMiddleware } from "hono/factory";
import { decode } from "hono/jwt";
import { prisma } from "./prisma";

export type AuthEnv = { Variables: { pubkey: string; signature: string } };

export const bearerAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const jwt = c.req.header("Authorization")?.replace("Bearer ", "");

  if (!jwt) return c.text("Missing Bearer token in request", 401);

  try {
    const { payload } = decode(jwt);

    const account = await prisma.account.findUnique({
      where: { pubkey: payload.sub as string },
    });
    if (!account) return c.text("Account not found", 401);

    c.set("pubkey", account.pubkey);
  } catch (e) {
    return c.text("JWT not valid", 401);
  }

  await next();
});

export const verifySignature = createMiddleware<AuthEnv>(async (c, next) => {
  const pubkey = c.get("pubkey");
  const body = await c.req.json();
  const { signature, ...values } = body;

  if (!signature) return c.text("Missing signature", 400);

  const isValid = schnorr.verify(
    hex.decode(signature),
    new TextEncoder().encode(JSON.stringify(values)),
    toXOnly(hex.decode(pubkey)),
  );

  if (!isValid) return c.text("Invalid signature", 401);

  c.set("signature", signature);
  await next();
});
