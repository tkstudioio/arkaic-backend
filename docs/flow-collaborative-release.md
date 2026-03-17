# Collaborative Release Flow

The collaborative release flow enables buyer and seller to cooperatively release funds to the seller after accepting an offer and fully funding the escrow. Both parties must sign the transaction.

## Overview

This is the **fast path** through an escrow. When buyer and seller agree on a price:
1. Buyer funds the escrow address with the required amount
2. Seller requests a signing PSBT
3. Seller signs and submits
4. Buyer receives the PSBT, signs it fully, and submits to Ark network
5. Ark server returns checkpoint transactions
6. Buyer signs the checkpoints
7. Seller retrieves and signs the checkpoints
8. Seller finalizes the transaction — funds are released

**Total participants:** Buyer, Seller, Ark Server (3-of-3 multisig)

**Timeframe:** Can complete within minutes (no timelock wait)

---

## Prerequisite States

Before starting the collaborative release flow:

- **Chat exists** with buyer and seller (see [api-chats.md](api-chats.md))
- **Offer accepted** by seller (see [api-messages.md](api-messages.md))
- **Escrow created** with status `awaitingFunds` (see [api-escrows.md](api-escrows.md))
- **Escrow fully funded** with status `fundLocked` (buyer has sent funds to escrow address)
- **No ongoing refund flow** (collaborative and refund paths are mutually exclusive after submission)

---

## Step-by-Step Sequence

### Step 1 — Buyer Funds Escrow

**Who:** Buyer (off-chain Bitcoin transaction)

**Action:** Send funds to the escrow address.

The escrow address is deterministic and generated server-side, but communicated to the buyer when escrow is created:

```bash
POST /api/escrows/:chatId
# Returns escrow.address = "tark1xxxxxxxxxxxxx"
```

**Expected amount:** At least `escrow.price` satoshi.

**What happens backend:**
- Buyer monitors the escrow address (using Ark indexer)
- When funds arrive, backend can transition status to `fundLocked` via GET `/api/escrows/address/:address` (which checks on-chain state)
- Seller is notified via WebSocket when funding is detected

**On-chain:** Funds are committed to the VTXO at the escrow address.

---

### Step 2 — Seller Requests PSBT

**Who:** Seller

**Endpoint:** `GET /api/escrows/address/:address/collaborate/seller-psbt`

**Headers:**
```
Authorization: Bearer <SELLER_TOKEN>
```

**Request:**
```bash
curl -X GET "http://localhost:3000/api/escrows/address/tark1xxxxxxxxxxxxx/collaborate/seller-psbt" \
  -H "Authorization: Bearer $SELLER_TOKEN"
```

**Response (200):**
```json
{
  "collaboratePsbt": "cHNidP8BAA...",
  "recipientAddress": "tark1yyyyyyyyyyyyy"
}
```

**What happens:**
- Server queries Ark indexer for all spendable VTXOs at escrow address
- Builds unsigned PSBT with:
  - **Inputs:** all VTXOs
  - **Output:** full amount to recipient address (seller's Ark address)
  - **Spend path:** collaborative (3-of-3 multisig: buyer, seller, server)
- Returns base64-encoded PSBT

**Recipient address:** Seller's personal Ark address (where funds will be released). Pre-computed by client and provided during escrow creation, or derived server-side from seller pubkey.

---

### Step 3 — Seller Signs and Submits PSBT

**Who:** Seller

**Action:**
1. Client receives PSBT from Step 2
2. Client signs PSBT with seller's private key (Schnorr signature over the PSBT inputs)
3. Client submits signed PSBT to backend

**Endpoint:** `POST /api/escrows/address/:address/collaborate/seller-submit-psbt`

**Headers:**
```
Authorization: Bearer <SELLER_TOKEN>
Content-Type: application/json
```

**Request:**
```bash
SIGNED_PSBT=$(sign_psbt_with_seller_key "cHNidP8BAA...")

curl -X POST "http://localhost:3000/api/escrows/address/tark1xxxxxxxxxxxxx/collaborate/seller-submit-psbt" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signedPsbt": "'$SIGNED_PSBT'"
  }'
```

**Response (200):**
```json
{
  "success": true
}
```

**What happens backend:**
- PSBT is stored in `escrow.sellerSignedCollabPsbt`
- Escrow status transitions to `sellerReady`
- Both buyer and seller receive `escrow_update` WebSocket notification
- Buyer can now proceed to Step 4

---

### Step 4 — Buyer Gets PSBT from Seller

**Who:** Buyer

**Endpoint:** `GET /api/escrows/address/:address/collaborate/buyer-psbt`

**Headers:**
```
Authorization: Bearer <BUYER_TOKEN>
```

**Request:**
```bash
curl -X GET "http://localhost:3000/api/escrows/address/tark1xxxxxxxxxxxxx/collaborate/buyer-psbt" \
  -H "Authorization: Bearer $BUYER_TOKEN"
```

**Response (200 - if ready):**
```json
{
  "status": "sellerReady",
  "collaboratePsbt": "cHNidP8BAA..."
}
```

**Response (200 - if not ready):**
```json
{
  "status": "fundLocked",
  "collaboratePsbt": null
}
```

**What happens:**
- Server checks if `escrow.status === "sellerReady"` and `sellerSignedCollabPsbt` is set
- If yes: returns seller's signed PSBT
- If no: returns null with current status
- Buyer polls until PSBT is available

---

### Step 5 — Buyer Signs Fully and Submits to Ark

**Who:** Buyer

**Action:**
1. Client receives PSBT from Step 4
2. Client signs PSBT with buyer's private key (adds buyer's signature to the transaction)
3. PSBT is now fully signed (seller + buyer signatures)
4. Client submits fully-signed PSBT to backend (which forwards to Ark network)

**Endpoint:** `POST /api/escrows/address/:address/collaborate/buyer-submit-psbt`

**Headers:**
```
Authorization: Bearer <BUYER_TOKEN>
Content-Type: application/json
```

**Request:**
```bash
FULLY_SIGNED_PSBT=$(sign_psbt_with_buyer_key "$SELLER_SIGNED_PSBT")

curl -X POST "http://localhost:3000/api/escrows/address/tark1xxxxxxxxxxxxx/collaborate/buyer-submit-psbt" \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signedPsbt": "'$FULLY_SIGNED_PSBT'"
  }'
```

**Response (200):**
```json
{
  "arkTxid": "abc123def...",
  "signedCheckpointTxs": [
    "cHNidP8BAA...",
    "cHNidP8BAA...",
    "cHNidP8BAA..."
  ]
}
```

**What happens backend:**
- Backend calls `arkProvider.submitTx(signedPsbt, checkpointPsbts)`
- Ark server validates signatures and returns:
  - **arkTxid:** Transaction ID on Ark network (provisional, not yet finalized)
  - **signedCheckpointTxs:** Array of pre-signed checkpoint transactions from the Ark server
- Escrow fields updated:
  - `collabArkTxid` = arkTxid
  - `serverSignedCheckpoints` = JSON-stringified array of checkpoint txs
  - `status` = "buyerSubmitted"
- Both parties receive `escrow_update` WebSocket notification
- Buyer can now proceed to Step 6

**Checkpoints:** Off-chain transactions that incrementally unroll the Ark transaction on-chain. Each checkpoint must be signed by all parties.

---

### Step 6 — Buyer Signs Checkpoints

**Who:** Buyer

**Action:**
1. Client receives `signedCheckpointTxs` from Step 5 (pre-signed by Ark server)
2. Client signs each checkpoint with buyer's private key
3. Client submits buyer's signed checkpoints to backend

**Endpoint:** `POST /api/escrows/address/:address/collaborate/buyer-sign-checkpoints`

**Headers:**
```
Authorization: Bearer <BUYER_TOKEN>
Content-Type: application/json
```

**Request:**
```bash
BUYER_SIGNED_CPS=[
  "$(sign_checkpoint_with_buyer_key "cHNidP8BAA1...")",
  "$(sign_checkpoint_with_buyer_key "cHNidP8BAA2...")",
  "$(sign_checkpoint_with_buyer_key "cHNidP8BAA3...")"
]

curl -X POST "http://localhost:3000/api/escrows/address/tark1xxxxxxxxxxxxx/collaborate/buyer-sign-checkpoints" \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signedCheckpointTxs": [
      "'${BUYER_SIGNED_CPS[0]}'",
      "'${BUYER_SIGNED_CPS[1]}'",
      "'${BUYER_SIGNED_CPS[2]}'"
    ]
  }'
```

**Response (200):**
```json
{
  "success": true
}
```

**What happens backend:**
- Escrow field updated:
  - `buyerSignedCheckpoints` = JSON-stringified array of buyer-signed checkpoint txs
  - `status` = "buyerCheckpointsSigned"
- Both parties receive `escrow_update` WebSocket notification
- Seller can now proceed to Step 7

---

### Step 7 — Seller Retrieves Checkpoints

**Who:** Seller

**Endpoint:** `GET /api/escrows/address/:address/collaborate/seller-checkpoints`

**Headers:**
```
Authorization: Bearer <SELLER_TOKEN>
```

**Request:**
```bash
curl -X GET "http://localhost:3000/api/escrows/address/tark1xxxxxxxxxxxxx/collaborate/seller-checkpoints" \
  -H "Authorization: Bearer $SELLER_TOKEN"
```

**Response (200 - if ready):**
```json
{
  "status": "buyerCheckpointsSigned",
  "arkTxid": "abc123def...",
  "checkpointTxs": [
    "cHNidP8BAA...",
    "cHNidP8BAA...",
    "cHNidP8BAA..."
  ]
}
```

**Response (200 - if not ready):**
```json
{
  "status": "buyerSubmitted",
  "checkpointTxs": null
}
```

**What happens:**
- Server checks if `escrow.status === "buyerCheckpointsSigned"` and `buyerSignedCheckpoints` is set
- If yes: returns arkTxid and buyer's signed checkpoints
- If no: returns null with current status
- Seller polls until checkpoints are available

---

### Step 8 — Seller Signs and Finalizes

**Who:** Seller

**Action:**
1. Client receives `checkpointTxs` from Step 7 (pre-signed by Ark server and buyer)
2. Client signs each checkpoint with seller's private key
3. Client submits all fully-signed checkpoints to backend for finalization

**Endpoint:** `POST /api/escrows/address/:address/collaborate/seller-sign-checkpoints`

**Headers:**
```
Authorization: Bearer <SELLER_TOKEN>
Content-Type: application/json
```

**Request:**
```bash
SELLER_SIGNED_CPS=[
  "$(sign_checkpoint_with_seller_key "cHNidP8BAA1...")",
  "$(sign_checkpoint_with_seller_key "cHNidP8BAA2...")",
  "$(sign_checkpoint_with_seller_key "cHNidP8BAA3...")"
]

curl -X POST "http://localhost:3000/api/escrows/address/tark1xxxxxxxxxxxxx/collaborate/seller-sign-checkpoints" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signedCheckpointTxs": [
      "'${SELLER_SIGNED_CPS[0]}'",
      "'${SELLER_SIGNED_CPS[1]}'",
      "'${SELLER_SIGNED_CPS[2]}'"
    ]
  }'
```

**Response (200):**
```json
{
  "success": true,
  "arkTxid": "abc123def..."
}
```

**What happens backend:**
- Backend calls `arkProvider.finalizeTx(arkTxid, signedCheckpointTxs)`
- Ark network validates all signatures and commits the transaction on-chain
- Escrow state updated in atomic transaction:
  - `status` = "completed"
  - `releasedAt` = now
  - Associated chat `status` = "closed"
- Both parties receive `escrow_update` WebSocket notification
- **Transaction is now final on-chain; funds have been released to seller**

---

## State Diagram

```
awaitingFunds
    ↓
    (buyer sends funds)
    ↓
fundLocked ← [buyer monitors address via GET /api/escrows/address/:address]
    ↓
    (seller requests PSBT)
    ↓
sellerReady ← [seller signs and submits PSBT]
    ↓
    (buyer signs PSBT)
    ↓
buyerSubmitted ← [buyer submits fully-signed PSBT to Ark]
    ↓
    (buyer signs checkpoints)
    ↓
buyerCheckpointsSigned ← [buyer submits signed checkpoints]
    ↓
    (seller signs checkpoints)
    ↓
completed ← [seller finalizes transaction on-chain]
    ↓
(chat closed, review can be posted)
```

---

## Error Handling

| Step | Error | Cause | Resolution |
| ---- | ----- | ----- | ---------- |
| 2 | 400 `Cannot build PSBT in awaitingFunds status` | Escrow not yet funded | Wait for funding, then check status via GET /api/escrows/address/:address |
| 3 | 400 `Escrow not found` | Address typo or wrong escrow | Verify address from Step 1 response |
| 3 | 403 `Forbidden` | Non-seller trying to submit | Ensure correct Bearer token (seller's) |
| 4 | 200 with null PSBT | Seller has not signed yet | Wait and poll again; ask seller to complete Step 3 |
| 5 | 400 `Seller has not signed yet` | Status is not `sellerReady` | Wait for seller to complete Step 3 |
| 5 | 502 `Failed to submit transaction` | Ark network error | Retry after a few seconds |
| 6 | 400 `Transaction not submitted yet` | Status is not `buyerSubmitted` | Wait for transaction submission (Step 5) |
| 7 | 200 with null checkpoints | Buyer has not signed yet | Wait and poll again; ask buyer to complete Step 6 |
| 8 | 400 `Buyer has not signed checkpoints yet` | Status is not `buyerCheckpointsSigned` | Wait for buyer to complete Step 6 |
| 8 | 502 `Failed to finalize transaction` | Ark network error | Retry after a few seconds |

---

## Time Estimates

- **Step 2-3:** Seconds (client-side signing)
- **Step 4-5:** Seconds (client-side signing + Ark submission)
- **Step 6-7:** Seconds (client-side signing)
- **Step 8:** Seconds to minutes (depends on Ark network confirmation)

**Total typical time:** 30 seconds to 2 minutes from fully funded to completed.

---

## Notes

- **No timelock wait:** Unlike refund path, collaborative path does not require waiting for timelock expiry
- **Both must cooperate:** If seller or buyer disappears, the other party must use refund path (if available within timelock window)
- **Deterministic address:** Escrow address is derived from buyer/seller/timelock, so it's the same for all participants
- **Arkade Ark server** provides the checkpoints; participants sign server-generated checkpoint txs
- **Fully on-chain:** Once finalized, the transaction is immutable on-chain
- **Atomic finalization:** Chat is closed at the same moment escrow status changes to completed
