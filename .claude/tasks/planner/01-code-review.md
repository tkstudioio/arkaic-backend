# Code Review Report

## Summary

The codebase is well-structured for an early-stage project, with clear separation between routes, libraries, and generated code. The main issues are: (1) massive code duplication in `escrows.ts` where PSBT-building logic is repeated across four endpoints, (2) inconsistent input validation -- some endpoints use `sValidator`/zod while others use raw `c.req.json()`, (3) missing authorization checks on several chat-related endpoints, and (4) debug `console.log` statements left in auth middleware. Security and data integrity issues in the escrow flow should be prioritized.

## Findings

### [src/routes/api/escrows.ts -- Duplicated PSBT-building logic]

**Category**: Readability
**Severity**: High

**Issue**: The PSBT-building logic (fetch ark info, build escrow context, decode checkpoint tapscript, build recipient script, fetch VTXOs, map inputs, compute total value, build outputs) is duplicated nearly identically across four endpoints: `seller-psbt` (lines 201-266), `buyer-submit-psbt` (lines 314-397), `refund/psbt` (lines 498-562), and `refund/submit-signed-psbt` (lines 565-638). This makes the code hard to maintain and error-prone when changes are needed.

**Evidence**: Lines 210-258 and lines 329-376 are almost character-for-character identical. Lines 506-554 and 578-624 are also near-duplicates differing only in which path (refund vs collaborative) and which pubkey (buyer vs seller) is the recipient.

**Recommendation**: Extract a shared helper function (e.g., `buildEscrowTransaction(escrow, pathType: 'collaborative' | 'refund')`) in `src/lib/escrow.ts` that returns `{ psbt, checkpoints, recipientAddress, inputs, outputs }`. Each endpoint would call this helper instead of rebuilding everything inline.

---

### [src/routes/api/escrows.ts -- Missing input validation on POST endpoints]

**Category**: Security
**Severity**: High

**Issue**: Several POST endpoints use raw `await c.req.json()` without any validation: `seller-submit-psbt` (line 272), `buyer-submit-psbt` (line 317), `buyer-sign-checkpoints` (line 405), `seller-sign-checkpoints` (line 461), `refund/submit-signed-psbt` (line 568), and `refund/finalize` (line 644). While basic null checks exist for top-level fields, there is no type validation on the shape of `signedPsbt` (should be a string) or `signedCheckpointTxs` (should be an array of strings). Malformed input could cause cryptic errors deep in the Ark SDK.

**Evidence**:

```typescript
const { signedPsbt } = await c.req.json(); // line 272 -- no schema validation
const { signedCheckpointTxs } = await c.req.json(); // line 405 -- no schema validation
```

**Recommendation**: Add `sValidator` with zod schemas to these endpoints, consistent with how `POST /escrows/:chatId` and the listings/messages routes already do it. For example: `z.object({ signedPsbt: z.string() })` and `z.object({ signedCheckpointTxs: z.array(z.string()) })`.

---

### [src/routes/api/escrows.ts -- GET /address/:address has side effects without atomic updates]

**Category**: Security
**Severity**: Medium

**Issue**: The `GET /address/:address` endpoint (line 130) performs state-changing `updateMany` operations on the escrow (lines 166-169, 176-192). The `updateMany` call is used instead of the simpler `update` (address is unique/PK), and the update-then-refetch pattern (`updateMany` followed by `findFirst`) is not wrapped in a transaction, creating a potential race condition where concurrent requests could read stale state.

**Evidence**:

```typescript
await prisma.escrow.updateMany({
  where: { address, status: "awaitingFunds" },
  data: { status: "partiallyFunded" },
});
const updatedEscrow = await prisma.escrow.findFirst({ where: { address } });
```

**Recommendation**: Use `prisma.escrow.update()` (with the unique `address` key) instead of `updateMany` + `findFirst`. Since the escrow was already fetched and verified at line 134, update only the specific record and return its updated state. Also consider wrapping the update+fetch in a transaction to prevent race conditions.

---

### [src/lib/auth.ts -- Debug console.log left in verifySignature middleware]

**Category**: Readability
**Severity**: Medium

**Issue**: Lines 60-61 contain `console.log(pubkey)` and `console.log(sortedValues)` which log the user's public key and the full request body to stdout on every signed request. This is a leftover debug statement that leaks potentially sensitive data in production logs.

**Evidence**:

```typescript
console.log(pubkey); // line 60
console.log(sortedValues); // line 61
```

**Recommendation**: Remove both `console.log` statements.

---

### [src/routes/api/messages.ts -- Missing authorization check on POST /:chatId]

**Category**: Security
**Severity**: Medium

**Issue**: The `POST /:chatId` endpoint (line 12) fetches the chat but never verifies that `senderPubkey` is either the buyer or the seller of that chat. Any authenticated user who knows a `chatId` could send messages into arbitrary chats.

**Evidence**:

```typescript
const chat = await prisma.chat.findFirst({
  where: { id: chatId },
  include: { listing: true },
});
// No check: senderPubkey === chat.buyerPubkey || senderPubkey === chat.listing.sellerPubkey
```

**Recommendation**: After fetching the chat, add: `if (senderPubkey !== chat.buyerPubkey && senderPubkey !== chat.listing.sellerPubkey) return c.text("Forbidden", 403);`

---

### [src/routes/api/chats.ts -- Missing authorization on POST /:listingId (seller can create chat on own listing)]

**Category**: Security
**Severity**: Medium

**Issue**: The `POST /:listingId` endpoint (line 110) allows any authenticated user to create a chat on any listing. There is no check that prevents the seller from opening a chat on their own listing. While the naming convention (`buyerPubkey`) implies only buyers should create chats, the seller is not explicitly excluded.

**Evidence**:

```typescript
chats.post("/:listingId", verifySignature, async (c) => {
  const buyerPubkey = c.get("pubkey");
  // No check: buyerPubkey !== listing.sellerPubkey
```

**Recommendation**: Fetch the listing and verify `buyerPubkey !== listing.sellerPubkey` before creating the chat. Return 403 if they match.

---

### [src/routes/api/escrows.ts -- Missing status validation in collaborative signing path]

**Category**: Security
**Severity**: Medium

**Issue**: The `seller-psbt` endpoint (line 201) does not validate that `escrow.status` is `fundLocked` before generating a PSBT. This means a seller could request a PSBT even when the escrow is in `awaitingFunds` or `completed` state. Similarly, `buyer-sign-checkpoints` does not check for `buyerSubmitted` status, and `seller-sign-checkpoints` does not check for `buyerCheckpointsSigned`. The refund path correctly validates `refundableStatuses` (line 658), but the collaborative path lacks similar guards.

**Evidence**:

```typescript
// seller-psbt -- no status check at all
const escrow = await prisma.escrow.findUnique({ where: { address } });
if (!escrow) return c.json({ error: "Escrow not found" }, 404);
if (escrow.sellerPubkey !== pubkey) return c.json({ error: "Forbidden" }, 403);
// proceeds immediately to build PSBT
```

**Recommendation**: Add status validation to `seller-psbt` (should be `fundLocked`), `buyer-sign-checkpoints` (should be `buyerSubmitted`), and `seller-sign-checkpoints` (should be `buyerCheckpointsSigned`). Follow the same pattern as the refund finalize endpoint.

---

### [src/routes/api/escrows.ts -- Missing error handling on Ark provider calls]

**Category**: Security
**Severity**: Medium

**Issue**: Multiple endpoints call `arkProvider.getInfo()`, `indexerProvider.getVtxos()`, `arkProvider.submitTx()`, and `arkProvider.finalizeTx()` without try/catch. If the Ark server is down or returns an error, the request will crash with an unhandled exception and return a generic 500. Only `refund/submit-signed-psbt` (line 627) and `refund/finalize` (line 666) have try/catch around Ark calls.

**Evidence**: `seller-psbt` (line 210), `buyer-submit-psbt` (line 329), `seller-sign-checkpoints` (line 476) all lack try/catch around external service calls.

**Recommendation**: Wrap all `arkProvider` and `indexerProvider` calls in try/catch blocks that return meaningful error responses (e.g., `c.json({ error: "Ark server unavailable" }, 502)`).

---

### [src/routes/api/listings.ts -- No pagination on GET /]

**Category**: Performance
**Severity**: Medium

**Issue**: `GET /listings` (line 40) fetches all listings from the database with no pagination, limit, or cursor. As the marketplace grows, this will return increasingly large payloads and slow down both the database and the API response.

**Evidence**:

```typescript
const allListings = await prisma.listing.findMany({
  where: { sellerPubkey: { not: pubkey } },
  include: { seller: true },
});
```

**Recommendation**: Add `take` and `skip` (or cursor-based) pagination parameters. A reasonable default limit would be 20-50 items.

---

### [src/lib/auth.ts -- AuthEnv type includes `signature` but not all middleware paths set it]

**Category**: TypeScript
**Severity**: Low

**Issue**: `AuthEnv` declares `Variables: { pubkey: string; signature: string }`, but `bearerAuth` only sets `pubkey`. Routes that use `bearerAuth` without `verifySignature` (e.g., `GET /listings`, `GET /chats/:chatId`) will have `c.get("signature")` return `undefined` at runtime despite the type claiming it is `string`.

**Evidence**:

```typescript
export type AuthEnv = { Variables: { pubkey: string; signature: string } };
```

**Recommendation**: Split into two types -- one for bearer-only routes and one for signed routes.

---

### [src/routes/api/chats.ts -- lodash imported for a single isEmpty call]

**Category**: Performance
**Severity**: Low

**Issue**: The entire lodash library is imported (line 4: `import _ from "lodash"`) but only `_.isEmpty()` is used once on line 27. This adds unnecessary bundle weight.

**Evidence**:

```typescript
import _ from "lodash";
// ...
if (_.isEmpty(chats)) return c.text("Chat not found", 404);
```

**Recommendation**: Replace with `if (chats.length === 0)` and remove the lodash import.

---

### [src/routes/api/escrows.ts -- Unused lodash import]

**Category**: TypeScript
**Severity**: Low

**Issue**: `lodash` is imported on line 17 (`import _ from "lodash"`) but never used anywhere in the file.

**Evidence**: `import _ from "lodash";` -- no references to `_` in the file.

**Recommendation**: Remove the unused import.

---

### [CLAUDE.md -- Import convention documentation mismatch]

**Category**: Consistency
**Severity**: Low

**Issue**: CLAUDE.md states "All `.js` extensions in imports are required (ESM resolution)" but all source files use `@/*` path aliases (e.g., `@/lib/prisma`, `@/routes/ws`) via tsconfig paths. No file uses `.js` extension imports.

**Recommendation**: Update CLAUDE.md to reflect the actual convention of using `@/` path aliases via tsx.

---

### [src/lib/prisma.ts -- Hardcoded database URL]

**Category**: Consistency
**Severity**: Low

**Issue**: The database URL is hardcoded as `"file:./dev.db"` (line 5) instead of reading from an environment variable. The `.env.example` file defines `DATABASE_URL` but it is never used.

**Evidence**:

```typescript
const adapter = new PrismaBetterSqlite3({
  url: "file:./dev.db",
});
```

**Recommendation**: Use `process.env.DATABASE_URL"` to allow configuration via environment variables.

---

### [.env.example -- Missing JWT_SECRET]

**Category**: Consistency
**Severity**: Low

**Issue**: The `.env.example` file only contains `DATABASE_URL`. The app requires `JWT_SECRET` (checked at startup in `auth.ts` line 15-17 and in middleware), but this is not documented in the example env file.

**Recommendation**: Add `JWT_SECRET="your-secret-here"` to `.env.example`.

---

### [src/routes/ws.ts -- No heartbeat/ping mechanism for WebSocket connections]

**Category**: Performance
**Severity**: Low

**Issue**: The WebSocket implementation stores connections in a `Map` but has no ping/pong heartbeat mechanism. Stale connections from clients that silently disconnect (e.g., mobile network switch, laptop sleep) will accumulate in the `clients` map indefinitely, and `ws.send()` calls to dead connections will silently fail or throw.

**Recommendation**: Add a periodic ping interval (e.g., every 30 seconds) that removes connections which fail to respond with a pong within a timeout.

---

### [src/routes/api/chats.ts -- GET /:chatId/escrow leaks escrow existence]

**Category**: Security
**Severity**: Low

**Issue**: The `GET /:chatId/escrow` endpoint (line 32) first fetches the escrow, then checks authorization. If the escrow exists but belongs to another user, it returns 404. But if no escrow exists at all, it returns 204. This inconsistency could leak information about whether a chat has an escrow. Additionally, this endpoint is partially redundant with `GET /escrows/:chatId`.

**Evidence**:

```typescript
if (escrow && escrow.buyerPubkey !== pubkey && escrow.sellerPubkey !== pubkey)
  return c.text("Escrow not found", 404);
if (!escrow) return c.body(null, 204);
```

**Recommendation**: Verify the user is a participant of the chat first (similar to `GET /:chatId`), then look up the escrow. Use only chat/escrow.

## Priority Summary

| #   | File / Area                                        | Category    | Severity |
| --- | -------------------------------------------------- | ----------- | -------- |
| 1   | `src/routes/api/escrows.ts`                        | Security    | High     |
|     | -- Missing input validation on POST endpoints      |             |          |
| 2   | `src/routes/api/escrows.ts`                        | Readability | High     |
|     | -- Duplicated PSBT-building logic                  |             |          |
| 3   | `src/routes/api/messages.ts`                       | Security    | Medium   |
|     | -- Missing chat membership check                   |             |          |
| 4   | `src/routes/api/chats.ts`                          | Security    | Medium   |
|     | -- Seller can create chat on own listing           |             |          |
| 5   | `src/routes/api/escrows.ts`                        | Security    | Medium   |
|     | -- Missing status validation in collaborative path |             |          |
| 6   | `src/routes/api/escrows.ts`                        | Security    | Medium   |
|     | -- Missing error handling on Ark provider calls    |             |          |
| 7   | `src/routes/api/escrows.ts`                        | Security    | Medium   |
|     | -- GET with side effects, non-atomic updates       |             |          |
| 8   | `src/lib/auth.ts`                                  | Readability | Medium   |
|     | -- Debug console.log in middleware                 |             |          |
| 9   | `src/routes/api/listings.ts`                       | Performance | Medium   |
|     | -- No pagination on GET /                          |             |          |
|     |                                                    |             |          |
| 11  | `src/routes/api/chats.ts`                          | Performance | Low      |
|     | -- Unnecessary lodash import                       |             |          |
| 12  | `src/routes/api/escrows.ts`                        | TypeScript  | Low      |
|     | -- Unused lodash import                            |             |          |
| 13  | `src/lib/auth.ts`                                  | TypeScript  | Low      |
|     | -- AuthEnv signature type inaccuracy               |             |          |
| 14  | `CLAUDE.md`                                        | Consistency | Low      |
|     | -- Import convention docs vs reality               |             |          |
| 15  | `src/lib/prisma.ts`                                | Consistency | Low      |
|     | -- Hardcoded database URL                          |             |          |
| 16  | `.env.example`                                     | Consistency | Low      |
|     | -- Missing JWT_SECRET                              |             |          |
| 17  | `src/routes/ws.ts`                                 | Performance | Low      |
|     | -- No WebSocket heartbeat                          |             |          |
| 18  | `src/routes/api/chats.ts`                          | Security    | Low      |
|     | -- Escrow existence leak in GET /:chatId/escrow    |             |          |
| 19  | `src/index.ts`                                     | Security    | Low      |
|     | -- CORS with no origin restrictions                |             |          |

## Notes for the Planner

- **Escrow route fixes should be grouped**: Findings 1, 2, 5, 6, 7, and 10 all affect `src/routes/api/escrows.ts`. The PSBT duplication extraction (finding 2) should be done first, as it simplifies applying the other fixes. Status validation (finding 5) and error handling (finding 6) can be applied in the same pass.
- **Authorization fixes should be grouped**: Findings 3 and 4 are small, independent authorization checks in `chats.ts` and `messages.ts` that can be done in a single task.
- **Quick wins**: Findings 8 (remove console.log), 11-12 (remove lodash), and 16 (update .env.example) are trivial one-line fixes that can be batched into a cleanup task.
- **The `verifySignature` middleware and POST schema mismatch**: Finding 10 (unused body fields) may be intentional -- the extra fields are likely sent by the client for signature verification (the middleware signs `sortedValues` which excludes `signature`). Before removing them from the zod schema, verify whether the client needs these fields in the signed payload. If so, document this clearly rather than removing them.
- **The import convention issue** (finding 14) is documentation-only -- all source files consistently use `@/` path aliases via tsx. Update CLAUDE.md rather than changing all imports.
