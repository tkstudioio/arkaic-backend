# Code Conventions

> **Audience**: Developer, Reviewer

## TypeScript

- **Strict mode** abilitato (`"strict": true`)
- **Target**: ESNext
- **Module**: ESNext con `moduleResolution: "bundler"`
- **ESM only**: `"type": "module"` nel package.json
- **Path alias**: `@/` risolve a `src/` (gestito da tsx a runtime)

---

## Import Pattern

```typescript
// Import interni — usa SEMPRE il path alias @/
import { prisma } from "@/lib/prisma";
import { arkProvider, getServerPubkey } from "@/lib/ark";
import { buildEscrowContext, toXOnly } from "@/lib/escrow";
import { bearerAuth, verifySignature } from "@/lib/auth";
import { sendToUser } from "@/routes/ws";

// Import esterni
import { Hono } from "hono";
import z from "zod";
import { sValidator } from "@hono/standard-validator";
import { hex, base64 } from "@scure/base";
```

---

## Route Handler Pattern

Ogni file route esporta un `Hono` router:

```typescript
import { Hono } from "hono";
import type { AuthEnv } from "@/lib/auth";

const app = new Hono<AuthEnv>();

// Endpoint protetto con auth + validazione + firma
app.post(
  "/endpoint",
  bearerAuth,
  verifySignature,
  sValidator("json", z.object({ field: z.string() })),
  async (c) => {
    const pubkey = c.get("pubkey");
    const { field } = c.req.valid("json");

    // Logica...

    return c.json({ result }, 201);
  }
);

export default app;
```

### Ordine middleware

1. `bearerAuth` — sempre primo per endpoint protetti
2. `verifySignature` — dopo bearerAuth, per endpoint che richiedono firma
3. `sValidator("json", schema)` — validazione Zod del body

---

## Error Handling Pattern

```typescript
// Errore semplice — testo
return c.text("Missing required field", 400);
return c.text("Not found", 404);
return c.text("Forbidden", 403);

// Errore strutturato — JSON
return c.json({ error: "Detailed error message" }, 400);

// Errore database/esterno
return c.text("Failed to create escrow", 502);

// Status codes usati
// 200 — OK
// 201 — Created
// 400 — Bad input
// 401 — Auth failure
// 403 — Forbidden
// 404 — Not found
// 500 — Server config error
// 502 — External service failure
```

---

## Database Pattern (Prisma)

```typescript
// Query semplice con autorizzazione query-level
const chat = await prisma.chat.findFirst({
  where: {
    id: chatId,
    OR: [{ buyerPubkey: pubkey }, { listing: { sellerPubkey: pubkey } }],
  },
  include: { listing: true, messages: true },
});

// Operazione atomica multi-modello
const result = await prisma.$transaction(async (tx) => {
  const message = await tx.message.create({ data: { ... } });
  const offer = await tx.offer.create({ data: { ... } });
  return { message, offer };
});
```

---

## WebSocket Notification Pattern

```typescript
import { sendToUser } from "@/routes/ws";

// Notifica a un utente specifico
sendToUser(buyerPubkey, { type: "new_message", chatId });

// Notifica a entrambe le parti
sendToUser(buyerPubkey, { type: "escrow_update", address });
sendToUser(sellerPubkey, { type: "escrow_update", address });
```

---

## Crittografia Pattern

```typescript
import { hex } from "@scure/base";
import { toXOnly } from "@/lib/escrow";

// Pubkey: hex string → Uint8Array → x-only (32 bytes)
const pubkeyBytes = hex.decode(pubkeyHex);
const xOnlyPubkey = toXOnly(pubkeyBytes);

// PSBT: Uint8Array ↔ base64 string
const psbtBase64 = base64.encode(psbtBytes);
const psbtBytes = base64.decode(psbtBase64);
```

---

## Validation Pattern (Zod)

```typescript
import z from "zod";
import { sValidator } from "@hono/standard-validator";

// Schema inline nel middleware
app.post(
  "/endpoint",
  sValidator("json", z.object({
    pubkey: z.string().length(66),
    price: z.number().positive(),
    signature: z.string(),
  })),
  async (c) => {
    const data = c.req.valid("json");
    // ...
  }
);
```

---

## Naming Conventions

- **File route**: kebab-case (`escrows.ts`, `messages.ts`)
- **File lib**: kebab-case (`auth.ts`, `escrow.ts`, `prisma.ts`)
- **Variabili**: camelCase (`buyerPubkey`, `sellerSignedCollabPsbt`)
- **Tipi**: PascalCase (`AuthEnv`, `EscrowStatus`)
- **Costanti**: UPPER_SNAKE_CASE (`ARK_SERVER_URL`)
- **Route path**: kebab-case (`/seller-psbt`, `/submit-signed-psbt`, `/buyer-sign-checkpoints`)
