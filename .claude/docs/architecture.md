# Architecture

> **Audience**: Planner, Reviewer

## Project Overview

Backend API Hono per un marketplace Bitcoin escrow costruito sul protocollo Ark (mutinynet). Buyer e seller scambiano fondi tramite VTXO escrow con percorsi di refund (timelock) e release collaborativa (3-of-3 multisig).

---

## Application Structure

- **Framework:** Hono (lightweight web framework)
- **Runtime:** Node.js con `@hono/node-server`
- **Database:** SQLite via Prisma con `better-sqlite3` adapter
- **Real-time:** WebSocket via `@hono/node-ws`
- **Protocol:** Ark (Bitcoin L2) via `@arkade-os/sdk`

---

## Source Layout

```
src/
├── index.ts                     # Entry point: Hono app, CORS, route mounting, server
├── lib/
│   ├── prisma.ts              # Prisma client singleton (SQLite, better-sqlite3)
│   ├── ark.ts                 # Ark SDK providers (RestArkProvider, RestIndexerProvider, EsploraProvider)
│   ├── escrow.ts              # Escrow helpers (toXOnly, buildEscrowContext, buildEscrowTransaction)
│   ├── auth.ts                # Auth middleware (bearerAuth JWT, verifySignature Schnorr)
│   └── system-messages.ts     # System message helper (createSystemMessage for lifecycle events)
├── routes/
│   ├── api/
│   │   ├── index.ts           # Router composition: monta tutti i sub-router
│   │   ├── auth.ts            # Register, challenge, login (Schnorr + JWT)
│   │   ├── listings.ts        # CRUD prodotti del marketplace
│   │   ├── chats.ts           # Conversazioni buyer-seller per listing
│   │   ├── messages.ts        # Messaggi, offerte, accettazione offerte
│   │   └── escrows.ts         # Creazione escrow, flusso collaborativo, flusso refund
│   └── ws.ts                  # WebSocket: connessioni per pubkey, notifiche real-time
└── generated/
    └── prisma/                # Client Prisma auto-generato (NON modificare)
```

---

## Route Map

| Prefisso        | File          | Scopo                                     |
| --------------- | ------------- | ----------------------------------------- |
| `/api/auth`     | `auth.ts`     | Registrazione, challenge nonce, login JWT |
| `/api/listings` | `listings.ts` | CRUD listing con firma Schnorr            |
| `/api/chats`    | `chats.ts`    | Gestione chat buyer-seller                |
| `/api/messages` | `messages.ts` | Messaggi, offerte, risposta offerte       |
| `/api/escrows`  | `escrows.ts`  | Escrow lifecycle (create, collab, refund) |
| `/ws`           | `ws.ts`       | WebSocket per notifiche push              |

---

## Data Model (Prisma)

### Entita' principali

| Modello             | Scopo                                           | Chiave primaria      |
| ------------------- | ----------------------------------------------- | -------------------- |
| **Account**         | Utente con pubkey, username, flag arbiter       | `pubkey`             |
| **Listing**         | Prodotto in vendita (nome, prezzo, seller)      | `id` (autoincrement) |
| **Category**        | Categorie gerarchiche (parent/children)         | `id`                 |
| **Chat**            | Conversazione buyer-seller per un listing       | `id`                 |
| **Message**         | Messaggio testuale o di sistema in una chat     | `id`                 |
| **Offer**           | Proposta di prezzo da buyer dentro un messaggio | `id`                 |
| **OfferAcceptance** | Risposta seller a un'offerta (accept/reject)    | `id`                 |
| **Escrow**          | Record VTXO escrow con stato, pubkey, PSBT      | `address` (taproot)  |
| **Review**          | Recensione utente legata a un escrow            | `id`                 |
| **Challenge**       | Nonce per autenticazione con scadenza           | `id`                 |

### Relazioni chiave

- Account → Listing (seller)
- Account → Chat (buyer, arbiter)
- Listing → Chat (one-to-many)
- Chat → Message (one-to-many)
- Chat → Escrow (one-to-one)
- Message → Offer (one-to-one, opzionale)
- Offer → OfferAcceptance (one-to-many)
- Escrow → Account (buyer, seller, arbiter)

---

## Escrow State Machine

```
awaitingFunds
  ↓ (indexer: total < price)
partiallyFunded
  ↓ (indexer: total >= price)
fundLocked
  ├─→ Collaborative path (3-of-3: buyer + seller + server):
  │    sellerReady         → seller firma PSBT
  │    buyerSubmitted      → buyer submits, Ark firma checkpoints
  │    buyerCheckpointsSigned → buyer firma checkpoints
  │    completed           → seller finalizza con finalizeTx()
  │
  └─→ Refund path (2-of-2: buyer + server, con CLTV timelock):
       refunded            → buyer finalizza con timelock scaduto
```

**Transizioni automatiche:** `awaitingFunds` → `partiallyFunded` / `fundLocked` avviene quando si interroga l'indexer (`GET /escrows/address/:address`).

---

## Ark Transaction Flow

1. **Build tapscripts** — `CLTVMultisigTapscript` (refund), `MultisigTapscript` (collab)
2. **Create VtxoScript** — combina entrambi i path
3. **Query indexer** — trova VTXO spendibili allo script escrow
4. **Build inputs** — include tapLeafScript e tapTree dal VtxoScript
5. **Build output** — DefaultVtxo.Script con recipient pubkey e CSV timelock
6. **buildOffchainTx()** — genera PSBT + checkpoint PSBTs
7. **Sign PSBT** — le parti firmano il PSBT
8. **submitTx()** — invia all'Ark server, riceve checkpoints firmati dal server
9. **Sign checkpoints** — le parti firmano i checkpoint
10. **finalizeTx()** — finalizza la transazione sull'Ark server

---

## Authentication & Authorization

### Flusso auth

1. **Register:** firma Schnorr di `"${username} ${pubkey}"` → upsert account
2. **Challenge:** genera nonce con scadenza 30s
3. **Login:** verifica firma del nonce → JWT HS256 (1h expiry)

### Middleware

- `bearerAuth` — estrae JWT, verifica, imposta `c.set("pubkey", ...)`
- `verifySignature` — richiede bearerAuth, estrae firma dal body, verifica Schnorr su campi ordinati

### Pattern autorizzazione

- **Query-level:** includi pubkey nelle WHERE per filtrare solo risorse dell'utente
- **Action-level:** verifica ruolo (buyer/seller/arbiter) prima di procedere
- **Consistenza:** 403 per forbidden, 404 per not found (previeni info leak)

---

## WebSocket Notifications

Il server mantiene una `Map<pubkey, WSContext[]>` per connessioni multiple per utente.

### Tipi di notifica

| Tipo             | Payload               | Quando                  |
| ---------------- | --------------------- | ----------------------- |
| `hello`          | `{ pubkey }`          | Connessione stabilita   |
| `new_message`    | `{ chatId }`          | Nuovo messaggio in chat |
| `new_offer`      | `{ chatId, price }`   | Nuova offerta           |
| `offer_accepted` | `{ chatId, offerId }` | Offerta accettata       |
| `offer_rejected` | `{ chatId, offerId }` | Offerta rifiutata       |
| `escrow_update`  | `{ address }`         | Cambio stato escrow     |
