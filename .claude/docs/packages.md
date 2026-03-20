# Modules Reference

> **Audience**: Developer, Planner, Reviewer

## Routes (`src/routes/`)

### auth.ts — Autenticazione

Endpoint per registrazione e login basati su firma Schnorr + JWT.

| Metodo | Path         | Auth            | Scopo                                       |
| ------ | ------------ | --------------- | ------------------------------------------- |
| POST   | `/register`  | verifySignature | Registra/aggiorna account con firma Schnorr |
| POST   | `/challenge` | nessuna         | Genera nonce con scadenza 30s               |
| POST   | `/login`     | nessuna         | Verifica challenge + firma → JWT HS256 (1h) |

---

### listings.ts — Prodotti marketplace

CRUD per i listing del marketplace. Tutti gli endpoint (tranne GET) richiedono auth. Listings can optionally belong to a category via `categoryId`. Supports category and attribute-based filtering on GET endpoints. Attribute validation enforces category-attribute associations, type-correct values, and required attributes. Supports all six attribute types: select (valueId), boolean (valueBool), text (valueText), range (valueText + valueFloat for numeric filtering), date (ISO YYYY-MM-DD in valueText), multi_select (valueIds array stored via ListingAttributeValue join table).

| Metodo | Path           | Auth                         | Scopo                                                 |
| ------ | -------------- | ---------------------------- | ----------------------------------------------------- |
| POST   | `/`            | bearerAuth + verifySignature | Crea listing (valida price > dust fee, opt. categoryId + attributes including multi_select valueIds), returns 201 |
| PATCH  | `/:id`         | bearerAuth + verifySignature | Update listing fields, category, and/or attributes (atomic; cascade delete handles multi_select cleanup) |
| GET    | `/`            | bearerAuth                   | Lista listing paginati con filtro categoria e attributi (`attr_<id>=valueId` for select/multi_select, `attr_<id>=true/false` for boolean, `attr_<id>=min,max` for range) |
| GET    | `/my-listings` | bearerAuth                   | Lista listing dell'utente autenticato (include category + attributes + multiValues) |
| GET    | `/:id`         | bearerAuth                   | Dettaglio listing con seller, category (with parent), attributes, and multiValues |

---

### attributes.ts — Product attributes

Read-only endpoints for browsing attributes and building dynamic category filters. All endpoints require `bearerAuth`.

| Metodo | Path                        | Auth       | Scopo                                                        |
| ------ | --------------------------- | ---------- | ------------------------------------------------------------ |
| GET    | `/`                         | bearerAuth | List all attributes with their predefined values (range metadata fields included automatically) |
| GET    | `/by-category/:categoryId`  | bearerAuth | Attributes for a category with required/isFilterable flags and range metadata (rangeMin/rangeMax/rangeStep/rangeUnit) |
| GET    | `/filters/:categoryId`      | bearerAuth | Filterable attributes with DISTINCT values from actual listings; range type returns metadata instead of values; multi_select returns distinct values via join table |

---

### categories.ts — Category tree

Read-only endpoints for browsing the hierarchical category tree. All endpoints require `bearerAuth`. Root categories include `iconName` (e.g., "shirt", "shopping-bag") and `color` (hex code) fields for UI styling. See `.claude/docs/categories.md` for details on icons and colors.

| Metodo | Path      | Auth       | Scopo                                                         |
| ------ | --------- | ---------- | ------------------------------------------------------------- |
| GET    | `/`       | bearerAuth | List root categories with children (childrenOf is null), includes iconName and color |
| GET    | `/:slug`  | bearerAuth | Category detail with children and categoryAttributes (with attribute values), includes iconName and color |

---

### chats.ts — Conversazioni

Gestione chat buyer-seller per listing specifici.

| Metodo | Path                 | Auth                         | Scopo                          |
| ------ | -------------------- | ---------------------------- | ------------------------------ |
| GET    | `/`                  | bearerAuth                   | All chats for authenticated user (buyer or seller), ordered by most recent message, paginated |
| GET    | `/seller/:listingId` | bearerAuth                   | Chat del seller per un listing |
| GET    | `/:chatId/escrow`    | bearerAuth                   | Escrow associato alla chat     |
| GET    | `/:chatId/offer`     | bearerAuth                   | Ultima offerta attiva per chat |
| GET    | `/:chatId`           | bearerAuth                   | Dettaglio chat completo        |
| POST   | `/:listingId`        | bearerAuth + verifySignature | Crea chat (idempotente)        |

---

### favorites.ts — User listing bookmarks

Favorite/bookmark management for listings. All endpoints require `bearerAuth`. No `verifySignature` needed (no Schnorr-signed bodies).

| Metodo | Path           | Auth       | Scopo                                          |
| ------ | -------------- | ---------- | ---------------------------------------------- |
| GET    | `/`            | bearerAuth | List favorited listings, paginated with total   |
| POST   | `/:listingId`  | bearerAuth | Add favorite (idempotent upsert, returns 201)   |
| DELETE | `/:listingId`  | bearerAuth | Remove favorite (idempotent, no error if absent)|

---

### messages.ts — Messaggi e offerte

Invio messaggi, creazione offerte, risposta a offerte. Notifiche WebSocket integrate.

| Metodo | Path                               | Auth                         | Scopo                          |
| ------ | ---------------------------------- | ---------------------------- | ------------------------------ |
| POST   | `/:chatId`                         | bearerAuth + verifySignature | Invia messaggio o crea offerta |
| POST   | `/:chatId/offers/:offerId/respond` | bearerAuth + verifySignature | Seller accetta/rifiuta offerta |
| GET    | `/:chatId/offers/active`           | bearerAuth                   | Offerta attiva per chat        |

---

### escrows.ts — Escrow lifecycle

Il file piu' complesso. Gestisce l'intero ciclo di vita dell'escrow Bitcoin.

#### Endpoint generali

| Metodo | Path                | Auth                         | Scopo                                                  |
| ------ | ------------------- | ---------------------------- | ------------------------------------------------------ |
| GET    | `/:chatId`          | bearerAuth                   | Escrow per chat ID                                     |
| GET    | `/address/:address` | bearerAuth                   | Escrow per address (auto-update stato da indexer)     |
| POST   | `/:chatId`          | bearerAuth + verifySignature | Crea escrow con long-polling (attesa 30s primo VTXO)  |

#### Flusso collaborativo (3-of-3)

| Metodo | Path                                                    | Auth                         | Stato richiesto        |
| ------ | ------------------------------------------------------- | ---------------------------- | ---------------------- |
| GET    | `/address/:address/collaborate/seller-psbt`             | bearerAuth                   | fundLocked             |
| POST   | `/address/:address/collaborate/seller-submit-psbt`      | bearerAuth                   | fundLocked             |
| GET    | `/address/:address/collaborate/buyer-psbt`              | bearerAuth                   | sellerReady            |
| POST   | `/address/:address/collaborate/buyer-submit-psbt`       | bearerAuth + verifySignature | sellerReady            |
| POST   | `/address/:address/collaborate/buyer-sign-checkpoints`  | bearerAuth                   | buyerSubmitted         |
| GET    | `/address/:address/collaborate/seller-checkpoints`      | bearerAuth                   | buyerCheckpointsSigned |
| POST   | `/address/:address/collaborate/seller-sign-checkpoints` | bearerAuth                   | buyerCheckpointsSigned |

#### Flusso refund (2-of-2 con timelock)

| Metodo | Path                                          | Auth                         | Stato richiesto                        |
| ------ | --------------------------------------------- | ---------------------------- | -------------------------------------- |
| GET    | `/address/:address/refund/psbt`               | bearerAuth                   | fundLocked                             |
| POST   | `/address/:address/refund/submit-signed-psbt` | bearerAuth                   | fundLocked                             |
| POST   | `/address/:address/refund/finalize`           | bearerAuth + verifySignature | fundLocked/partiallyFunded/sellerReady |

---

## Lib (`src/lib/`)

### prisma.ts — Database client

Singleton `PrismaClient` con adapter `better-sqlite3`. Importa da `@/lib/prisma`.

### ark.ts — Ark protocol providers

| Export                    | Tipo                     | Scopo                           |
| ------------------------- | ------------------------ | ------------------------------- |
| `arkProvider`             | `RestArkProvider`        | Submit/finalize transazioni Ark |
| `indexerProvider`         | `RestIndexerProvider`    | Query VTXO per script           |
| `getServerPubkey()`       | `async () => Uint8Array` | Pubkey del server Ark           |
| `getNetworkTimeSeconds()` | `async () => number`     | Tempo corrente dalla chain      |

### escrow.ts — Escrow helpers

| Export                                        | Scopo                                               |
| --------------------------------------------- | --------------------------------------------------- |
| `toXOnly(pubkey)`                             | Converte pubkey a x-only (32 bytes)                 |
| `buildEscrowContext(buyer, seller, timelock)` | Costruisce tapscript escrow (refund + collab paths) |
| `buildEscrowTransaction(escrow, pathType)`    | Costruisce PSBT + checkpoints per una transazione   |

### auth.ts — Auth middleware

| Export            | Tipo       | Scopo                                                         |
| ----------------- | ---------- | ------------------------------------------------------------- |
| `AuthEnv`         | Type       | Tipo Hono env con `pubkey` e `signature` nelle variables      |
| `bearerAuth`      | Middleware | Verifica JWT Bearer, imposta `c.set("pubkey")`                |
| `verifySignature` | Middleware | Verifica firma Schnorr sul body, imposta `c.set("signature")` |

### category.ts — Category ancestry helper

| Export                 | Tipo     | Scopo                                                                       |
| ---------------------- | -------- | --------------------------------------------------------------------------- |
| `collectAncestorIds`   | Function | Returns the given categoryId plus all ancestor IDs up to the root. Accepts both `PrismaClient` and transaction client, ensuring transactional isolation when populating `ListingCategory` ancestry during create/update operations. |

### system-messages.ts — System message helper

| Export                 | Tipo     | Scopo                                                                       |
| ---------------------- | -------- | --------------------------------------------------------------------------- |
| `SYSTEM_SENDER`        | Constant | Sentinel value `"SYSTEM"` (exported for reference, not used as senderPubkey)|
| `createSystemMessage`  | Function | Creates a `Message` with `isSystem: true`, `senderPubkey: null`, and sends `new_message` WS notifications. Accepts both `PrismaClient` and transaction client. |

---

## WebSocket (`src/routes/ws.ts`)

| Export                     | Scopo                                                       |
| -------------------------- | ----------------------------------------------------------- |
| `sendToUser(pubkey, data)` | Invia messaggio JSON a tutte le connessioni di un utente    |
| `setupWebSocket(app)`      | Monta endpoint `/ws` con autenticazione JWT via query param |

w
