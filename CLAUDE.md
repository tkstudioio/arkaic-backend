# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Arkaic backend — a Hono-based TypeScript API for a Bitcoin escrow marketplace built on the Ark protocol (mutinynet). Buyers and sellers exchange funds through escrow VTXOs with timelock-based refund and collaborative release paths.

## Commands

- **Dev server:** `npm run dev` (uses `tsx watch` with `.env.local`, serves on port 3000)
- **Type check:** `npx tsc --noEmit`
- **Prisma generate:** `npx prisma generate`
- **Prisma migrate:** `npx prisma migrate dev`
- **Install deps:** `npm install`

## Architecture

- **Framework:** Hono (lightweight web framework), ESM-only (`"type": "module"`)
- **Runtime:** Node.js with `@hono/node-server` (uses `serve()` in `src/index.ts`)
- **Database:** SQLite via Prisma with `better-sqlite3` adapter. Schema in `prisma/schema.prisma`, generated client output to `src/generated/prisma/`
- **TypeScript:** Strict mode, ESNext target, NodeNext modules

### Source Layout

- `src/index.ts` — App entry point, creates Hono instance, mounts routes, starts server
- `src/routes/products/` — Products route module mounted at `/products`
  - `index.ts` — Composes sub-routers (crud, refund, collaborate)
  - `crud.ts` — CRUD endpoints and payment check
  - `refund.ts` — Refund flow mounted at `/:id/refund` (psbt, submit-signed-psbt, finalize)
  - `collaborate.ts` — Collaborative flow mounted at `/:id/collaborate` (seller-psbt, seller-submit-psbt, buyer-psbt, buyer-submit-psbt, buyer-sign-checkpoints, seller-checkpoints, seller-sign-checkpoints)
- `src/lib/ark.ts` — Ark protocol providers (`RestArkProvider`, `RestIndexerProvider`, `EsploraProvider`) pointing at `mutinynet.arkade.sh`
- `src/lib/prisma.ts` — Prisma client singleton (SQLite at `file:./dev.db`)
- `src/lib/escrow.ts` — Shared escrow helpers (`toXOnly`, `buildEscrowContext`)
- `src/generated/prisma/` — Auto-generated Prisma client (do not edit)

### Escrow Flow

Products go through a state machine: `awaitingFunds` → `fundLocked` → `sellerReady` → `payed` (or `refunded`).

Two spend paths exist for each escrow VTXO:
1. **Collaborative path** (buyer + seller + server 3-of-3): seller gets PSBT (`/:id/collaborate/seller-psbt`), signs (`/seller-submit-psbt`), buyer gets it (`/buyer-psbt`), submits fully-signed (`/buyer-submit-psbt`), buyer signs checkpoints (`/buyer-sign-checkpoints`), seller retrieves (`/seller-checkpoints`) and finalizes (`/seller-sign-checkpoints`)
2. **Refund path** (buyer + server with CLTV timelock): buyer gets PSBT (`/:id/refund/psbt`), signs and submits (`/submit-signed-psbt`), then finalizes (`/finalize`)

All Ark transactions follow: build PSBT → sign → `submitTx` → sign checkpoints → `finalizeTx`.

## Language

All written output must be in **English**: code comments, agent task files, documentation, review reports, commit messages, and responses to the user. This applies regardless of the language used in the request prompt.

## Key Conventions

- Route handlers use Hono's `c` context (e.g., `c.json()`, `c.text()`, `c.req.json()`)
- Pubkeys are hex-encoded, converted to x-only (32 bytes) via `toXOnly()` before use in tapscripts
- Use `@/` path aliases for imports (e.g., `@/lib/prisma`, `@/routes/ws`) — resolved by tsx at runtime
- `@arkade-os/sdk` provides all Ark/Bitcoin primitives (`VtxoScript`, `MultisigTapscript`, `CLTVMultisigTapscript`, `buildOffchainTx`, etc.)
- `@scure/base` for `hex`/`base64` encoding
