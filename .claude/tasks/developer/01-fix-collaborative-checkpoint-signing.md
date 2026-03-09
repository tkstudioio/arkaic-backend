# Task: Fix collaborative checkpoint signing flow

## Context

The collaborative escrow release flow fails at `finalizeTx` with `INVALID_SIGNATURE` on checkpoint transactions.

**Root cause**: checkpoint transactions must be signed by the **recipient** of the funds (the new VTXO owner). In the collaborative flow the recipient is the **seller**, but the current code sends checkpoints to the **buyer** to sign — producing invalid signatures.

The refund flow works correctly because the buyer is both the spender and the recipient, so the buyer's checkpoint signature is valid.

### Current (broken) collaborative flow

1. `GET /:id/collaborate-psbts` — seller gets unsigned PSBT
2. `POST /:id/collaborate` — seller sends seller-signed PSBT → saved in DB, status → `sellerReady`
3. `GET /:id/collab-status` — buyer retrieves seller-signed PSBT
4. `POST /:id/confirm-collaborate` — buyer sends buyer+seller signed PSBT → `submitTx` → returns `{ arkTxid, signedCheckpointTxs }` to buyer
5. `POST /:id/finalize-collaborate` — buyer sends buyer-signed checkpoints → `finalizeTx` → **INVALID_SIGNATURE** (checkpoints need seller's key, not buyer's)

### Relevant files

- `src/routes/products.ts` — all escrow route handlers (lines 377–633)
- `prisma/schema.prisma` — Products model, `sellerSignedCollabPsbt` field, `ProductStatus` enum
- `src/lib/ark.ts` — `arkProvider`, `indexerProvider`, `getServerPubkey`

### Key SDK calls

- `buildOffchainTx(inputs, outputs, serverUnrollScript)` → `{ arkTx, checkpoints }`
- `arkProvider.submitTx(signedPsbt, checkpointPsbtsBase64[])` → `{ arkTxid, signedCheckpointTxs }`
- `arkProvider.finalizeTx(arkTxid, signedCheckpointTxs)` — requires user-signed checkpoints

## Goal

Restructure the collaborative flow so that the **seller signs both the main PSBT and the checkpoint transactions** in a single pass, before the buyer completes the transaction. The buyer's role is reduced to adding their signature to the main PSBT and triggering finalization.

### New flow

1. `GET /:id/collaborate-psbts` — **no changes**. Seller gets the unsigned main PSBT.
2. `POST /:id/collaborate` — **changed**. Seller sends their signed main PSBT. The backend:
   - Rebuilds the transaction context (escrowScript, inputs, outputs, etc.)
   - Calls `buildOffchainTx` to get checkpoints
   - Calls `arkProvider.submitTx(sellerSignedPsbt, checkpointPsbtsBase64[])` to get `{ arkTxid, signedCheckpointTxs }`
   - Returns `signedCheckpointTxs` to the seller for signing
   - Saves the `arkTxid` in the DB (new field)
   - Status remains `fundLocked` (not yet `sellerReady`)
3. `POST /:id/collaborate-checkpoints` — **new endpoint**. Seller sends their signed checkpoint txs. The backend:
   - Saves `sellerSignedCheckpoints` in the DB (new field)
   - Sets status → `sellerReady`
4. `GET /:id/collab-status` — **changed**. Returns the seller-signed main PSBT (already in DB as `sellerSignedCollabPsbt`) so the buyer can add their signature. No checkpoint info needed for the buyer.
5. `POST /:id/confirm-collaborate` — **changed**. Buyer sends their fully-signed PSBT (buyer+seller sigs on main tx). The backend:
   - Reads `arkTxid` and `sellerSignedCheckpoints` from DB
   - Calls `arkProvider.finalizeTx(arkTxid, sellerSignedCheckpoints)`
   - Updates status → `payed`
   - Returns success
6. **Remove** `POST /:id/finalize-collaborate` — no longer needed; finalization happens inside `confirm-collaborate`.

## Acceptance Criteria

- [ ] `POST /:id/collaborate` calls `submitTx` with the seller-signed PSBT and unsigned checkpoint PSBTs, stores `arkTxid` in the DB, and returns `signedCheckpointTxs` to the seller
- [ ] New endpoint `POST /:id/collaborate-checkpoints` accepts seller-signed checkpoints and saves them to the DB, sets status → `sellerReady`
- [ ] `GET /:id/collab-status` returns the seller-signed PSBT when status is `sellerReady` (no change in shape, just confirm it still works)
- [ ] `POST /:id/confirm-collaborate` reads `arkTxid` and seller-signed checkpoints from DB, calls `finalizeTx`, and sets status → `payed`
- [ ] `POST /:id/finalize-collaborate` endpoint is removed
- [ ] Prisma schema has new fields: `collabArkTxid String?` and `sellerSignedCheckpoints String?` on the `Products` model
- [ ] `npx prisma generate` and `npx prisma migrate dev` run without errors
- [ ] `npx tsc --noEmit` passes
- [ ] The refund flow is not affected by these changes

## Files to Create or Modify

- `prisma/schema.prisma` — add `collabArkTxid String?` and `sellerSignedCheckpoints String?` to `Products`
- `src/routes/products.ts` — restructure collaborative endpoints as described above
- Run `npx prisma migrate dev` and `npx prisma generate` after schema changes

## Constraints

- Follow Conventional Commits (no AI attribution in commit messages)
- All code and comments in English
- Use `.js` extensions in all ESM imports
- Do not edit auto-generated files in `src/generated/prisma/`
- Keep changes minimal and focused on the collaborative flow fix
- Do not change the refund flow
- Store `sellerSignedCheckpoints` as a JSON-stringified array of base64 strings
