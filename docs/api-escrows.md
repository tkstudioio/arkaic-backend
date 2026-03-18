# Escrows Endpoints

Escrows hold Bitcoin funds in a multisig contract during the purchase flow. Each escrow has two spend paths: **collaborative** (both buyer and seller agree) and **refund** (after timelock expires). This document covers both paths and all intermediate steps.

## Authentication

All endpoints in this group require a valid Bearer token (obtained from `/api/auth/login`). Authorization is enforced — users can only view escrows where they are the buyer or seller.

---

## Core Escrow Concepts

**Escrow Address**: A Taproot address controlling the VTXO funds. Generated deterministically from buyer pubkey, seller pubkey, and timelock expiry.

**Status Transitions**:
```
awaitingFunds
  ↓
partiallyFunded (if funded but below target price)
  ↓
fundLocked (when fully funded)
  ├─→ sellerReady (collaborative path: seller signs PSBT)
  │     ├─→ buyerSubmitted (buyer submits fully-signed PSBT to Ark)
  │     ├─→ buyerCheckpointsSigned (buyer signs checkpoint txs)
  │     └─→ completed (seller finalizes)
  └─→ refunded (refund path: buyer initiates after timelock)
```

**VTXO (Virtual Transaction Output)**: Ark protocol's off-chain transaction output. Enables efficient scaling.

**PSBT (Partially Signed Bitcoin Transaction)**: Standard format for multi-party transaction signing.

---

## `POST /api/escrows/:chatId`

Create an escrow for an accepted offer. Generates the escrow address and initializes state.

**Authentication:** Bearer token + Schnorr signature
**Buyer pubkey:** Extracted from Bearer token
**Chat requirement:** Chat must exist and have an accepted offer

### Request

```
POST /api/escrows/123
```

Body:

```json
{
  "chatId": "number — chat ID (matches path)",
  "sellerPubkey": "string — hex-encoded seller pubkey",
  "timelockExpiry": "number — Unix timestamp (seconds) when refund path becomes available",
  "price": "number — price in satoshi (not used if offer exists, but validated)",
  "serverPubkey": "string — hex-encoded Ark server pubkey",
  "escrowAddress": "string — Ark address (pre-computed by client, validated by server)",
  "signature": "string — hex-encoded Schnorr signature over request body"
}
```

The signature must verify over the JSON-serialized body (excluding signature) with keys sorted alphabetically. The escrow address and server pubkey are re-derived server-side from the buy/sell/timelock params; the client-provided values are validated.

### Response (201)

```json
{
  "address": "string — escrow Ark address",
  "buyerPubkey": "string",
  "sellerPubkey": "string",
  "serverPubkey": "string",
  "arbiterPubkey": "string | null",
  "price": "number — final transaction price (from accepted offer, or listing price if no offer)",
  "timelockExpiry": "number — Unix timestamp",
  "chatId": "number",
  "status": "awaitingFunds | partiallyFunded | fundLocked",
  "sellerSignedCollabPsbt": "null",
  "collabArkTxid": "null",
  "serverSignedCheckpoints": "null",
  "buyerSignedCheckpoints": "null",
  "createdAt": "ISO 8601 datetime",
  "fundedAt": "null",
  "releasedAt": "null",
  "offerId": "number | null"
}
```

**Long-Polling Behavior**: The request will block for up to 30 seconds waiting for the first VTXO payment to arrive. If a payment is detected, the escrow status is automatically updated to `partiallyFunded` or `fundLocked` and returned. If no payment is detected within 30 seconds, the response returns with status `awaitingFunds`. The client should poll GET `/api/escrows/address/:address` to check for updates.

### Side Effects

- Escrow is created with initial status `awaitingFunds`
- If payment is detected during the 30-second wait, status is automatically updated to `partiallyFunded` (if below price) or `fundLocked` (if at or above price)
- A system message is added to the chat documenting the funding status
- Both buyer and seller receive WebSocket notifications:
  - Type: `"escrow_update"` (if status changed)
  - Includes `address`

### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid JSON schema |
| 401    | Missing or invalid Bearer token |
| 401    | Invalid signature |
| 403    | Only the buyer can create an escrow |
| 404    | Chat not found |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
PUBKEY="02abcd..."

# Pre-compute escrow address and signature client-side
SIGNATURE=$(sign_schnorr '{...}' $PUBKEY)

curl -X POST http://localhost:3000/api/escrows/123 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "chatId": 123,
    "sellerPubkey": "02def...",
    "timelockExpiry": 1710000000,
    "price": 5000,
    "serverPubkey": "02server...",
    "escrowAddress": "tark1...",
    "signature": "'$SIGNATURE'"
  }'
```

---

## `GET /api/escrows/:chatId`

Get escrow details by chat ID.

**Autenticazione:** Bearer token
**Authorization:** User must be buyer or seller of this chat's escrow

### Request

```
GET /api/escrows/123
```

Path parameters:

- `chatId`: Chat ID (numeric)

### Response (200)

```json
{
  "address": "string",
  "buyerPubkey": "string",
  "sellerPubkey": "string",
  "serverPubkey": "string",
  "arbiterPubkey": "string | null",
  "price": "number",
  "timelockExpiry": "number",
  "chatId": "number",
  "status": "string — current status",
  ...
}
```

### Errors

| Status | Description |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |
| 404    | Escrow not found |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3000/api/escrows/123 \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/escrows/address/:address`

Get escrow details by address. This endpoint has side effects: it queries the Ark indexer and updates escrow status if funding changes.

**Autenticazione:** Bearer token
**Authorization:** User must be buyer or seller of this escrow
**Side effect:** Updates escrow status to `partiallyFunded` or `fundLocked` if on-chain state has changed

### Request

```
GET /api/escrows/address/tark1xxxxxxxxx
```

Path parameters:

- `address`: Escrow Ark address (string)

### Response (200)

```json
{
  "address": "string",
  "status": "string — may be updated if blockchain state changed",
  ...
}
```

If funds are detected:
- If total VTXO value is less than price: status becomes `partiallyFunded`
- If total VTXO value >= price: status becomes `fundLocked`
- If no change: returns current status

### Errors

| Status | Description |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |
| 404    | Escrow not found |
| 502    | Failed to check escrow funding (Ark indexer error) |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET "http://localhost:3000/api/escrows/address/tark1xxxxxxxxx" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Collaborative Release Path

For buyer and seller to cooperatively release funds to the seller (fastest path).

### `GET /api/escrows/address/:address/collaborate/seller-psbt`

Request PSBT for seller to sign (collaborative path).

**Autenticazione:** Bearer token
**Seller pubkey:** Must match escrow seller
**Escrow status:** Must be `fundLocked`

#### Request

```
GET /api/escrows/address/tark1xxxxxxxxx/collaborate/seller-psbt
```

#### Response (200)

```json
{
  "collaboratePsbt": "string — base64-encoded PSBT",
  "recipientAddress": "string — seller's recipient Ark address"
}
```

The PSBT is pre-constructed with:
- Inputs: all spendable VTXOs in the escrow address
- Output: the full amount to the seller's recipient address
- Spend path: collaborative (requires 3-of-3 signatures: buyer, seller, server)

#### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Cannot build PSBT in {status} status (not fundLocked) |
| 401    | Missing or invalid Bearer token |
| 403    | Forbidden — not the seller |
| 404    | Escrow not found |
| 502    | Failed to build collaborative PSBT |

---

### `POST /api/escrows/address/:address/collaborate/seller-submit-psbt`

Submit seller's signed PSBT. Transitions escrow to `sellerReady`.

**Autenticazione:** Bearer token
**Seller pubkey:** Must match escrow seller

#### Request

```
POST /api/escrows/address/tark1xxxxxxxxx/collaborate/seller-submit-psbt
```

Body:

```json
{
  "signedPsbt": "string — base64-encoded PSBT signed by seller"
}
```

#### Response (200)

```json
{
  "success": true
}
```

Escrow status is updated to `sellerReady`. Seller's PSBT is stored.

#### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid JSON schema |
| 401    | Missing or invalid Bearer token |
| 403    | Forbidden — not the seller |
| 404    | Escrow not found |

#### Side Effects

- Both parties receive `escrow_update` WebSocket notification

---

### `GET /api/escrows/address/:address/collaborate/buyer-psbt`

Request PSBT for buyer to sign and submit (collaborative path).

**Autenticazione:** Bearer token
**Buyer pubkey:** Must match escrow buyer
**Escrow status:** Must be `sellerReady` with `sellerSignedCollabPsbt` set

#### Request

```
GET /api/escrows/address/tark1xxxxxxxxx/collaborate/buyer-psbt
```

#### Response (200)

```json
{
  "status": "string — escrow status",
  "collaboratePsbt": "string | null — seller's signed PSBT or null if not ready"
}
```

If status is `sellerReady` and PSBT is available:

```json
{
  "status": "sellerReady",
  "collaboratePsbt": "base64-encoded-psbt"
}
```

If not ready:

```json
{
  "status": "fundLocked",
  "collaboratePsbt": null
}
```

#### Errors

| Status | Description |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |
| 403    | Forbidden — not the buyer |
| 404    | Escrow not found |

---

### `POST /api/escrows/address/:address/collaborate/buyer-submit-psbt`

Submit buyer's fully-signed PSBT. Submits to Ark network, transitions to `buyerSubmitted`.

**Autenticazione:** Bearer token
**Buyer pubkey:** Must match escrow buyer
**Escrow status:** Must be `sellerReady`

#### Request

```
POST /api/escrows/address/tark1xxxxxxxxx/collaborate/buyer-submit-psbt
```

Body:

```json
{
  "signedPsbt": "string — base64-encoded PSBT signed by both seller and buyer"
}
```

#### Response (200)

```json
{
  "arkTxid": "string — Ark transaction ID",
  "signedCheckpointTxs": [
    "string — base64-encoded checkpoint tx 1",
    "string — base64-encoded checkpoint tx 2",
    ...
  ]
}
```

The server submits the PSBT to Ark and receives checkpoint transactions to be signed.

#### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid JSON schema |
| 400    | Seller has not signed yet (status not sellerReady) |
| 401    | Missing or invalid Bearer token |
| 403    | Forbidden — not the buyer |
| 404    | Escrow not found |
| 502    | Failed to submit transaction |

#### Side Effects

- Escrow status transitions to `buyerSubmitted`
- Server-signed checkpoints are stored (JSON-stringified array)
- Both parties receive `escrow_update` notification

---

### `POST /api/escrows/address/:address/collaborate/buyer-sign-checkpoints`

Submit buyer's signed checkpoint transactions.

**Autenticazione:** Bearer token
**Buyer pubkey:** Must match escrow buyer
**Escrow status:** Must be `buyerSubmitted`

#### Request

```
POST /api/escrows/address/tark1xxxxxxxxx/collaborate/buyer-sign-checkpoints
```

Body:

```json
{
  "signedCheckpointTxs": [
    "string — buyer-signed checkpoint tx 1",
    "string — buyer-signed checkpoint tx 2",
    ...
  ]
}
```

#### Response (200)

```json
{
  "success": true
}
```

#### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid JSON schema |
| 400    | Transaction not submitted yet (status not buyerSubmitted) |
| 401    | Missing or invalid Bearer token |
| 403    | Forbidden — not the buyer |
| 404    | Escrow not found |

#### Side Effects

- Escrow status transitions to `buyerCheckpointsSigned`
- Buyer's signed checkpoints are stored (JSON-stringified array)
- Both parties receive `escrow_update` notification

---

### `GET /api/escrows/address/:address/collaborate/seller-checkpoints`

Request checkpoint transactions for seller to sign and finalize.

**Autenticazione:** Bearer token
**Seller pubkey:** Must match escrow seller
**Escrow status:** Must have `collabArkTxid` and `buyerSignedCheckpoints` set

#### Request

```
GET /api/escrows/address/tark1xxxxxxxxx/collaborate/seller-checkpoints
```

#### Response (200)

If ready:

```json
{
  "status": "buyerCheckpointsSigned",
  "arkTxid": "string",
  "checkpointTxs": [
    "string — checkpoint tx 1",
    "string — checkpoint tx 2",
    ...
  ]
}
```

If not ready:

```json
{
  "status": "buyerSubmitted",
  "checkpointTxs": null
}
```

#### Errors

| Status | Description |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |
| 403    | Forbidden — not the seller |
| 404    | Escrow not found |

---

### `POST /api/escrows/address/:address/collaborate/seller-sign-checkpoints`

Submit seller's signed checkpoints. Finalizes the Ark transaction and transitions escrow to `completed`.

**Autenticazione:** Bearer token
**Seller pubkey:** Must match escrow seller
**Escrow status:** Must be `buyerCheckpointsSigned`

#### Request

```
POST /api/escrows/address/tark1xxxxxxxxx/collaborate/seller-sign-checkpoints
```

Body:

```json
{
  "signedCheckpointTxs": [
    "string — seller-signed checkpoint tx 1",
    "string — seller-signed checkpoint tx 2",
    ...
  ]
}
```

#### Response (200)

```json
{
  "success": true,
  "arkTxid": "string — the collaborative Ark transaction ID"
}
```

#### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid JSON schema |
| 400    | Buyer has not signed checkpoints yet (status not buyerCheckpointsSigned) |
| 401    | Missing or invalid Bearer token |
| 403    | Forbidden — not the seller |
| 404    | Escrow not found |
| 502    | Failed to finalize transaction |

#### Side Effects

- Escrow status transitions to `completed`
- Associated chat status transitions to `closed`
- `releasedAt` timestamp is set to now
- Both parties receive `escrow_update` notification

---

## Refund Path

For buyer to recover funds after timelock expires (or if seller abandons negotiation).

### `GET /api/escrows/address/:address/refund/psbt`

Request PSBT for buyer to sign (refund path).

**Autenticazione:** Bearer token
**Buyer pubkey:** Must match escrow buyer
**Escrow status:** Any status is allowed (fundLocked, sellerReady, etc.)

#### Request

```
GET /api/escrows/address/tark1xxxxxxxxx/refund/psbt
```

#### Response (200)

```json
{
  "refundPsbt": "string — base64-encoded PSBT",
  "recipientAddress": "string — buyer's recipient Ark address"
}
```

The PSBT is constructed with:
- Inputs: all spendable VTXOs from the escrow address
- Output: full amount to buyer's recipient address
- Spend path: refund (requires buyer + server signatures; CLTV timelock applies)

#### Errors

| Status | Description |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |
| 403    | Forbidden — not the buyer |
| 404    | Escrow not found |
| 502    | Failed to build refund PSBT |

---

### `POST /api/escrows/address/:address/refund/submit-signed-psbt`

Submit buyer's signed refund PSBT. Server submits to Ark and returns checkpoints.

**Autenticazione:** Bearer token
**Buyer pubkey:** Must match escrow buyer

#### Request

```
POST /api/escrows/address/tark1xxxxxxxxx/refund/submit-signed-psbt
```

Body:

```json
{
  "signedPsbt": "string — base64-encoded PSBT signed by buyer"
}
```

#### Response (200)

```json
{
  "arkTxid": "string — Ark transaction ID",
  "signedCheckpointTxs": [
    "string — base64-encoded checkpoint tx 1",
    "string — base64-encoded checkpoint tx 2",
    ...
  ]
}
```

#### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid JSON schema |
| 401    | Missing or invalid Bearer token |
| 403    | Forbidden — not the buyer |
| 404    | Escrow not found |
| 502    | Failed to submit transaction |

---

### `POST /api/escrows/address/:address/refund/finalize`

Finalize refund by submitting all signed checkpoint transactions. Transitions escrow to `refunded`.

**Autenticazione:** Bearer token
**Buyer pubkey:** Must match escrow buyer
**Status requirement:** Escrow must be in a refundable state (fundLocked, partiallyFunded, or sellerReady)

#### Request

```
POST /api/escrows/address/tark1xxxxxxxxx/refund/finalize
```

Body:

```json
{
  "arkTxid": "string — Ark transaction ID from submit-signed-psbt",
  "signedCheckpointTxs": [
    "string — buyer-signed checkpoint tx 1",
    "string — buyer-signed checkpoint tx 2",
    ...
  ]
}
```

Note: The buyer signs the server-provided checkpoint txs. The server does not re-sign for refund path.

#### Response (200)

```json
{
  "success": true,
  "arkTxid": "string"
}
```

#### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid JSON schema |
| 400    | Cannot refund escrow in {status} status (only fundLocked, partiallyFunded, sellerReady allowed) |
| 401    | Missing or invalid Bearer token |
| 403    | Forbidden — not the buyer |
| 404    | Escrow not found |
| 502    | Failed to finalize transaction |

#### Side Effects

- Escrow status transitions to `refunded`
- Associated chat status transitions to `closed`
- Both parties receive `escrow_update` notification

---

## Escrow Workflow Summary

### Collaborative Path

1. Create escrow: POST `/api/escrows/:chatId`
2. Seller gets PSBT: GET `/.../collaborate/seller-psbt`
3. Seller signs and submits: POST `/.../collaborate/seller-submit-psbt`
4. Buyer gets PSBT: GET `/.../collaborate/buyer-psbt`
5. Buyer signs fully and submits: POST `/.../collaborate/buyer-submit-psbt`
6. Buyer signs checkpoints: POST `/.../collaborate/buyer-sign-checkpoints`
7. Seller retrieves checkpoints: GET `/.../collaborate/seller-checkpoints`
8. Seller signs and finalizes: POST `/.../collaborate/seller-sign-checkpoints` → completed

### Refund Path

1. Create escrow: POST `/api/escrows/:chatId`
2. (Wait for timelock or seller abandonment)
3. Buyer gets PSBT: GET `/.../refund/psbt`
4. Buyer signs and submits: POST `/.../refund/submit-signed-psbt`
5. Buyer signs checkpoints: (server handles, returned from submit)
6. Buyer finalizes: POST `/.../refund/finalize` → refunded

---

## Notes

- All escrow addresses are deterministic (derived from buyer/seller/timelock)
- VTXO amounts and counts may vary; PSBTs aggregate all spendable coins
- Timelock expiry is a Unix timestamp (seconds); refund becomes available after this time
- Server-signed checkpoints are JSON-stringified arrays of base64 strings
- Chat is closed automatically when escrow reaches `completed` or `refunded`
- WebSocket notifications keep clients in sync with escrow state changes
