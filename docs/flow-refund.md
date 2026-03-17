# Refund Flow

The refund flow enables the buyer to recover funds after the timelock expires (or if the seller abandons the collaborative path). This is the **safety path** through an escrow.

## Overview

When collaborative negotiation fails or the timelock window arrives:
1. Buyer requests a refund PSBT from the escrow address
2. Buyer signs the PSBT with their private key
3. Buyer submits signed PSBT to Ark network
4. Ark server returns checkpoint transactions
5. Buyer signs the checkpoint transactions
6. Buyer finalizes the transaction — funds are returned to buyer's recipient address

**Total participants:** Buyer, Ark Server (2-of-2 multisig with CLTV timelock)

**When available:** Anytime after escrow enters `fundLocked` status (if collaborative path was not completed), and timelock must have expired for actual on-chain settlement.

**Timeframe:** Depends on timelock expiry; can begin immediately if timelock already expired.

---

## Prerequisite States

Before starting the refund flow:

- **Escrow created** with status `awaitingFunds` (see [api-escrows.md](api-escrows.md))
- **Escrow fully funded** with status `fundLocked` (buyer has sent funds to escrow address)
- **Collaborative path not completed** (status is not `completed`)
- **Collaborative path not submitted to Ark** (status is not `buyerSubmitted` or beyond)
- **Timelock must be expired** (for actual on-chain settlement)

**Status transitions allowed:** Can refund from `fundLocked`, `partiallyFunded`, or `sellerReady` status.

---

## Step-by-Step Sequence

### Step 1 — Buyer Funds Escrow (Same as Collaborative)

**Who:** Buyer (off-chain Bitcoin transaction)

**Action:** Send funds to the escrow address.

The escrow address is generated and communicated when escrow is created:

```bash
POST /api/escrows/:chatId
# Returns escrow.address = "tark1xxxxxxxxxxxxx"
```

**Expected amount:** At least `escrow.price` satoshi.

**What happens backend:**
- Buyer monitors the escrow address
- When funds arrive, backend can transition status to `fundLocked` via GET `/api/escrows/address/:address`
- Funds are committed to the VTXO at the escrow address

---

### Step 2 — Wait for Timelock (Optional)

**Who:** Buyer

**Waiting for:** `escrow.timelockExpiry` to be reached (Unix timestamp)

If the seller is unresponsive or negotiation fails, the buyer can wait until the timelock expires. However, **the refund endpoint does not enforce timelock expiry** — the buyer can request the PSBT immediately.

**On-chain enforcement:** The actual CLTV timelock is embedded in the tapscript. The Ark network will enforce it when the transaction is submitted.

**Practical note:** You can request the PSBT and sign immediately, but the Ark network will reject submission if timelock has not expired yet.

---

### Step 3 — Buyer Requests Refund PSBT

**Who:** Buyer

**Endpoint:** `GET /api/escrows/address/:address/refund/psbt`

**Headers:**
```
Authorization: Bearer <BUYER_TOKEN>
```

**Request:**
```bash
curl -X GET "http://localhost:3000/api/escrows/address/tark1xxxxxxxxxxxxx/refund/psbt" \
  -H "Authorization: Bearer $BUYER_TOKEN"
```

**Response (200):**
```json
{
  "refundPsbt": "cHNidP8BAA...",
  "recipientAddress": "tark1zzzzzzzzzzzzz"
}
```

**What happens backend:**
- Server queries Ark indexer for all spendable VTXOs at escrow address
- Builds unsigned PSBT with:
  - **Inputs:** all VTXOs
  - **Output:** full amount to recipient address (buyer's Ark address)
  - **Spend path:** refund (2-of-2 multisig: buyer, server with CLTV timelock)
- Returns base64-encoded PSBT

**Recipient address:** Buyer's personal Ark address. Pre-computed by client during escrow creation, or derived server-side from buyer pubkey.

---

### Step 4 — Buyer Signs and Submits PSBT

**Who:** Buyer

**Action:**
1. Client receives PSBT from Step 3
2. Client signs PSBT with buyer's private key
3. Client submits signed PSBT to backend

**Endpoint:** `POST /api/escrows/address/:address/refund/submit-signed-psbt`

**Headers:**
```
Authorization: Bearer <BUYER_TOKEN>
Content-Type: application/json
```

**Request:**
```bash
SIGNED_PSBT=$(sign_psbt_with_buyer_key "cHNidP8BAA...")

curl -X POST "http://localhost:3000/api/escrows/address/tark1xxxxxxxxxxxxx/refund/submit-signed-psbt" \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signedPsbt": "'$SIGNED_PSBT'"
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
- Ark server validates signatures (including CLTV timelock check)
- If timelock has not expired: Ark server may reject submission (error handling required)
- If successful:
  - Returns arkTxid and server-signed checkpoint transactions
- Escrow status does NOT change on refund submission (remains in current state until finalization)

**Note:** Unlike collaborative path, there's no intermediate status update here. The escrow only transitions to `refunded` when finalization completes.

---

### Step 5 — Buyer Signs Checkpoints

**Who:** Buyer

**Action:**
1. Client receives `signedCheckpointTxs` from Step 4 (pre-signed by Ark server)
2. Client signs each checkpoint with buyer's private key
3. Client submits buyer's signed checkpoints to backend

**Endpoint:** `POST /api/escrows/address/:address/refund/finalize`

Note: Unlike collaborative path, refund finalization includes checkpoint signing in a single step.

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

curl -X POST "http://localhost:3000/api/escrows/address/tark1xxxxxxxxxxxxx/refund/finalize" \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "arkTxid": "abc123def...",
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
  "success": true,
  "arkTxid": "abc123def..."
}
```

**What happens backend:**
- Backend calls `arkProvider.finalizeTx(arkTxid, signedCheckpointTxs)`
- Ark network validates all signatures and timelock condition
- If timelock not yet expired: Ark network rejects (error handling required)
- If successful:
  - Escrow state updated in atomic transaction:
    - `status` = "refunded"
    - Associated chat `status` = "closed"
  - Both parties receive `escrow_update` WebSocket notification
- **Transaction is now final on-chain; funds have been refunded to buyer**

---

## State Diagram

```
awaitingFunds
    ↓
    (buyer sends funds)
    ↓
fundLocked ← [buyer monitors address via GET /api/escrows/address/:address]
    ├─ OR from → sellerReady (if seller signed but buyer wants to refund)
    ├─ OR from → partiallyFunded (if under-funded)
    ↓
    (wait for timelock expiry OR initiate immediately)
    ↓
    (buyer requests refund PSBT)
    ↓
    (buyer signs PSBT and submits to Ark)
    ↓
    (buyer signs checkpoints)
    ↓
refunded ← [buyer finalizes transaction on-chain]
    ↓
(chat closed, review can be posted)
```

---

## Error Handling

| Step | Error | Cause | Resolution |
| ---- | ----- | ----- | ---------- |
| 3 | 404 `Escrow not found` | Address typo or wrong escrow | Verify address from escrow creation response |
| 3 | 403 `Forbidden` | Non-buyer trying to request | Ensure correct Bearer token (buyer's) |
| 3 | 502 `Failed to build refund PSBT` | Ark network or indexer error | Retry after a few seconds |
| 4 | 403 `Forbidden` | Non-buyer trying to submit | Ensure correct Bearer token (buyer's) |
| 4 | 502 `Failed to submit transaction` | Timelock not expired OR Ark network error | Wait until timelock expires; retry after a few seconds |
| 5 | 400 `Cannot refund escrow in {status} status` | Invalid status for refund | Check status; can only refund from fundLocked, partiallyFunded, or sellerReady |
| 5 | 403 `Forbidden` | Non-buyer trying to finalize | Ensure correct Bearer token (buyer's) |
| 5 | 502 `Failed to finalize transaction` | Timelock not expired OR Ark network error | Timelock must have expired; retry after a few seconds |

---

## Time Estimates

- **Step 3:** Seconds (PSBT building)
- **Step 4:** Seconds (client-side signing)
- **Step 5:** Seconds (client-side signing + finalization)

**Total typical time (excluding timelock wait):** 10-30 seconds from PSBT request to finalized.

**Including timelock wait:** Depends on `timelockExpiry` value set during escrow creation (typically 1 hour, 24 hours, or custom duration).

---

## Comparison: Refund vs. Collaborative

| Aspect | Collaborative | Refund |
| --- | --- | --- |
| **Participants** | Buyer, Seller, Server (3-of-3) | Buyer, Server (2-of-2) |
| **Timelock required** | No | Yes (must be expired for on-chain) |
| **Complexity** | 4 round-trips | 2 round-trips |
| **When to use** | Both parties agree | Seller gone / negotiation failed |
| **Speed** | Fast (no wait) | Slower (must wait for timelock) |
| **Seller involvement** | Mandatory | None |

---

## Scenarios

### Scenario 1: Seller Disappears

1. Buyer and seller agree on price (offer accepted)
2. Buyer creates escrow and funds it
3. Seller never requests PSBT or goes offline
4. Buyer waits for timelock expiry
5. Buyer initiates refund flow (Steps 3-5)
6. Funds returned to buyer

### Scenario 2: Seller Signs but Buyer Doesn't Trust

1. Seller signs collaborative PSBT (escrow status = `sellerReady`)
2. Buyer realizes deal is bad or server is down
3. Buyer initiates refund flow instead (Steps 3-5)
4. Funds returned to buyer; collaborative path abandoned

### Scenario 3: Collaborative Path Fails at Finalization

1. Buyer and seller complete Steps 1-7 of collaborative flow
2. Seller tries to finalize but Ark network is down
3. Buyer waits until timelock expires (if desired)
4. Buyer initiates refund flow as fallback (Steps 3-5)
5. Funds returned to buyer (refund takes precedence)

---

## Notes

- **CLTV Timelock:** Embedded in the refund tapscript. The Ark network enforces it.
- **Deterministic address:** Escrow address is the same for both collaborative and refund paths.
- **Only buyer can refund:** Only the buyer has the authority (and recipient address) to claim the refund.
- **Seller cannot block refund:** Once timelock expires, seller cannot prevent buyer from reclaiming funds.
- **Partial funding allowed:** Buyer can refund even if escrow was only partially funded (e.g., ran out of Bitcoin mid-transaction).
- **No chat status change until finalization:** Escrow status stays unchanged during submission; chat closes only when refund is finalized.
- **Arkade Ark server** provides checkpoints; buyer signs them with their key.
- **Fully on-chain:** Once finalized, the transaction is immutable on-chain.
