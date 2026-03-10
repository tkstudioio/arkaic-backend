# Review Handoff — 03-product-activity-log

## Touched Files

- `prisma/schema.prisma` — added `ProductEvent` model, relation on `Products`, new enum values `buyerSubmitted` and `buyerCheckpointsSigned`
- `src/routes/products/crud.ts` — event logging on create and check-payment, new `GET /:id/events` endpoint, `GET /:id` supports `?include=events`
- `src/routes/products/collaborate.ts` — event logging on all 4 mutation endpoints, status transitions for `buyerSubmitted` and `buyerCheckpointsSigned`
- `src/routes/products/refund.ts` — event logging on submit-signed-psbt and finalize

## Summary of Changes

### `prisma/schema.prisma`
- Added `ProductEvent` model with `id`, `productId`, `action`, `createdAt`, `metadata` fields
- Added `events ProductEvent[]` relation on `Products`
- Added `buyerSubmitted` and `buyerCheckpointsSigned` to `ProductStatus` enum

### `src/routes/products/crud.ts`
- `POST /` creates a `created` event atomically with product creation
- `GET /:id/check-payment` creates a `funds_locked` event atomically with status update
- `GET /:id` supports `?include=events` query param to include events in response
- New `GET /:id/events` endpoint returns events ordered by `createdAt ASC`

### `src/routes/products/collaborate.ts`
- `seller-submit-psbt`: logs `seller_signed_psbt` event, status → `sellerReady`
- `buyer-submit-psbt`: logs `buyer_signed_psbt` event with `arkTxid` metadata, status → `buyerSubmitted` (was missing)
- `buyer-sign-checkpoints`: logs `buyer_signed_checkpoints` event, status → `buyerCheckpointsSigned` (was missing)
- `seller-sign-checkpoints`: logs `seller_signed_checkpoints` event with `arkTxid` metadata, status → `payed`
- All status+event pairs use `prisma.$transaction()` for atomicity

### `src/routes/products/refund.ts`
- `submit-signed-psbt`: logs `refund_submitted` event with `arkTxid` metadata (no status change)
- `finalize`: logs `refund_finalized` event with `arkTxid` metadata atomically with status → `refunded`

## Test Flow

1. `POST /products` → verify product created with status `awaitingFunds`, event `created` logged
2. `GET /products/:id/check-payment` → verify status `fundLocked`, event `funds_locked` logged
3. `POST /:id/collaborate/seller-submit-psbt` → verify status `sellerReady`, event `seller_signed_psbt`
4. `POST /:id/collaborate/buyer-submit-psbt` → verify status `buyerSubmitted`, event `buyer_signed_psbt`
5. `POST /:id/collaborate/buyer-sign-checkpoints` → verify status `buyerCheckpointsSigned`, event `buyer_signed_checkpoints`
6. `POST /:id/collaborate/seller-sign-checkpoints` → verify status `payed`, event `seller_signed_checkpoints`
7. `GET /products/:id/events` → verify all events returned in chronological order
8. `GET /products/:id?include=events` → verify events included in product response

## Commands Executed

| Command | Result |
|---------|--------|
| `npx prisma migrate dev --name add-product-events` | Pass — migration created and applied |
| `npx prisma generate` | Pass — client regenerated |
| `npx tsc --noEmit` | Pass — no type errors |
