# Task: Activity Log per Prodotto

## Context

Il backend Arkaic traccia prodotti escrow con uno stato (`ProductStatus` enum in `prisma/schema.prisma`). Attualmente il flusso collaborativo non registra tutti i passaggi — in particolare manca il tracciamento delle azioni del buyer (firma PSBT e firma checkpoints).

### File rilevanti

- `prisma/schema.prisma` — Schema DB, contiene il modello `Products` e l'enum `ProductStatus`
- `src/routes/products/crud.ts` — CRUD e check-payment (transizione `awaitingFunds` → `fundLocked`)
- `src/routes/products/collaborate.ts` — Flusso collaborativo (seller-submit-psbt → buyer-submit-psbt → buyer-sign-checkpoints → seller-sign-checkpoints)
- `src/routes/products/refund.ts` — Flusso refund (submit-signed-psbt → finalize)
- `src/lib/prisma.ts` — Prisma client singleton
- `src/generated/prisma/` — Client generato (non editare)

### Flusso attuale (collaborativo)

1. `POST /products` → crea prodotto (status: `awaitingFunds`)
2. `GET /products/:id/check-payment` → buyer locka fondi (status: `fundLocked`)
3. `POST /products/:id/collaborate/seller-submit-psbt` → seller firma PSBT (status: `sellerReady`)
4. `POST /products/:id/collaborate/buyer-submit-psbt` → buyer firma PSBT e submit a Ark → **nessun cambio stato** ← BUG
5. `POST /products/:id/collaborate/buyer-sign-checkpoints` → buyer firma checkpoints → **nessun cambio stato** ← BUG
6. `POST /products/:id/collaborate/seller-sign-checkpoints` → seller firma checkpoints e finalizza (status: `payed`)

### Flusso refund

1. `POST /products/:id/refund/submit-signed-psbt` → buyer firma e submit
2. `POST /products/:id/refund/finalize` → buyer firma checkpoints e finalizza (status: `refunded`)

## Goal

1. **Aggiungere un modello `ProductEvent`** (activity log) che registra ogni azione significativa su un prodotto.
2. **Mantenere il campo `status` su `Products`** come stato corrente derivato dall'ultimo evento, ma aggiungere anche gli stati intermedi mancanti.
3. **Loggare un evento** ad ogni endpoint che modifica lo stato del prodotto.

## Schema del modello `ProductEvent`

```prisma
model ProductEvent {
  id        Int      @id @default(autoincrement())
  productId Int
  product   Products @relation(fields: [productId], references: [id])
  action    String   // es: "created", "funds_locked", "seller_signed_psbt", "buyer_signed_psbt", "buyer_signed_checkpoints", "seller_signed_checkpoints", "refund_submitted", "refund_finalized"
  createdAt DateTime @default(now())
  metadata  String?  // JSON opzionale per dati extra (es. arkTxid)
}
```

Aggiungere la relazione inversa su `Products`:
```prisma
model Products {
  // ... campi esistenti ...
  events ProductEvent[]
}
```

## Nuovi stati del `ProductStatus` enum

Aggiungere a `ProductStatus`:
- `buyerSubmitted` — dopo che il buyer firma e submitta la PSBT collaborativa
- `buyerCheckpointsSigned` — dopo che il buyer firma i checkpoints

L'enum diventa:
```
awaitingFunds → fundLocked → sellerReady → buyerSubmitted → buyerCheckpointsSigned → payed
                                         ↘ (refund path) → refunded
```

## Azioni da loggare (mapping endpoint → evento)

| Endpoint | action | status dopo |
|---|---|---|
| `POST /products` | `created` | `awaitingFunds` |
| `GET /products/:id/check-payment` (quando trova fondi) | `funds_locked` | `fundLocked` |
| `POST /:id/collaborate/seller-submit-psbt` | `seller_signed_psbt` | `sellerReady` |
| `POST /:id/collaborate/buyer-submit-psbt` | `buyer_signed_psbt` | `buyerSubmitted` |
| `POST /:id/collaborate/buyer-sign-checkpoints` | `buyer_signed_checkpoints` | `buyerCheckpointsSigned` |
| `POST /:id/collaborate/seller-sign-checkpoints` | `seller_signed_checkpoints` | `payed` |
| `POST /:id/refund/submit-signed-psbt` | `refund_submitted` | (nessun cambio status — è un passo intermedio) |
| `POST /:id/refund/finalize` | `refund_finalized` | `refunded` |

## Endpoint per leggere il log

Aggiungere a `crud.ts`:

```
GET /products/:id/events → restituisce gli eventi del prodotto ordinati per createdAt ASC
```

## Acceptance Criteria

- [ ] Modello `ProductEvent` aggiunto allo schema Prisma con relazione a `Products`
- [ ] Enum `ProductStatus` esteso con `buyerSubmitted` e `buyerCheckpointsSigned`
- [ ] Ogni endpoint che modifica il prodotto crea un `ProductEvent` nel DB
- [ ] Lo status del prodotto viene aggiornato correttamente ad ogni step (inclusi i passaggi mancanti del buyer)
- [ ] Endpoint `GET /products/:id/events` funzionante
- [ ] Migration Prisma creata e applicata (`npx prisma migrate dev`)
- [ ] `npx tsc --noEmit` passa senza errori
- [ ] `GET /products/:id` include gli eventi nella risposta (opzionale, via query param `?include=events` o sempre)

## Files to Create or Modify

- `prisma/schema.prisma` — Aggiungere `ProductEvent`, relazione, nuovi stati enum
- `src/routes/products/crud.ts` — Loggare evento su create e check-payment, aggiungere endpoint events
- `src/routes/products/collaborate.ts` — Loggare evento su ogni step, aggiornare status su buyer-submit-psbt e buyer-sign-checkpoints
- `src/routes/products/refund.ts` — Loggare evento su submit e finalize

## Constraints

- Follow Conventional Commits (no AI attribution in commit messages)
- All code and comments in English
- Use `.js` extensions in all ESM imports
- Do not edit auto-generated files in `src/generated/prisma/`
- Keep changes minimal and focused on the task
- Usare `prisma.$transaction()` dove serve per garantire atomicità tra update status e creazione evento
