# Task: Persist system messages in chat for key escrow and offer events

## Context

The `Message` model in Prisma already has an `isSystem: Boolean @default(false)` field, but it is never used. Currently, events (offer created, offer accepted/rejected, escrow created, escrow state transitions) only trigger WebSocket notifications. The goal is to also persist system messages in the chat database so that clients can display a full event timeline when loading chat history.

## Objective

For each key event in the offer and escrow lifecycle, create a `Message` record with `isSystem: true` in the relevant chat. The system message must be created atomically (same transaction where applicable) and a WebSocket notification must be sent so the client knows to refresh.

## File coinvolti

| File | Action |
|------|--------|
| `src/lib/system-messages.ts` | **Create** — new helper module |
| `src/routes/api/messages.ts` | **Modify** — add system messages for offer events |
| `src/routes/api/escrows.ts` | **Modify** — add system messages for escrow events |

No Prisma schema changes are needed — the `Message` model already supports `isSystem` and `senderPubkey` is nullable (`String?`).

## Implementation detail

### Step 1 — Create `src/lib/system-messages.ts`

Create a new lib file with:

1. A constant for the system sender identifier:
   ```typescript
   export const SYSTEM_SENDER = "SYSTEM";
   ```

2. A helper function to create a system message and notify both parties via WebSocket:
   ```typescript
   import { sendToUser } from "@/routes/ws";

   export const SYSTEM_SENDER = "SYSTEM";

   /**
    * Creates a system message in the given chat and notifies both parties.
    * Can accept either a Prisma client or a transaction client (PrismaClient or Prisma.TransactionClient).
    * @param tx - Prisma client or transaction client
    * @param chatId - The chat ID
    * @param content - Human-readable event description
    * @param notifyPubkeys - Array of pubkeys to notify via WebSocket
    */
   export async function createSystemMessage(
     tx: { message: { create: Function } },
     chatId: number,
     content: string,
     notifyPubkeys: string[],
   ) {
     const msg = await tx.message.create({
       data: {
         chatId,
         message: content,
         senderPubkey: null,
         isSystem: true,
       },
     });

     for (const pubkey of notifyPubkeys) {
       sendToUser(pubkey, { type: "new_message", chatId });
     }

     return msg;
   }
   ```

**Key design decisions:**
- `senderPubkey` is set to `null` (not `"SYSTEM"`) because the field has a foreign key to `Account.pubkey` — inserting `"SYSTEM"` would violate the FK constraint. System messages are identified by `isSystem: true`.
- The `tx` parameter is typed loosely so it accepts both `prisma` and a `$transaction` callback's `tx` argument. Use the type `{ message: { create: (args: any) => any } }` or import the appropriate Prisma transaction client type. The pragmatic approach is:
  ```typescript
  import type { PrismaClient } from "@/generated/prisma";
  type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
  export async function createSystemMessage(
    tx: TxClient | PrismaClient,
    chatId: number,
    content: string,
    notifyPubkeys: string[],
  ) { ... }
  ```
- The function sends a `new_message` WebSocket notification so the client refreshes the chat and sees the system message in the timeline.

### Step 2 — Modify `src/routes/api/messages.ts`

Import the new helper at the top:
```typescript
import { createSystemMessage } from "@/lib/system-messages";
```

#### 2a. Offer created (line 65-88, inside the `$transaction`)

After the `offer` is created inside the existing `prisma.$transaction` callback (around line 80-86), add a call to create the system message **inside the same transaction**:

```typescript
await createSystemMessage(
  tx,
  chatId,
  `Offer of ${body.offeredPrice} sats submitted`,
  [chat.buyerPubkey, chat.listing.sellerPubkey],
);
```

Place this right after the `tx.offer.create(...)` call and before the `return { ...newMessage, offer }` line.

#### 2b. Offer accepted / rejected (line 147-153)

The current code creates the `OfferAcceptance` without a transaction. Wrap it in a `prisma.$transaction`:

```typescript
const acceptance = await prisma.$transaction(async (tx) => {
  const acc = await tx.offerAcceptance.create({
    data: {
      offerId,
      signature,
      accepted,
    },
  });

  const statusText = accepted ? "accepted" : "rejected";
  await createSystemMessage(
    tx,
    chatId,
    `Offer ${statusText}`,
    [offer.message.chat.buyerPubkey, offer.message.chat.listing.sellerPubkey],
  );

  return acc;
});
```

Replace the current standalone `prisma.offerAcceptance.create(...)` call (line 147-153) with this transaction block.

### Step 3 — Modify `src/routes/api/escrows.ts`

Import the new helper at the top:
```typescript
import { createSystemMessage } from "@/lib/system-messages";
```

#### 3a. Escrow created (`POST /:chatId`, line 119-123)

The current code uses `prisma.escrow.upsert()` without a transaction. Wrap it:

```typescript
const newEscrow = await prisma.$transaction(async (tx) => {
  const esc = await tx.escrow.upsert({
    where: { chatId: chat.id },
    update: newEscrowValues,
    create: newEscrowValues,
  });

  await createSystemMessage(
    tx,
    chatId,
    `Escrow created at address ${address}`,
    [buyerPubkey, sellerPubkey],
  );

  return esc;
});
```

#### 3b. Escrow status: `sellerReady` (seller-submit-psbt, line 233-239)

Wrap the `prisma.escrow.update()` in a transaction:

```typescript
await prisma.$transaction(async (tx) => {
  await tx.escrow.update({
    where: { address },
    data: {
      sellerSignedCollabPsbt: signedPsbt,
      status: "sellerReady",
    },
  });

  await createSystemMessage(
    tx,
    escrow.chatId,
    "Escrow status: seller ready",
    [escrow.buyerPubkey, escrow.sellerPubkey],
  );
});
```

#### 3c. Escrow status: `buyerSubmitted` (buyer-submit-psbt, line 293-299)

Wrap the `prisma.escrow.update()` in a transaction:

```typescript
await prisma.$transaction(async (tx) => {
  await tx.escrow.update({
    where: { address },
    data: {
      collabArkTxid: arkTxid,
      serverSignedCheckpoints: JSON.stringify(signedCheckpointTxs),
      status: "buyerSubmitted",
    },
  });

  await createSystemMessage(
    tx,
    escrow.chatId,
    "Escrow status: buyer submitted",
    [escrow.buyerPubkey, escrow.sellerPubkey],
  );
});
```

#### 3d. Escrow status: `buyerCheckpointsSigned` (buyer-sign-checkpoints, line 329-335)

Wrap in a transaction:

```typescript
await prisma.$transaction(async (tx) => {
  await tx.escrow.update({
    where: { address },
    data: {
      buyerSignedCheckpoints: JSON.stringify(signedCheckpointTxs),
      status: "buyerCheckpointsSigned",
    },
  });

  await createSystemMessage(
    tx,
    escrow.chatId,
    "Escrow status: buyer checkpoints signed",
    [escrow.buyerPubkey, escrow.sellerPubkey],
  );
});
```

#### 3e. Escrow status: `completed` (seller-sign-checkpoints, line 388-397)

The existing `prisma.$transaction` already updates escrow + chat. Add the system message inside it:

```typescript
await prisma.$transaction(async (tx) => {
  await tx.escrow.update({
    where: { address },
    data: { status: "completed", releasedAt: new Date() },
  });
  await tx.chat.update({
    where: { id: escrow.chatId },
    data: { status: "closed" },
  });
  await createSystemMessage(
    tx,
    escrow.chatId,
    "Escrow completed. Funds released to seller.",
    [escrow.buyerPubkey, escrow.sellerPubkey],
  );
});
```

#### 3f. Escrow status: `refunded` (refund/finalize, line 494-503)

The existing `prisma.$transaction` already updates escrow + chat. Add the system message inside it:

```typescript
await prisma.$transaction(async (tx) => {
  await tx.escrow.update({
    where: { address },
    data: { status: "refunded" },
  });
  await tx.chat.update({
    where: { id: escrow.chatId },
    data: { status: "closed" },
  });
  await createSystemMessage(
    tx,
    escrow.chatId,
    "Escrow refunded. Funds returned to buyer.",
    [escrow.buyerPubkey, escrow.sellerPubkey],
  );
});
```

#### 3g. Escrow funding state changes (GET /address/:address, line 162-179)

The `partiallyFunded` and `fundLocked` transitions happen inside a GET endpoint with side effects. These updates are standalone `prisma.escrow.update()` calls. Wrap each in a transaction and add a system message.

For `partiallyFunded` (line 163-167):
```typescript
const updatedEscrow = await prisma.$transaction(async (tx) => {
  const esc = await tx.escrow.update({
    where: { address, status: "awaitingFunds" },
    data: { status: "partiallyFunded" },
  });
  await createSystemMessage(
    tx,
    escrow.chatId,
    `Escrow partially funded (${total} of ${escrow.price} sats)`,
    [escrow.buyerPubkey, escrow.sellerPubkey],
  );
  return esc;
});
```

For `fundLocked` (line 170-179):
```typescript
const updatedEscrow = await prisma.$transaction(async (tx) => {
  const esc = await tx.escrow.update({
    where: {
      address,
      status: { in: ["awaitingFunds", "partiallyFunded"] },
    },
    data: { status: "fundLocked" },
  });
  await createSystemMessage(
    tx,
    escrow.chatId,
    "Escrow fully funded. Funds are now locked.",
    [escrow.buyerPubkey, escrow.sellerPubkey],
  );
  return esc;
});
```

**Important edge case for 3g:** The `prisma.escrow.update()` calls use conditional `where` clauses (e.g., `status: "awaitingFunds"`). If the status does not match, Prisma throws a `RecordNotFound` error. The current code does not handle this — the update silently succeeds only when the status matches. When wrapping in a transaction, the system message will only be created if the update succeeds (which is correct). However, if the status already changed (e.g., already `fundLocked`), the transaction will throw. Wrap the transaction in a try/catch that falls through to `return c.json(escrow)` on `RecordNotFound` errors, preserving the current implicit behavior.

### Step 4 — Verify no Prisma schema changes needed

The `Message` model already has:
- `senderPubkey String?` — nullable, no FK violation when set to `null`
- `isSystem Boolean @default(false)` — ready to use
- `signature String?` — nullable, system messages have no signature

No migration is needed.

## Technical constraints

- ESM only, use `@/` path alias for all internal imports
- `senderPubkey` must be `null` (not `"SYSTEM"`) to avoid FK constraint violation on `Account.pubkey`
- System messages are identified by `isSystem: true`
- The `createSystemMessage` helper must work with both `prisma` directly and inside `prisma.$transaction()` callbacks
- WebSocket notifications for system messages use `type: "new_message"` so the client treats them as chat updates
- All system message content strings must be in English
- Do not modify `prisma/schema.prisma` or any generated files

## Acceptance criteria

- [ ] New file `src/lib/system-messages.ts` exports `createSystemMessage` and `SYSTEM_SENDER` constant
- [ ] Offer created: system message persisted in chat within the same transaction
- [ ] Offer accepted: system message persisted in chat within a new transaction
- [ ] Offer rejected: system message persisted in chat within the same transaction as accepted
- [ ] Escrow created: system message persisted in chat within a transaction
- [ ] Every escrow status transition (`sellerReady`, `buyerSubmitted`, `buyerCheckpointsSigned`, `completed`, `refunded`, `partiallyFunded`, `fundLocked`) produces a system message
- [ ] All system messages have `isSystem: true` and `senderPubkey: null`
- [ ] All system messages trigger a `new_message` WebSocket notification to both buyer and seller
- [ ] System messages inside transactions are atomic with the main operation — if the operation rolls back, no orphan system message is created
- [ ] The GET `/address/:address` endpoint handles `RecordNotFound` gracefully when the status-conditional update does not match
- [ ] No Prisma schema migration is needed
- [ ] All imports use `@/` path alias

## Notes for the reviewer

- **FK constraint:** Verify that `senderPubkey` is `null`, not a string like `"SYSTEM"`. The `Message.senderPubkey` has a relation to `Account.pubkey`.
- **Transaction atomicity:** For every event, confirm the system message creation is inside the same `$transaction` as the main database write.
- **WebSocket duplication:** The `createSystemMessage` helper sends `new_message` notifications. Verify that existing `sendToUser` calls in the handlers are not duplicating notifications for the same event. The existing `notifyEscrowUpdate` calls send `escrow_update` type (different from `new_message`), so they should coexist without duplication. The existing `new_offer` / `offer_accepted` / `offer_rejected` WS notifications also remain — they serve a different purpose (typed event for the client) vs. the generic `new_message` that signals a chat refresh.
- **Edge case in GET /address/:address:** The funding-check endpoint has side effects. The transaction wrapping + RecordNotFound handling must preserve the existing behavior where a repeated call with the same status is a no-op.
- **Content strings:** All system message strings are hardcoded English. If i18n is needed later, the content could be replaced with structured event codes, but that is out of scope for this task.
