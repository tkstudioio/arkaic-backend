# Task: Reorganize routes into separate files by concern

## Context

The project started as a simple escrow proof-of-concept and all endpoints ended up in a single 710-line `src/routes/products.ts`. Now that the escrow flows work, the codebase needs better file organization.

### Current problems

1. **`src/routes/products.ts`** (710 lines) — mixes CRUD, payment check, refund flow, and collaborative flow in one file.
2. **`src/index.ts`** (323 lines) — contains ~200 lines of commented-out dead code (old "listings" routes from lines 108–315) and unused helper functions (`getCurrentTimeSeconds`, `toXOnly`, `buildEscrowScript`, `buildBuyerRecipientScript`, `getLegacyRefundRecipientAddress`, `resolveRefundRecipient`).
3. **`toXOnly`** is duplicated in both `src/index.ts` and `src/routes/products.ts`.
4. **`buildEscrowContext`** in `products.ts` rebuilds the escrow script context — it's used by check-payment, refund, and collaborative handlers but lives inline.

### Key conventions

- **Framework**: Hono — sub-routers are composed via `app.route("/prefix", subRouter)`
- **ESM-only**: all imports use `.js` extensions
- **TypeScript strict mode**, ESNext target, NodeNext modules
- **Prisma client**: imported from `../lib/prisma.js`
- **Ark providers**: imported from `../lib/ark.js`
- **SDK imports**: `@arkade-os/sdk` for `VtxoScript`, `MultisigTapscript`, `CLTVMultisigTapscript`, `CSVMultisigTapscript`, `DefaultVtxo`, `buildOffchainTx`, `Transaction`, `VirtualCoin`
- **Encoding**: `@scure/base` for `hex`/`base64`

## Goal

Split the monolithic `products.ts` into one file per route group, extract shared helpers, and clean up `index.ts`. The API surface (URLs, request/response shapes) must NOT change.

### Target structure

```
src/
├── index.ts                      — app setup, CORS, mount routes, start server (clean, no dead code)
├── lib/
│   ├── ark.ts                    — (unchanged)
│   ├── prisma.ts                 — (unchanged)
│   └── escrow.ts                 — NEW: shared escrow helpers (toXOnly, buildEscrowContext)
├── routes/
│   └── products/
│       ├── index.ts              — NEW: creates Hono sub-router, mounts crud/refund/collaborate, re-exports
│       ├── crud.ts               — NEW: GET /, GET /:id, POST /, GET /:id/check-payment
│       ├── refund.ts             — NEW: GET /:id/get-psbts, POST /:id/refund, POST /:id/finalize-refund
│       └── collaborate.ts        — NEW: all collaborative flow endpoints
```

### Detailed breakdown

#### `src/lib/escrow.ts` (new)

Extract from `products.ts`:
- `toXOnly(pubkey: Uint8Array): Uint8Array`
- `buildEscrowContext(buyerPubkeyHex: string, sellerPubkeyHex: string, timelockExpiry: number)` — returns `{ escrowScript, refundPath, collaborativePath, buyerPubkey, sellerPubkey, serverPubkey }`

Both are currently defined at the top of `src/routes/products.ts` (lines 19–52). Move them here and export them.

#### `src/routes/products/index.ts` (new)

```typescript
import { Hono } from "hono";
import { crud } from "./crud.js";
import { refund } from "./refund.js";
import { collaborate } from "./collaborate.js";

export const products = new Hono();
products.route("/", crud);
products.route("/", refund);
products.route("/", collaborate);
```

#### `src/routes/products/crud.ts` (new)

Move from `products.ts`:
- `GET /` — list all products (line 54)
- `GET /:id` — get single product (line 58)
- `POST /` — create product (line 67)
- `GET /:id/check-payment` — check escrow payment and set `fundLocked` (line 77)

The `check-payment` handler currently inlines escrow script building (lines 92–115). Refactor it to use `buildEscrowContext` from `src/lib/escrow.ts`.

#### `src/routes/products/refund.ts` (new)

Move from `products.ts`:
- `GET /:id/get-psbts` — build unsigned refund PSBT (line 141)
- `POST /:id/refund` — submit buyer-signed refund PSBT (line 233)
- `POST /:id/finalize-refund` — finalize refund with signed checkpoints (line 341)

These handlers currently inline `toXOnly` calls (e.g. lines 158–167, 254–264). Refactor to use `buildEscrowContext` from `src/lib/escrow.ts` instead of manually decoding/slicing pubkeys.

#### `src/routes/products/collaborate.ts` (new)

Move from `products.ts`:
- `GET /:id/collaborate-psbts` — unsigned collaborative PSBT (line 379)
- `POST /:id/collaborate` — seller saves signed PSBT (line 454)
- `GET /:id/collab-status` — buyer polls for seller PSBT (line 584)
- `POST /:id/confirm-collaborate` — buyer submits fully-signed PSBT (line 604)
- `POST /:id/buyer-sign-checkpoints` — buyer saves signed checkpoints (line 492)
- `GET /:id/collab-checkpoints` — seller polls for buyer checkpoints (line 529)
- `POST /:id/collaborate-checkpoints` — seller finalizes with signed checkpoints (line 550)

These already use `buildEscrowContext` — just update the import path.

#### `src/index.ts` (clean up)

- Remove ALL commented-out code (lines 108–315)
- Remove ALL unused helper functions (`getCurrentTimeSeconds`, `toXOnly`, `buildEscrowScript`, `buildBuyerRecipientScript`, `getLegacyRefundRecipientAddress`, `resolveRefundRecipient`)
- Remove unused imports (`ArkAddress`, `buildOffchainTx`, `CLTVMultisigTapscript`, `CSVMultisigTapscript`, `MultisigTapscript`, `networks`, `Transaction`, `VirtualCoin`, `VtxoScript`, `base64`, `hex`, `prisma`, `arkProvider`, `getNetworkTimeSeconds`, `getServerPubkey`, `indexerProvider`)
- Update import path: `./routes/products.js` → `./routes/products/index.js`
- Keep: Hono app creation, CORS middleware, route mounting, server start

#### Delete `src/routes/products.ts`

Replaced by the `src/routes/products/` directory.

## Acceptance Criteria

- [ ] `src/lib/escrow.ts` exports `toXOnly` and `buildEscrowContext`
- [ ] `src/routes/products/index.ts` composes and re-exports the `products` sub-router
- [ ] `src/routes/products/crud.ts` handles GET /, GET /:id, POST /, GET /:id/check-payment
- [ ] `src/routes/products/refund.ts` handles GET /:id/get-psbts, POST /:id/refund, POST /:id/finalize-refund
- [ ] `src/routes/products/collaborate.ts` handles all 7 collaborative endpoints
- [ ] `src/index.ts` contains only app setup, CORS, route mounting, and server start (no dead code, no unused imports)
- [ ] Old `src/routes/products.ts` is deleted
- [ ] `check-payment` and refund handlers use `buildEscrowContext` instead of inline pubkey decoding
- [ ] API surface is identical — all URLs, request/response shapes unchanged
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run dev` starts without errors

## Files to Create or Modify

- `src/lib/escrow.ts` — **create**: shared escrow helpers
- `src/routes/products/index.ts` — **create**: sub-router composition
- `src/routes/products/crud.ts` — **create**: CRUD + check-payment
- `src/routes/products/refund.ts` — **create**: refund flow
- `src/routes/products/collaborate.ts` — **create**: collaborative flow
- `src/index.ts` — **modify**: clean up dead code, update import
- `src/routes/products.ts` — **delete**: replaced by directory

## Constraints

- Follow Conventional Commits (no AI attribution in commit messages)
- All code and comments in English
- Use `.js` extensions in all ESM imports
- Do not edit auto-generated files in `src/generated/prisma/`
- Do not change any endpoint behavior, URL, or response shape
- Do not change the Prisma schema or database
- Keep changes focused on file reorganization — no feature additions
