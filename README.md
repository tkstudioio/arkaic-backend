# Arkaic Backend

Backend API TypeScript (Hono + Prisma + SQLite) per gestire un flusso escrow su Ark (mutinynet) tra seller e buyer.

Il progetto permette di:
- creare listing con prezzo e pubkey del seller;
- avviare un acquisto con pubkey del buyer;
- generare un BIP21 da pagare lato client;
- verificare il pagamento;
- dopo la scadenza del timelock, ottenere e processare il refund tramite PSBT.

## Stack

- Hono (`src/index.ts`)
- Prisma + SQLite (`dev.db`)
- Ark SDK (`@arkade-os/sdk`)

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

## Modello dati principale

`Listing`:
- `id`
- `nome`
- `prezzo` (in satoshi)
- `sellerPubkey`
- `escrowAddress`
- `buyerPubkey`
- `refundRecipientAddress`
- `timelockExpiry`
- `status`: `awaitingFunds | fundLocked | refunded | payed`

Nota: il timelock nel codice è impostato a 60 secondi (`/buy`, valore utile per test).

## Endpoint principali

- `GET /listings` lista listing
- `POST /listings` crea listing
- `POST /listings/:listingId/buy` avvia buy, salva escrow e ritorna BIP21
- `GET /listings/:listingId/check-payment` verifica fondi e, se scaduto timelock, ritorna `refundPsbt`
- `POST /listings/:listingId/claim` invia PSBT firmata buyer, ottiene checkpoint da firmare
- `POST /listings/:listingId/finalize` finalizza refund con checkpoint firmati
- `GET /listings/:listingId/refund-status` stato fondi sul recipient di refund

## Flusso pratico end-to-end

Esempio con `curl`.

### 1) Creo un listing

```bash
curl -X POST http://localhost:3000/listings \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "Oggetto demo",
    "prezzo": 1000,
    "sellerPubkey": "<SELLER_PUBKEY_HEX>"
  }'
```

Risposta: contiene `id` del listing.

### 2) Faccio buy con la pubkey buyer e ottengo BIP21

```bash
curl -X POST http://localhost:3000/listings/1/buy \
  -H "Content-Type: application/json" \
  -d '{
    "buyerPubkey": "<BUYER_PUBKEY_HEX>",
    "refundRecipientAddress": "<ARK_REFUND_ADDRESS>"
  }'
```

Risposta tipica:
- `escrowAddress`
- `refundRecipientAddress`
- `bip21` (da incollare nel client wallet)

### 3) Incollo BIP21 sul client e pago

- Usa il valore `bip21` ritornato dal backend.
- Completa il pagamento dal client.

### 4) Torno sul backend e faccio check-payment

```bash
curl http://localhost:3000/listings/1/check-payment
```

Campi utili:
- `paid`: `true/false`
- `status`: passa a `fundLocked` quando i fondi sono presenti
- `timelockExpired`: `true/false`
- `refundPsbt`: valorizzata solo quando `paid=true` e timelock scaduto

### 5) Attendo la scadenza e recupero la PSBT

Rilancia `check-payment` fino a quando:
- `timelockExpired = true`
- `refundPsbt` non è `null/undefined`

### 6) Firmo la PSBT lato client

- Prendi `refundPsbt` dalla risposta del backend.
- Firma lato client con la chiave buyer.
- Ottieni `signedPsbt`.

### 7) Chiamo /claim con la PSBT firmata

```bash
curl -X POST http://localhost:3000/listings/1/claim \
  -H "Content-Type: application/json" \
  -d '{
    "signedPsbt": "<SIGNED_PSBT_BASE64>"
  }'
```

Risposta tipica:
- `arkTxid`
- `signedCheckpointTxs` (da firmare lato buyer)
- `nextStep`

### 8) Firmo anche i checkpoint lato client

- Firma gli elementi di `signedCheckpointTxs` con la chiave buyer.
- Ottieni `signedCheckpoints` (o `signedCheckpointTxs` già firmati buyer).

### 9) Chiamo /finalize

```bash
curl -X POST http://localhost:3000/listings/1/finalize \
  -H "Content-Type: application/json" \
  -d '{
    "arkTxid": "<ARK_TXID>",
    "signedCheckpoints": ["<SIGNED_CP_1>", "<SIGNED_CP_2>"]
  }'
```

Risposta: `{ "success": true, "arkTxid": "..." }` e listing aggiornato a `refunded`.

### 10) Verifica stato refund

```bash
curl http://localhost:3000/listings/1/refund-status
```

Controlla:
- `listingStatus`
- `totalReceived`
- `spendableVtxoCount`

## Note operative

- Le pubkey devono essere hex valide (33-byte compressed o x-only).
- `prezzo` è trattato in satoshi, mentre nel BIP21 viene convertito in BTC.
- `refundRecipientAddress` è obbligatorio in `/buy`.
- Questo backend usa mutinynet (`https://mutinynet.arkade.sh`).
