import { toXOnly } from "./escrow";
import { schnorr } from "@noble/curves/secp256k1";
import { hex } from "@scure/base";
import { createMiddleware } from "hono/factory";
import { verify } from "hono/jwt";
import { prisma } from "./prisma";

export type AuthEnv = { Variables: { pubkey: string; signature?: string } };

export const bearerAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const jwt = c.req.header("Authorization")?.replace("Bearer ", "");

  if (!jwt) return c.text("Missing Bearer token in request", 401);

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return c.text("JWT_SECRET not configured", 500);
    }
    const payload = await verify(jwt, secret, "HS256");

    const account = await prisma.account.findUnique({
      where: { pubkey: payload.sub as string },
    });
    if (!account) return c.text("Account not found", 401);

    c.set("pubkey", account.pubkey);
  } catch (_e) {
    return c.text("JWT not valid", 401);
  }

  await next();
});

export const verifySignature = createMiddleware<AuthEnv>(async (c, next) => {
  const pubkey = c.get("pubkey");
  // Note: c.req.json() internally caches the body in Hono, so downstream handlers can call c.req.json() again
  const body = await c.req.json();
  const { signature, ...values } = body;

  if (!signature) return c.text("Missing signature", 400);

  // Use JSON.stringify with sorted keys for deterministic serialization
  const sortedValues = Object.keys(values)
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = values[key as keyof typeof values];
        return acc;
      },
      {} as Record<string, unknown>,
    );

  const isValid = schnorr.verify(
    hex.decode(signature),
    new TextEncoder().encode(JSON.stringify(sortedValues)),
    toXOnly(hex.decode(pubkey)),
  );

  if (!isValid) return c.text("Invalid signature", 401);

  c.set("signature", signature);
  await next();
});
