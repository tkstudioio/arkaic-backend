import { Hono } from "hono";
import { sValidator } from "@hono/standard-validator";
import { sign } from "hono/jwt";
import z from "zod";
import crypto from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1";
import { hex } from "@scure/base";
import { prisma } from "@/lib/prisma";
import { toXOnly } from "@/lib/escrow";
import { isAfter } from "date-fns";
import { Challenge } from "@/generated/prisma/client";

const JWT_SECRET = process.env.JWT_SECRET!;

export const auth = new Hono();

auth.post(
  "/register",
  sValidator(
    "json",
    z.object({
      pubkey: z.string(),
      username: z.string(),
      signature: z.string(),
    }),
  ),
  async (c) => {
    const { pubkey, username, signature } = c.req.valid("json");

    const isValid = schnorr.verify(
      hex.decode(signature),
      new TextEncoder().encode(`${username} ${pubkey}`),
      toXOnly(hex.decode(pubkey)),
    );

    if (!isValid) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    const account = await prisma.account.upsert({
      where: { pubkey },
      update: {
        username,
      },
      create: {
        pubkey,
        username,
      },
    });

    return c.json(account);
  },
);

auth.post(
  "/challenge",
  sValidator("json", z.object({ pubkey: z.string() })),
  async (c) => {
    const { pubkey } = c.req.valid("json");

    const nonce = crypto.randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 30_000);

    await prisma.challenge.deleteMany({
      where: {
        expiry: { lt: new Date() },
      },
    });

    const challenge = await prisma.challenge.upsert({
      where: { pubkey },
      update: {
        nonce,
        expiry,
      },
      create: {
        pubkey,
        nonce,
        expiry,
      },
    });

    return c.json(challenge);
  },
);

auth.post(
  "/login",
  sValidator(
    "json",
    z.object({ pubkey: z.string(), nonce: z.string(), signature: z.string() }),
  ),
  async (c) => {
    const { pubkey, nonce, signature } = c.req.valid("json");

    let challenge: Challenge;

    try {
      challenge = await prisma.challenge.delete({
        where: { nonce },
      });
    } catch {
      return c.json({ error: "Invalid nonce" }, 401);
    }

    if (challenge.pubkey !== pubkey) {
      return c.json({ error: "Wrong pubkey" }, 401);
    }

    if (isAfter(new Date(), challenge.expiry)) {
      return c.json({ error: "Challenge expired" }, 401);
    }

    const isValid = schnorr.verify(
      hex.decode(signature),
      new TextEncoder().encode(`${nonce} ${pubkey}`),
      toXOnly(hex.decode(pubkey)),
    );

    if (!isValid) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    const now = Math.floor(Date.now() / 1000);

    const token = await sign(
      {
        sub: pubkey,
        iat: now,
        exp: now + 3600,
      },
      JWT_SECRET,
    );

    return c.text(token);
  },
);
