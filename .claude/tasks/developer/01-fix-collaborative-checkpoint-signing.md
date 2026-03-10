# Task: Fix collaborative checkpoint signing flow

## Context

The collaborative escrow release flow fails at `finalizeTx` with `INVALID_SIGNATURE` on checkpoint transactions.

**Root cause**: The collaborative path uses a **3-of-3 MultisigTapscript** (buyer + seller + server). `submitTx` can only be called after **both** buyer and seller have signed the main PSBT. Additionally, checkpoint transactions must be signed by both the buyer (spender) and the seller (recipient) before `finalizeTx`.

The refund flow works correctly because the buyer is both the spender and the recipient, so only the buyer's checkpoint signature is needed.

### Current (broken) collaborative flow

1. `GET /:id/collaborate-psbts` — seller gets unsigned PSBT
2. `POST /:id/collaborate` — seller sends seller-signed PSBT → backend calls `submitTx` with only seller sig → **INVALID_SIGNATURE** (needs all 3 sigs)

### Relevant files

- `src/routes/products.ts` — all escrow route handlers (lines 377–709)
- `prisma/schema.prisma` — Products model, `serverSignedCheckpoints` / `buyerSignedCheckpoints` fields, `ProductStatus` enum
- `src/lib/ark.ts` — `arkProvider`, `indexerProvider`, `getServerPubkey`

### Key SDK calls

- `buildOffchainTx(inputs, outputs, serverUnrollScript)` → `{ arkTx, checkpoints }`
- `arkProvider.submitTx(signedPsbt, checkpointPsbtsBase64[])` → `{ arkTxid, signedCheckpointTxs }`
- `arkProvider.finalizeTx(arkTxid, signedCheckpointTxs)` — requires fully-signed checkpoints

## Goal

Restructure the collaborative flow so that:
1. The seller signs the main PSBT first (partial signature)
2. The buyer adds their signature to complete the PSBT, then submits via `submitTx`
3. The buyer signs checkpoints (as spender) and saves them
4. The seller retrieves buyer-signed checkpoints, adds their signature (as recipient), and calls `finalizeTx`

### New flow

1. `GET /:id/collaborate-psbts` — **no changes**. Seller gets the unsigned main PSBT.
2. `POST /:id/collaborate` — **changed**. Seller sends their signed main PSBT. The backend:
   - Saves `sellerSignedCollabPsbt` in the DB
   - Sets status → `sellerReady`
   - Returns `{ success: true }` with next-step instructions
3. `GET /:id/collab-status` — **no changes**. Buyer polls until `sellerReady`, then retrieves the seller-signed PSBT to add their own signature.
4. `POST /:id/confirm-collaborate` — **changed**. Buyer sends the fully-signed PSBT (buyer + seller sigs). The backend:
   - Rebuilds the transaction context (escrowScript, inputs, outputs, etc.)
   - Calls `buildOffchainTx` to get checkpoints
   - Calls `arkProvider.submitTx(signedPsbt, checkpointPsbtsBase64[])` → `{ arkTxid, signedCheckpointTxs }`
   - Saves `collabArkTxid` and `serverSignedCheckpoints` in the DB
   - Returns `{ arkTxid, signedCheckpointTxs }` to the buyer for signing
5. `POST /:id/buyer-sign-checkpoints` — **new endpoint**. Buyer sends their signed checkpoint txs. The backend:
   - Saves `buyerSignedCheckpoints` in the DB (JSON-stringified array)
   - Returns `{ success: true }` with next-step instructions
6. `GET /:id/collab-checkpoints` — **new endpoint**. Seller polls for buyer-signed checkpoints. Returns:
   - `{ status, checkpointTxs: null }` if not ready yet
   - `{ status, arkTxid, checkpointTxs }` when buyer has signed
7. `POST /:id/collaborate-checkpoints` — **changed**. Seller sends their signed checkpoint txs. The backend:
   - Calls `arkProvider.finalizeTx(arkTxid, signedCheckpointTxs)`
   - Sets status → `payed`
   - Returns `{ success: true, arkTxid }`
8. **Remove** `POST /:id/finalize-collaborate` — no longer needed.

## Acceptance Criteria

- [x] `POST /:id/collaborate` saves seller-signed PSBT, sets status → `sellerReady`, does NOT call `submitTx`
- [x] `GET /:id/collab-status` returns seller-signed PSBT when status is `sellerReady`
- [x] `POST /:id/confirm-collaborate` calls `submitTx` with fully-signed PSBT, saves `collabArkTxid` and `serverSignedCheckpoints`, returns checkpoints to buyer
- [x] New endpoint `POST /:id/buyer-sign-checkpoints` saves buyer-signed checkpoints to DB
- [x] New endpoint `GET /:id/collab-checkpoints` returns buyer-signed checkpoints for seller to sign
- [x] `POST /:id/collaborate-checkpoints` calls `finalizeTx` with seller-signed checkpoints, sets status → `payed`
- [x] `POST /:id/finalize-collaborate` endpoint is removed
- [x] Prisma schema has fields: `collabArkTxid String?`, `serverSignedCheckpoints String?`, `buyerSignedCheckpoints String?` on `Products`
- [x] Migration created for schema changes
- [ ] `npx tsc --noEmit` passes
- [ ] The refund flow is not affected by these changes

## Files Created or Modified

- `prisma/schema.prisma` — renamed `sellerSignedCheckpoints` → `serverSignedCheckpoints`, added `buyerSignedCheckpoints String?`
- `prisma/migrations/20260309230624_add_buyer_signed_checkpoints/migration.sql` — schema migration
- `src/routes/products.ts` — restructured collaborative endpoints as described above

## Constraints

- Follow Conventional Commits (no AI attribution in commit messages)
- All code and comments in English
- Use `.js` extensions in all ESM imports
- Do not edit auto-generated files in `src/generated/prisma/`
- Keep changes minimal and focused on the collaborative flow fix
- Do not change the refund flow
- Store checkpoint data as JSON-stringified arrays of base64 strings
