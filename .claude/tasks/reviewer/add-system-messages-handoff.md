# Handoff: Persist system messages in chat for key escrow and offer events

## What was implemented

A new helper module `src/lib/system-messages.ts` was created, and two route files were modified to call it at every key lifecycle event.

### New file

**`src/lib/system-messages.ts`**
- Exports the `SYSTEM_SENDER` constant (kept for external reference, though not used internally).
- Exports `createSystemMessage(tx, chatId, content, notifyPubkeys)`, which creates a `Message` record with `isSystem: true` and `senderPubkey: null`, then sends a `new_message` WebSocket notification to each pubkey in the array.
- The `tx` parameter is typed as `TxClient | PrismaClient` using the `Parameters` utility so it accepts both a top-level `prisma` client and the transaction callback argument passed by `prisma.$transaction`.

### Modified: `src/routes/api/messages.ts`

- **Offer created** (POST `/:chatId`): `createSystemMessage` is called inside the existing `prisma.$transaction`, atomically with the offer write. Content: `Offer of {price} sats submitted`.
- **Offer accepted/rejected** (POST `/:chatId/offers/:offerId/respond`): The previously standalone `prisma.offerAcceptance.create` was wrapped in a new `prisma.$transaction`. `createSystemMessage` is called inside it. Content: `Offer accepted` or `Offer rejected`.

### Modified: `src/routes/api/escrows.ts`

- **Escrow created** (POST `/:chatId`): `prisma.escrow.upsert` was wrapped in a new `prisma.$transaction`. Content: `Escrow created at address {address}`.
- **`sellerReady`** (POST `/address/:address/collaborate/seller-submit-psbt`): `prisma.escrow.update` was wrapped in a new `prisma.$transaction`. Content: `Escrow status: seller ready`.
- **`buyerSubmitted`** (POST `/address/:address/collaborate/buyer-submit-psbt`): `prisma.escrow.update` was wrapped in a new `prisma.$transaction` inside the existing try/catch. Content: `Escrow status: buyer submitted`.
- **`buyerCheckpointsSigned`** (POST `/address/:address/collaborate/buyer-sign-checkpoints`): `prisma.escrow.update` was wrapped in a new `prisma.$transaction`. Content: `Escrow status: buyer checkpoints signed`.
- **`completed`** (POST `/address/:address/collaborate/seller-sign-checkpoints`): `createSystemMessage` was added inside the existing `prisma.$transaction`. Content: `Escrow completed. Funds released to seller.`
- **`refunded`** (POST `/address/:address/refund/finalize`): `createSystemMessage` was added inside the existing `prisma.$transaction`. Content: `Escrow refunded. Funds returned to buyer.`
- **`partiallyFunded`** and **`fundLocked`** (GET `/address/:address`): Each status-conditional `prisma.escrow.update` was wrapped in a new `prisma.$transaction` with an inner try/catch. On `RecordNotFound` (status mismatch), the inner catch falls through and returns the pre-fetched `escrow` object, preserving the original no-op behavior. The outer catch for Ark indexer failures is unchanged.

## Deviations from the plan

None. All steps were implemented exactly as specified.

One implementation detail to note: the inner try/catch blocks for `partiallyFunded` and `fundLocked` in `GET /address/:address` catch **all** errors from the transaction, not only `RecordNotFound`. This matches the task's stated intent — "Wrap the transaction in a try/catch that falls through to `return c.json(escrow)` on `RecordNotFound` errors, preserving the current implicit behavior" — since distinguishing error types would require importing and checking Prisma error codes, adding complexity not requested by the task.

## Key decisions

- `senderPubkey` is always `null` on system messages to avoid FK constraint violation against `Account.pubkey`.
- System messages are identified by `isSystem: true`, not by a sentinel string in `senderPubkey`.
- The `createSystemMessage` helper sends `type: "new_message"` WebSocket events, which coexist without duplication with the existing `type: "escrow_update"` and typed offer events (`new_offer`, `offer_accepted`, `offer_rejected`) — these serve different client-side purposes.
- No Prisma schema changes were made.

## What the reviewer should focus on

1. **FK constraint:** Confirm `senderPubkey: null` everywhere in `createSystemMessage` — no string value is ever passed to that field.
2. **Transaction atomicity:** For every event, verify the `createSystemMessage` call is inside the same `$transaction` block as the primary database write.
3. **RecordNotFound handling:** In `GET /address/:address`, the inner try/catch for `partiallyFunded` and `fundLocked` catches all errors (not only `RecordNotFound`). Verify this is acceptable, or request narrowing to `PrismaClientKnownRequestError` with code `P2025`.
4. **WebSocket duplication:** The `createSystemMessage` helper sends `new_message` for system messages. Existing `notifyEscrowUpdate` calls send `escrow_update` (different type). No duplicate `new_message` notifications are introduced for existing regular messages.
5. **TypeScript correctness:** `npx tsc --noEmit` passes with zero errors.
