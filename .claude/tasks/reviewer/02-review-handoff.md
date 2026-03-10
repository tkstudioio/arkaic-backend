# Review Handoff — 02-reorganize-routes-by-concern

## Touched Files

- `src/lib/escrow.ts` — **created**: shared `toXOnly` and `buildEscrowContext` helpers
- `src/routes/products/index.ts` — **created**: composes crud, refund, collaborate sub-routers
- `src/routes/products/crud.ts` — **created**: GET /, GET /:id, POST /, GET /:id/check-payment
- `src/routes/products/refund.ts` — **created**: refund flow endpoints mounted at `/:id/refund` (psbt, submit-signed-psbt, finalize)
- `src/routes/products/collaborate.ts` — **created**: all 7 collaborative flow endpoints
- `src/index.ts` — **modified**: removed ~200 lines of dead code, unused helpers, unused imports; updated route import
- `src/routes/products.ts` — **deleted**: replaced by `src/routes/products/` directory
- `CLAUDE.md` — **modified**: updated Source Layout section

## Summary of Changes

### `src/lib/escrow.ts`
- Extracted `toXOnly(pubkey)` and `buildEscrowContext(buyerPubkeyHex, sellerPubkeyHex, timelockExpiry)` from `products.ts`.
- Both are now exported and shared across all route files.

### `src/routes/products/crud.ts`
- Moved CRUD handlers (list, get, create) verbatim.
- Refactored `check-payment` to use `buildEscrowContext` instead of inline pubkey decoding and script building (removed ~20 lines of duplicated escrow setup).

### `src/routes/products/refund.ts`
- Moved refund handlers (get-psbts, refund, finalize-refund).
- Refactored `get-psbts` and `refund` to use `buildEscrowContext` instead of inline pubkey decoding (removed ~15 lines of duplicated code per handler).

### `src/routes/products/collaborate.ts`
- Moved all 7 collaborative flow handlers verbatim (these already used `buildEscrowContext`).
- Updated import path only.

### `src/index.ts`
- Removed all commented-out "listings" routes (lines 108–315).
- Removed all unused helper functions (`getCurrentTimeSeconds`, `toXOnly`, `buildEscrowScript`, `buildBuyerRecipientScript`, `getLegacyRefundRecipientAddress`, `resolveRefundRecipient`).
- Removed all unused imports (Ark SDK, @scure/base, prisma, ark providers).
- File went from 323 lines to 18 lines.

## Test Flow

URLs have been reorganized into nested sub-routes. Response shapes unchanged.

1. `GET /products` — list all products
2. `GET /products/:id` — single product
3. `POST /products` — create product
4. `GET /products/:id/check-payment?buyerPubkey=...&timelockExpiry=...` — check payment
5. Refund flow: `GET /:id/refund/psbt`, `POST /:id/refund/submit-signed-psbt`, `POST /:id/refund/finalize`
6. Collaborative flow: `GET /:id/collaborate/seller-psbt`, `POST /:id/collaborate/seller-submit-psbt`, `GET /:id/collaborate/buyer-psbt`, `POST /:id/collaborate/buyer-submit-psbt`, `POST /:id/collaborate/buyer-sign-checkpoints`, `GET /:id/collaborate/seller-checkpoints`, `POST /:id/collaborate/seller-sign-checkpoints`

## Commands Executed

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | Pass — no type errors |
