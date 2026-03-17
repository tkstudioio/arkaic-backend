# Review Handoff — 01-code-review fixes

## Touched Files

- `src/lib/auth.ts` — Removed debug console.logs, made `signature` optional in `AuthEnv`
- `src/lib/escrow.ts` — Added `buildEscrowTransaction()` shared helper for PSBT building
- `src/lib/prisma.ts` — Use `process.env.DATABASE_URL` with fallback
- `src/routes/api/escrows.ts` — Major refactor: extracted PSBT duplication, added input validation (zod), status checks, error handling, fixed atomic updates
- `src/routes/api/chats.ts` — Removed lodash, added seller self-chat prevention, fixed escrow endpoint auth
- `src/routes/api/messages.ts` — Added chat membership authorization check
- `src/routes/api/listings.ts` — Added pagination (limit/offset) to GET /
- `.env.example` — Added `JWT_SECRET`
- `CLAUDE.md` — Fixed import convention docs (`@/` aliases instead of `.js` extensions)

## Changes Summary

### Security fixes
- **Input validation**: All escrow POST endpoints now use `sValidator` + zod schemas
- **Authorization**: Messages POST checks sender is chat participant; Chats POST prevents seller self-chat; Chats GET escrow checks chat membership first
- **Status validation**: `seller-psbt` requires `fundLocked`, `buyer-sign-checkpoints` requires `buyerSubmitted`, `seller-sign-checkpoints` requires `buyerCheckpointsSigned`
- **Error handling**: All Ark provider calls wrapped in try/catch returning 502

### Readability / Maintenance
- **PSBT extraction**: Duplicated PSBT-building logic from 4 endpoints extracted into `buildEscrowTransaction()` in `src/lib/escrow.ts`
- **Lodash removal**: Removed from both `escrows.ts` (unused) and `chats.ts` (replaced with `.length === 0`)
- **Debug logs**: Removed `console.log(pubkey)` and `console.log(sortedValues)` from auth middleware

### Data integrity
- **Atomic updates**: `GET /address/:address` now uses `prisma.escrow.update()` with unique key instead of `updateMany` + `findFirst`

### Performance
- **Pagination**: `GET /listings` now accepts `limit` (default 20, max 100) and `offset` query params

### Config / Docs
- `prisma.ts` reads `DATABASE_URL` from env
- `.env.example` includes `JWT_SECRET`
- `CLAUDE.md` documents `@/` path aliases

## Validation

- `npx tsc --noEmit` — pass (zero errors)

## Test Flow

1. Verify escrow creation still works (POST /escrows/:chatId)
2. Test collaborative flow end-to-end: seller-psbt -> seller-submit-psbt -> buyer-psbt -> buyer-submit-psbt -> buyer-sign-checkpoints -> seller-checkpoints -> seller-sign-checkpoints
3. Verify status guards reject out-of-order requests (e.g., seller-psbt on awaitingFunds returns 400)
4. Verify input validation rejects malformed payloads (e.g., signedPsbt as number)
5. Test refund flow end-to-end
6. Verify seller cannot create chat on own listing (403)
7. Verify non-participant cannot send messages (403)
8. Verify GET /listings pagination works with ?limit=5&offset=0

## Known Limitations

- WebSocket heartbeat (finding 17) not addressed — lower priority, can be a separate task
- CORS origin restriction (finding 19) not addressed — requires knowing the frontend domain
