# Escrow API — Documentazione Frontend

Base URL: `/v2/escrows`

Tutti gli endpoint richiedono header `Authorization: Bearer <jwt>`.

---

## Panoramica del flusso

L'escrow collega il sistema di offerte (chat/messaggi) al protocollo Ark per lo scambio sicuro di fondi. Il flusso completo e':

1. Buyer e seller negoziano in chat
2. Buyer fa un'offerta (`POST /v2/messages/:chatId` con `offeredPrice`)
3. Seller accetta l'offerta (`POST /v2/messages/:chatId/offers/:offerId/respond` con `accepted: true`)
4. **Buyer crea l'escrow** (questo documento)
5. Buyer invia fondi all'indirizzo escrow (off-app, tramite wallet Ark)
6. Si verifica il pagamento
7. Si procede con il **path collaborativo** (pagamento al seller) oppure il **path refund** (rimborso al buyer)

---

## State Machine

L'escrow segue questi stati:

```
awaitingFunds ──(check-payment)──> fundLocked
     │
     │   (il buyer invia fondi all'indirizzo Ark restituito dalla creazione)
     │
fundLocked ──(seller-submit-psbt)──> sellerReady
     │
     │   (in alternativa, path refund)
     │
     └──(refund/finalize)──> refunded

sellerReady ──(buyer-submit-psbt)──> buyerSubmitted

buyerSubmitted ──(buyer-sign-checkpoints)──> buyerCheckpointsSigned

buyerCheckpointsSigned ──(seller-sign-checkpoints)──> completed
```

Stati finali: `completed` (fondi al seller), `refunded` (fondi tornano al buyer).
Quando l'escrow raggiunge `completed` o `refunded`, la chat viene chiusa automaticamente.

---

## 1. Creazione Escrow

**Chi:** Buyer (solo dopo che il seller ha accettato un'offerta)

```
POST /v2/escrows/:chatId
```

### Prerequisiti
- Deve esistere un'offerta `valid: true` con `acceptance.accepted: true` nella chat
- Non deve gia' esistere un escrow per quella offerta

### Request Body

```json
{
  "timelockExpiry": 1715000000
}
```

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `timelockExpiry` | `number` | Unix timestamp (secondi) dopo il quale il buyer puo' richiedere il refund. Scegliere un valore ragionevole (es. 7 giorni dal momento corrente). |

### Response `201`

```json
{
  "address": "tark1q...",
  "buyerPubkey": "02abc...",
  "sellerPubkey": "03def...",
  "serverPubkey": "04ghi...",
  "arbiterPubkey": null,
  "price": 50000,
  "timelockExpiry": 1715000000,
  "chatId": 1,
  "offerId": 5,
  "status": "awaitingFunds",
  "createdAt": "2026-03-13T..."
}
```

**Cosa fare dopo:** il buyer deve inviare esattamente `price` satoshi (o piu') all'indirizzo `address` tramite il proprio wallet Ark (es. `arkProvider.sendToAddress(address, price)`). Questo e' un invio off-chain Ark sulla rete mutinynet.

### Errori

| Status | Messaggio | Causa |
|--------|-----------|-------|
| 400 | `timelockExpiry is required` | Campo mancante o non numerico |
| 400 | `No accepted offer found in this chat` | Nessuna offerta accettata |
| 400 | `Escrow already exists for this offer` | Escrow gia' creato |
| 403 | `Only the buyer can create an escrow` | L'utente autenticato non e' il buyer |
| 404 | `Chat not found` | chatId non valido |

---

## 2. Dettaglio Escrow

**Chi:** Buyer o Seller

```
GET /v2/escrows/:address
```

### Response `200`

Restituisce l'oggetto escrow completo con tutti i campi. Utile per polling dello stato o per mostrare i dettagli all'utente.

```json
{
  "address": "tark1q...",
  "buyerPubkey": "02abc...",
  "sellerPubkey": "03def...",
  "serverPubkey": "04ghi...",
  "price": 50000,
  "timelockExpiry": 1715000000,
  "status": "fundLocked",
  "chatId": 1,
  "offerId": 5,
  "fundedAt": "2026-03-13T...",
  "releasedAt": null,
  "createdAt": "2026-03-13T..."
}
```

---

## 3. Verifica Pagamento (Check Payment)

**Chi:** Buyer o Seller
**Quando:** Dopo che il buyer ha inviato fondi all'indirizzo escrow

```
GET /v2/escrows/:address/check-payment
```

Questo endpoint controlla sulla rete Ark se ci sono VTXO sufficienti all'indirizzo escrow.

### Implementazione consigliata

Il frontend dovrebbe fare **polling** su questo endpoint dopo che il buyer ha inviato i fondi:

```typescript
// Polling ogni 5 secondi dopo l'invio fondi
const pollPayment = async (address: string) => {
  const interval = setInterval(async () => {
    const res = await fetch(`/v2/escrows/${address}/check-payment`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const data = await res.json();

    if (data.status === "fundLocked") {
      clearInterval(interval);
      // Fondi ricevuti! Procedere con il path collaborativo
    }
    // Se data.status === "awaitingFunds", continuare il polling
  }, 5000);
};
```

### Response — Fondi non ancora arrivati

```json
{
  "status": "awaitingFunds",
  "received": 0,
  "required": 50000
}
```

### Response — Fondi ricevuti (stato aggiornato a `fundLocked`)

```json
{
  "address": "tark1q...",
  "status": "fundLocked",
  "fundedAt": "2026-03-13T...",
  ...
}
```

---

## 4. Path Collaborativo (Pagamento al Seller)

Questo e' il flusso principale "happy path". Richiede la firma di buyer, seller e server (3-of-3 multisig). I fondi vengono trasferiti al seller.

Il flusso collaborativo ha **6 step sequenziali** che coinvolgono seller e buyer a turno.

### Panoramica visiva

```
SELLER                          SERVER                          BUYER
  │                               │                               │
  │  GET seller-psbt              │                               │
  │──────────────────────────────>│                               │
  │  { collaboratePsbt }          │                               │
  │<──────────────────────────────│                               │
  │                               │                               │
  │  [firma PSBT con chiave       │                               │
  │   privata del seller]         │                               │
  │                               │                               │
  │  POST seller-submit-psbt      │                               │
  │──────────────────────────────>│  status: sellerReady          │
  │  { success: true }            │                               │
  │<──────────────────────────────│                               │
  │                               │                               │
  │                               │     GET buyer-psbt            │
  │                               │<──────────────────────────────│
  │                               │  { collaboratePsbt }          │
  │                               │──────────────────────────────>│
  │                               │                               │
  │                               │     [firma PSBT con chiave    │
  │                               │      privata del buyer]       │
  │                               │                               │
  │                               │     POST buyer-submit-psbt   │
  │                               │<──────────────────────────────│
  │                               │  { arkTxid,                   │
  │                               │    signedCheckpointTxs }      │
  │                               │──────────────────────────────>│
  │                               │                               │
  │                               │     [firma ogni checkpoint    │
  │                               │      con chiave del buyer]    │
  │                               │                               │
  │                               │  POST buyer-sign-checkpoints  │
  │                               │<──────────────────────────────│
  │                               │  { success: true }            │
  │                               │──────────────────────────────>│
  │                               │                               │
  │  GET seller-checkpoints       │                               │
  │──────────────────────────────>│                               │
  │  { checkpointTxs, arkTxid }   │                               │
  │<──────────────────────────────│                               │
  │                               │                               │
  │  [firma ogni checkpoint       │                               │
  │   con chiave del seller]      │                               │
  │                               │                               │
  │  POST seller-sign-checkpoints │                               │
  │──────────────────────────────>│  status: completed            │
  │  { success, arkTxid }         │  chat: closed                 │
  │<──────────────────────────────│                               │
```

---

### Step 1 — Seller recupera il PSBT da firmare

**Chi:** Seller

```
GET /v2/escrows/:address/collaborate/seller-psbt
```

#### Response `200`

```json
{
  "collaboratePsbt": "cHNidP8BAH0CAAAA...",
  "recipientAddress": "tark1q..."
}
```

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `collaboratePsbt` | `string` | PSBT in base64. Il seller deve firmarlo con la propria chiave privata. |
| `recipientAddress` | `string` | Indirizzo Ark di destinazione (il VTXO del seller). Informativo. |

**Cosa fare:** Il client del seller deve firmare `collaboratePsbt` usando la chiave privata del seller (es. tramite `@arkade-os/sdk` o un wallet compatibile) e inviarlo allo step successivo.

---

### Step 2 — Seller invia il PSBT firmato

**Chi:** Seller

```
POST /v2/escrows/:address/collaborate/seller-submit-psbt
```

#### Request Body

```json
{
  "signedPsbt": "cHNidP8BAH0CAAAA..."
}
```

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `signedPsbt` | `string` | Il PSBT base64 firmato dal seller |

#### Response `200`

```json
{
  "success": true
}
```

Lo stato dell'escrow passa a `sellerReady`. A questo punto il buyer puo' procedere.

---

### Step 3 — Buyer recupera il PSBT firmato dal seller

**Chi:** Buyer
**Quando:** Dopo che il seller ha firmato (status `sellerReady`)

```
GET /v2/escrows/:address/collaborate/buyer-psbt
```

#### Implementazione consigliata

Il buyer dovrebbe fare polling oppure attendere una notifica (se disponibile) che lo stato sia `sellerReady`:

```typescript
const pollSellerReady = async (address: string) => {
  const interval = setInterval(async () => {
    const res = await fetch(`/v2/escrows/${address}/collaborate/buyer-psbt`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const data = await res.json();

    if (data.collaboratePsbt) {
      clearInterval(interval);
      // Procedere con la firma
    }
  }, 5000);
};
```

#### Response — Seller non ha ancora firmato

```json
{
  "status": "fundLocked",
  "collaboratePsbt": null
}
```

#### Response — PSBT pronto

```json
{
  "status": "sellerReady",
  "collaboratePsbt": "cHNidP8BAH0CAAAA..."
}
```

**Cosa fare:** Il buyer firma il `collaboratePsbt` (che gia' contiene la firma del seller) con la propria chiave privata.

---

### Step 4 — Buyer invia il PSBT completamente firmato

**Chi:** Buyer

```
POST /v2/escrows/:address/collaborate/buyer-submit-psbt
```

Questo endpoint invia la transazione al server Ark (`submitTx`). Il server restituisce le checkpoint transactions da firmare.

#### Request Body

```json
{
  "signedPsbt": "cHNidP8BAH0CAAAA..."
}
```

#### Response `200`

```json
{
  "arkTxid": "abc123...",
  "signedCheckpointTxs": ["base64tx1...", "base64tx2...", "..."]
}
```

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `arkTxid` | `string` | ID della transazione Ark. Salvarlo, serve per il finalize. |
| `signedCheckpointTxs` | `string[]` | Array di checkpoint transactions (base64) gia' firmate dal server. Il buyer deve firmarle. |

**Cosa fare:** Il buyer deve firmare ogni elemento di `signedCheckpointTxs` con la propria chiave privata e inviarle allo step successivo.

---

### Step 5 — Buyer firma le checkpoint transactions

**Chi:** Buyer

```
POST /v2/escrows/:address/collaborate/buyer-sign-checkpoints
```

#### Request Body

```json
{
  "signedCheckpointTxs": ["base64signedTx1...", "base64signedTx2...", "..."]
}
```

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `signedCheckpointTxs` | `string[]` | Le checkpoint transactions firmate dal buyer (e dal server). |

#### Response `200`

```json
{
  "success": true
}
```

Stato: `buyerCheckpointsSigned`. Ora tocca al seller finalizzare.

---

### Step 6 — Seller recupera le checkpoints firmate dal buyer

**Chi:** Seller
**Quando:** Dopo che il buyer ha firmato (status `buyerCheckpointsSigned`)

```
GET /v2/escrows/:address/collaborate/seller-checkpoints
```

#### Implementazione consigliata

Polling sullo stato:

```typescript
const pollBuyerCheckpoints = async (address: string) => {
  const interval = setInterval(async () => {
    const res = await fetch(
      `/v2/escrows/${address}/collaborate/seller-checkpoints`,
      { headers: { Authorization: `Bearer ${jwt}` } },
    );
    const data = await res.json();

    if (data.checkpointTxs) {
      clearInterval(interval);
      // Procedere con la firma finale
    }
  }, 5000);
};
```

#### Response — Buyer non ha ancora firmato

```json
{
  "status": "buyerSubmitted",
  "checkpointTxs": null
}
```

#### Response — Checkpoints pronte

```json
{
  "status": "buyerCheckpointsSigned",
  "arkTxid": "abc123...",
  "checkpointTxs": ["base64signedTx1...", "base64signedTx2...", "..."]
}
```

**Cosa fare:** Il seller firma ogni elemento di `checkpointTxs` con la propria chiave privata e le invia per finalizzare.

---

### Step 7 — Seller finalizza (completamento)

**Chi:** Seller

```
POST /v2/escrows/:address/collaborate/seller-sign-checkpoints
```

Questo e' l'ultimo step. Il server chiama `finalizeTx` sul nodo Ark, che rende la transazione definitiva.

#### Request Body

```json
{
  "signedCheckpointTxs": ["base64finalTx1...", "base64finalTx2...", "..."]
}
```

#### Response `200`

```json
{
  "success": true,
  "arkTxid": "abc123..."
}
```

**Effetti:**
- Stato escrow: `completed`
- `releasedAt` impostato
- Chat: `closed`
- I fondi sono ora nel VTXO del seller

---

## 5. Path Refund (Rimborso al Buyer)

Il buyer puo' richiedere il refund **solo dopo che il timelock e' scaduto** (cioe' il tempo corrente della blockchain > `timelockExpiry`). Questo percorso non richiede la partecipazione del seller.

### Panoramica

```
BUYER                           SERVER
  │                               │
  │  GET refund/psbt              │
  │──────────────────────────────>│
  │  { refundPsbt }               │
  │<──────────────────────────────│
  │                               │
  │  [firma con chiave buyer]     │
  │                               │
  │  POST refund/submit-signed    │
  │──────────────────────────────>│
  │  { arkTxid,                   │
  │    signedCheckpointTxs }      │
  │<──────────────────────────────│
  │                               │
  │  [firma checkpoints]          │
  │                               │
  │  POST refund/finalize         │
  │──────────────────────────────>│  status: refunded
  │  { success, arkTxid }         │  chat: closed
  │<──────────────────────────────│
```

---

### Step 1 — Buyer recupera il PSBT di refund

**Chi:** Buyer

```
GET /v2/escrows/:address/refund/psbt
```

#### Response `200`

```json
{
  "refundPsbt": "cHNidP8BAH0CAAAA...",
  "recipientAddress": "tark1q..."
}
```

**Cosa fare:** Firmare `refundPsbt` con la chiave privata del buyer.

---

### Step 2 — Buyer invia il PSBT firmato

**Chi:** Buyer

```
POST /v2/escrows/:address/refund/submit-signed-psbt
```

#### Request Body

```json
{
  "signedPsbt": "cHNidP8BAH0CAAAA..."
}
```

#### Response `200`

```json
{
  "arkTxid": "def456...",
  "signedCheckpointTxs": ["base64tx1...", "base64tx2...", "..."]
}
```

**Cosa fare:** Firmare ogni checkpoint tx con la chiave del buyer, poi chiamare finalize.

---

### Step 3 — Buyer finalizza il refund

**Chi:** Buyer

```
POST /v2/escrows/:address/refund/finalize
```

#### Request Body

```json
{
  "arkTxid": "def456...",
  "signedCheckpointTxs": ["base64signedTx1...", "base64signedTx2...", "..."]
}
```

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `arkTxid` | `string` | L'ID transazione ricevuto dallo step precedente |
| `signedCheckpointTxs` | `string[]` | Le checkpoint transactions firmate dal buyer |

#### Response `200`

```json
{
  "success": true,
  "arkTxid": "def456..."
}
```

**Effetti:**
- Stato escrow: `refunded`
- Chat: `closed`
- I fondi tornano al buyer

---

## Riepilogo Endpoint

| # | Metodo | Path | Chi | Body |
|---|--------|------|-----|------|
| 1 | POST | `/:chatId` | Buyer | `{ timelockExpiry }` |
| 2 | GET | `/:address` | Buyer/Seller | — |
| 3 | GET | `/:address/check-payment` | Buyer/Seller | — |
| 4 | GET | `/:address/collaborate/seller-psbt` | Seller | — |
| 5 | POST | `/:address/collaborate/seller-submit-psbt` | Seller | `{ signedPsbt }` |
| 6 | GET | `/:address/collaborate/buyer-psbt` | Buyer | — |
| 7 | POST | `/:address/collaborate/buyer-submit-psbt` | Buyer | `{ signedPsbt }` |
| 8 | POST | `/:address/collaborate/buyer-sign-checkpoints` | Buyer | `{ signedCheckpointTxs }` |
| 9 | GET | `/:address/collaborate/seller-checkpoints` | Seller | — |
| 10 | POST | `/:address/collaborate/seller-sign-checkpoints` | Seller | `{ signedCheckpointTxs }` |
| 11 | GET | `/:address/refund/psbt` | Buyer | — |
| 12 | POST | `/:address/refund/submit-signed-psbt` | Buyer | `{ signedPsbt }` |
| 13 | POST | `/:address/refund/finalize` | Buyer | `{ arkTxid, signedCheckpointTxs }` |

---

## Note per il Frontend

### Autenticazione
Tutti gli endpoint richiedono `Authorization: Bearer <jwt>`. Il JWT si ottiene dal flusso di autenticazione (`/v2/auth`).

### Firma PSBT e Checkpoint
Il client deve usare `@arkade-os/sdk` per firmare i PSBT e le checkpoint transactions. La firma avviene con la chiave privata dell'utente (schnorr/taproot).

```typescript
import { Transaction } from "@arkade-os/sdk";
import { base64 } from "@scure/base";

// Esempio firma PSBT
function signPsbt(psbtBase64: string, privateKey: Uint8Array): string {
  const tx = Transaction.fromPSBT(base64.decode(psbtBase64));
  tx.sign(privateKey);
  return base64.encode(tx.toPSBT());
}

// Esempio firma checkpoints
function signCheckpoints(
  checkpointTxs: string[],
  privateKey: Uint8Array,
): string[] {
  return checkpointTxs.map((cpBase64) => {
    const tx = Transaction.fromPSBT(base64.decode(cpBase64));
    tx.sign(privateKey);
    return base64.encode(tx.toPSBT());
  });
}
```

### Polling
Nei punti dove un utente deve aspettare l'azione dell'altro (buyer aspetta firma seller, seller aspetta checkpoints buyer), usare polling con intervallo di 3-5 secondi. In alternativa, se implementate WebSocket/SSE, usare quelli.

### Gestione errori
Tutti gli errori tornano come `{ "error": "messaggio" }` con status HTTP appropriato (400, 403, 404). Il frontend dovrebbe mostrare il messaggio all'utente.

### Parametro `address`
L'`address` e' un indirizzo Ark (inizia con `tark` su mutinynet). E' il primary key dell'escrow e viene restituito alla creazione. Usarlo come identificativo in tutti gli endpoint successivi.

### `timelockExpiry`
E' un timestamp Unix in **secondi** (non millisecondi). Rappresenta il momento dopo il quale il buyer puo' richiedere il refund. Esempio per 7 giorni da ora:

```typescript
const timelockExpiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
```
