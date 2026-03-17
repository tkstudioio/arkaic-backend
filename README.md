# Arkaic Backend

Backend API TypeScript (Hono + Prisma + SQLite) per un marketplace di escrow Bitcoin basato sul protocollo Ark (mutinynet). I buyer e seller negoziavano tramite chat e offer, quindi finalizzano gli scambi attraverso un flusso escrow multi-firma con due path: collaborative (entrambi firmano) e refund (timelock).

**Documentazione completa:** Vedi [`docs/`](docs/) per guide dettagliate su endpoint, flussi e modello dati.

## Stack

- **Framework:** Hono (lightweight web framework, ESM-only)
- **Database:** Prisma + SQLite (`dev.db`)
- **Crypto:** `@noble/curves/secp256k1` (Schnorr signatures), `@arkade-os/sdk` (Ark Bitcoin primitives)
- **Runtime:** Node.js with `@hono/node-server`

## Requisiti

- Node.js 18+
- npm o yarn

## Avvio locale

```bash
npm install
npm run dev
```

Server di default su `http://localhost:3000`.

## Configurazione

`.env.local`:

```env
PORT=3000
```

`.env` (Prisma):

```env
DATABASE_URL="file:./dev.db"
```

## Flussi Principali

### Flusso Collaborative Release

Buyer e seller cooperano per rilasciare i fondi al seller:

1. Buyer crea escrow e invia fondi all'indirizzo escrow
2. Seller richiede PSBT, firma e invia
3. Buyer riceve PSBT, firma completamente e invia ad Ark
4. Buyer firma checkpoint, seller li recupera e finalizza
5. Fondi rilasciati al seller

**Documentazione:** [docs/flow-collaborative-release.md](docs/flow-collaborative-release.md)

### Flusso Refund

Buyer recupera i fondi se il seller scompare o dopo scadenza timelock:

1. Buyer richiede refund PSBT
2. Buyer firma e invia ad Ark
3. Buyer firma checkpoint
4. Buyer finalizza
5. Fondi restituiti al buyer

**Documentazione:** [docs/flow-refund.md](docs/flow-refund.md)

## API Reference

Tutti gli endpoint richiedono autenticazione via Bearer token (tranne `/api/auth/register`, `/api/auth/challenge` e `/api/auth/login`).

### Autenticazione

| Metodo | Endpoint              | Descrizione                                   |
| ------ | --------------------- | --------------------------------------------- |
| POST   | `/api/auth/register`  | Registra account con firma Schnorr            |
| POST   | `/api/auth/challenge` | Richiedi challenge (nonce) per login          |
| POST   | `/api/auth/login`     | Completa login con nonce e firma, ottieni JWT |

[Dettagli completi](docs/api-auth.md)

### Listing

| Metodo | Endpoint                    | Descrizione                                    |
| ------ | --------------------------- | ---------------------------------------------- |
| GET    | `/api/listings`             | Lista listing (esclusi propri) con paginazione |
| POST   | `/api/listings`             | Crea nuovo listing                             |
| GET    | `/api/listings/my-listings` | Elenca propri listing                          |
| GET    | `/api/listings/:id`         | Dettagli listing specifico                     |

[Dettagli completi](docs/api-listings.md)

### Chat

| Metodo | Endpoint                       | Descrizione                |
| ------ | ------------------------------ | -------------------------- |
| POST   | `/api/chats/:listingId`        | Inizia chat con seller     |
| GET    | `/api/chats/:chatId`           | Dettagli chat con messaggi |
| GET    | `/api/chats/:chatId/escrow`    | Escrow associato a chat    |
| GET    | `/api/chats/:chatId/offer`     | Ultima offer valida        |
| GET    | `/api/chats/seller/:listingId` | Chat in cui sei seller     |

[Dettagli completi](docs/api-chats.md)

### Messaggi e Offer

| Metodo | Endpoint                                        | Descrizione             |
| ------ | ----------------------------------------------- | ----------------------- |
| POST   | `/api/messages/:chatId`                         | Invia messaggio o offer |
| POST   | `/api/messages/:chatId/offers/:offerId/respond` | Accetta/rifiuta offer   |
| GET    | `/api/messages/:chatId/offers/active`           | Offer attuale           |

[Dettagli completi](docs/api-messages.md)

### Escrow e Flussi di Pagamento

| Metodo                 | Endpoint                                                            | Descrizione                                           |
| ---------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| POST                   | `/api/escrows/:chatId`                                              | Crea escrow dopo offer accettata                      |
| GET                    | `/api/escrows/:chatId`                                              | Dettagli escrow by chat                               |
| GET                    | `/api/escrows/address/:address`                                     | Dettagli escrow by indirizzo (aggiorna stato funding) |
| **Collaborative Path** |                                                                     |                                                       |
| GET                    | `/api/escrows/address/:address/collaborate/seller-psbt`             | Seller richiede PSBT                                  |
| POST                   | `/api/escrows/address/:address/collaborate/seller-submit-psbt`      | Seller invia PSBT firmato                             |
| GET                    | `/api/escrows/address/:address/collaborate/buyer-psbt`              | Buyer riceve PSBT                                     |
| POST                   | `/api/escrows/address/:address/collaborate/buyer-submit-psbt`       | Buyer invia PSBT firmato ad Ark                       |
| POST                   | `/api/escrows/address/:address/collaborate/buyer-sign-checkpoints`  | Buyer firma checkpoint                                |
| GET                    | `/api/escrows/address/:address/collaborate/seller-checkpoints`      | Seller riceve checkpoint                              |
| POST                   | `/api/escrows/address/:address/collaborate/seller-sign-checkpoints` | Seller finalizza (on-chain)                           |
| **Refund Path**        |                                                                     |                                                       |
| GET                    | `/api/escrows/address/:address/refund/psbt`                         | Buyer richiede refund PSBT                            |
| POST                   | `/api/escrows/address/:address/refund/submit-signed-psbt`           | Buyer invia PSBT ad Ark                               |
| POST                   | `/api/escrows/address/:address/refund/finalize`                     | Buyer finalizza refund (on-chain)                     |

[Dettagli completi](docs/api-escrows.md)

### WebSocket

| Metodo | Endpoint          | Descrizione                       |
| ------ | ----------------- | --------------------------------- |
| GET    | `/ws?token=<JWT>` | WebSocket per notifiche real-time |

Notifiche: `new_message`, `new_offer`, `offer_accepted`, `offer_rejected`, `escrow_update`

[Dettagli completi](docs/api-websocket.md)

## Modello Dati

Il database usa SQLite via Prisma ORM. Principali entità:

- **Account:** Utenti identificati dalla chiave pubblica Schnorr
- **Listing:** Prodotti in vendita con nome, prezzo e seller
- **Chat:** Conversazione tra buyer e seller per una listing
- **Message:** Messaggi e offer dentro una chat
- **Offer/OfferAcceptance:** Proposta prezzo e risposta del seller
- **Escrow:** Contratto multi-firma che detiene i fondi
- **Review:** Valutazioni post-transazione

[Schema completo](docs/data-model.md)

## Architettura

```
src/
  index.ts              # Entry point, monta router
  routes/
    api/
      index.ts          # Composizione sub-router API
      auth.ts           # Autenticazione e login
      listings.ts       # CRUD listing
      chats.ts          # Gestione chat
      messages.ts       # Messaggi e offer
      escrows.ts        # Escrow e flussi di pagamento
    ws.ts               # WebSocket per notifiche
  lib/
    auth.ts             # Middleware autenticazione
    escrow.ts           # Builder PSBT e context
    ark.ts              # Provider Ark (REST API)
    prisma.ts           # Singleton Prisma client
  generated/
    prisma/             # Generated Prisma client (auto)
prisma/
  schema.prisma         # Schema SQLite
```

## Note Operative

- **Rete:** Utilizza mutinynet Ark (`https://mutinynet.arkade.sh`)
- **Pubkey:** Hex-encoded, 33-byte compressed o 32-byte x-only
- **Prezzi:** In satoshi (1 BTC = 100,000,000 sat)
- **JWT:** Token valido 1 ora, incluso in `Authorization: Bearer <TOKEN>`
- **Schnorr:** Tutti i dati critici sono firmati per non-repudiation
- **Escrow address:** Deterministica dalla coppia (buyer, seller, timelock)
- **CLTV Timelock:** Embedded nel refund path, non modificabile dopo creazione escrow
