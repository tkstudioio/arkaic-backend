# Chats and Offers Endpoints

Chats enable buyers and sellers to negotiate a purchase. Each chat is tied to a specific listing and involves two parties: the buyer and the seller. Within chats, buyers can make price offers and sellers can accept or reject them. Messages and offer negotiation happen through these endpoints.

## Autenticazione

All endpoints in this group require a valid Bearer token (obtained from `/api/auth/login`). Authorization is enforced at the endpoint level — users can only view/modify chats where they are either the buyer or the seller (listing owner).

---

## `GET /api/chats`

Get a paginated list of all chats involving the authenticated user (as buyer or seller), ordered by most recent message.

**Authentication:** Bearer token
**Pagination:** limit (default 20, max 100) and offset (default 0)

### Request

Query parameters:

```
GET /api/chats?limit=20&offset=0
```

- `limit`: Maximum number of chats to return (capped at 100, default 20)
- `offset`: Number of chats to skip for pagination (default 0)

### Response (200)

```json
{
  "chats": [
    {
      "id": "number — chat ID",
      "listingId": "number — listing ID",
      "buyerPubkey": "string — hex-encoded buyer pubkey",
      "arbiterPubkey": "string | null — hex-encoded arbiter pubkey if assigned",
      "signature": "string — signature from creation",
      "status": "string — chat status ('open' or 'closed')",
      "createdAt": "ISO 8601 datetime",
      "buyer": {
        "pubkey": "string",
        "username": "string",
        "createdAt": "ISO 8601 datetime",
        "isArbiter": "boolean"
      },
      "listing": {
        "id": "number",
        "name": "string",
        "price": "number",
        "description": "string | null",
        "categoryId": "number | null",
        "sellerPubkey": "string",
        "createdAt": "ISO 8601 datetime",
        "seller": {
          "pubkey": "string",
          "username": "string",
          "createdAt": "ISO 8601 datetime",
          "isArbiter": "boolean"
        },
        "category": {
          "id": "number | null",
          "name": "string | null",
          "slug": "string | null"
        } | null
      },
      "escrow": {
        "status": "string — escrow status (if escrow exists)"
      } | null,
      "messages": [
        {
          "id": "number",
          "message": "string | null",
          "senderPubkey": "string | null",
          "signature": "string | null",
          "isSystem": "boolean",
          "sentAt": "ISO 8601 datetime",
          "offer": {
            "id": "number",
            "price": "number",
            "valid": "boolean",
            "createdAt": "ISO 8601 datetime"
          } | null
        }
      ]
    }
  ],
  "total": "number — total count of user's chats"
}
```

Chats are ordered by most recent message first (`messages[0].sentAt` descending). Each chat includes only the most recent message (if any messages exist). Includes escrow status (if escrow exists) for quick reference.

### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid limit (less than 1 or greater than 100) |
| 400    | Invalid offset (negative) |
| 401    | Missing or invalid Bearer token |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Get first 20 chats
curl -X GET "http://localhost:3000/api/chats?limit=20&offset=0" \
  -H "Authorization: Bearer $TOKEN"

# Get next page
curl -X GET "http://localhost:3000/api/chats?limit=20&offset=20" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/chats/:listingId`

Create a new chat for a listing (buyer initiates). If a chat already exists between this buyer and listing, returns the existing chat instead.

**Autenticazione:** Bearer token + Schnorr signature
**Buyer pubkey:** Extracted from Bearer token
**Seller pubkey:** Retrieved from listing (must not be same as buyer)

### Request

```
POST /api/chats/42
```

Body:

```json
{
  "signature": "string — hex-encoded Schnorr signature (empty payload or over empty object)"
}
```

Path parameters:

- `listingId`: ID of the listing to open a chat for (numeric)

The signature proves the buyer's intent to initiate the chat.

### Response (200)

```json
{
  "id": "number — chat ID",
  "listingId": "number — listing ID",
  "buyerPubkey": "string — hex-encoded buyer pubkey",
  "arbiterPubkey": "string | null — hex-encoded arbiter pubkey if assigned",
  "signature": "string — signature from creation",
  "status": "string — chat status ('open' or 'closed')",
  "createdAt": "ISO 8601 datetime",
  "messages": "array — empty array on creation"
}
```

If a chat already exists for this buyer-listing pair, returns the existing chat with its existing messages and offer state.

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |
| 401    | Invalid signature — does not verify against buyer pubkey |
| 403    | Cannot create a chat on your own listing — buyer pubkey matches seller pubkey |
| 404    | Listing not found |

### Esempio curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
PUBKEY="02abcd..."

SIGNATURE="deadbeef..."

curl -X POST http://localhost:3000/api/chats/42 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "signature": "'$SIGNATURE'"
  }'
```

---

## `GET /api/chats/:chatId`

Get full details of a chat including messages and offer information.

**Autenticazione:** Bearer token
**Authorization:** User must be the buyer or seller (listing owner) of this chat

### Request

```
GET /api/chats/123
```

Path parameters:

- `chatId`: Chat ID (numeric)

### Response (200)

```json
{
  "id": "number — chat ID",
  "listingId": "number — listing ID",
  "buyerPubkey": "string — hex-encoded buyer pubkey",
  "arbiterPubkey": "string | null — arbiter pubkey if assigned",
  "signature": "string — creation signature",
  "status": "string — 'open' or 'closed'",
  "createdAt": "ISO 8601 datetime",
  "buyer": {
    "pubkey": "string",
    "username": "string",
    "createdAt": "ISO 8601 datetime",
    "isArbiter": "boolean"
  },
  "listing": {
    "id": "number",
    "name": "string",
    "price": "number",
    "sellerPubkey": "string",
    "createdAt": "ISO 8601 datetime",
    "seller": {
      "pubkey": "string",
      "username": "string",
      "createdAt": "ISO 8601 datetime",
      "isArbiter": "boolean"
    }
  },
  "escrow": {
    "address": "string",
    "status": "string — escrow status",
    ...
  } | null,
  "messages": [
    {
      "id": "number",
      "message": "string | null",
      "senderPubkey": "string | null",
      "signature": "string | null",
      "isSystem": "boolean",
      "sentAt": "ISO 8601 datetime",
      "sender": {
        "pubkey": "string",
        "username": "string",
        ...
      } | null,
      "offer": {
        "id": "number",
        "price": "number",
        "valid": "boolean",
        "createdAt": "ISO 8601 datetime",
        "acceptance": {
          "id": "number",
          "signature": "string",
          "accepted": "boolean",
          "createdAt": "ISO 8601 datetime"
        } | null
      } | null
    }
  ]
}
```

Messages are ordered by sentAt in descending order (newest first). Includes full offer acceptance chain for negotiation history.

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |
| 404    | Chat not found (or user is not authorized to view it) |

### Esempio curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3000/api/chats/123 \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/chats/:chatId/escrow`

Get the escrow associated with this chat (if one exists).

**Autenticazione:** Bearer token
**Authorization:** User must be the buyer or seller (listing owner) of this chat

### Request

```
GET /api/chats/123/escrow
```

Path parameters:

- `chatId`: Chat ID (numeric)

### Response (200)

```json
{
  "address": "string — escrow address (Ark address)",
  "buyerPubkey": "string",
  "sellerPubkey": "string",
  "serverPubkey": "string",
  "arbiterPubkey": "string | null",
  "price": "number — price in satoshi",
  "timelockExpiry": "number — Unix timestamp of refund timelock expiry",
  "chatId": "number",
  "status": "string — escrow status (awaitingFunds, partiallyFunded, fundLocked, sellerReady, buyerSubmitted, buyerCheckpointsSigned, completed, refunded)",
  "sellerSignedCollabPsbt": "string | null — seller's signed PSBT for collaborative release",
  "collabArkTxid": "string | null — Ark transaction ID if collaborative path was submitted",
  "serverSignedCheckpoints": "string | null — JSON-stringified array of server-signed checkpoint txs",
  "buyerSignedCheckpoints": "string | null — JSON-stringified array of buyer-signed checkpoint txs",
  "createdAt": "ISO 8601 datetime",
  "fundedAt": "ISO 8601 datetime | null",
  "releasedAt": "ISO 8601 datetime | null",
  "offerId": "number | null"
}
```

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |
| 404    | Chat not found or not authorized |
| 404    | Escrow not found (no escrow created for this chat yet) |

### Esempio curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3000/api/chats/123/escrow \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/chats/:chatId/offer`

Get the most recent valid (active) offer in this chat.

**Autenticazione:** Bearer token
**Authorization:** User must be the buyer or seller (listing owner) of this chat

### Request

```
GET /api/chats/123/offer
```

Path parameters:

- `chatId`: Chat ID (numeric)

### Response (200)

```json
{
  "id": "number",
  "messageId": "number — message ID containing this offer",
  "price": "number — offered price in satoshi",
  "valid": "boolean — true if this offer has not been superseded",
  "createdAt": "ISO 8601 datetime",
  "acceptance": {
    "id": "number",
    "offerId": "number",
    "signature": "string — seller's signature on acceptance",
    "accepted": "boolean — true if seller accepted, false if rejected",
    "createdAt": "ISO 8601 datetime"
  } | null
}
```

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 204    | No active offer found — chat has no valid, unanswered offer |
| 401    | Missing or invalid Bearer token |
| 404    | Chat not found or not authorized |

### Esempio curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3000/api/chats/123/offer \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/chats/seller/:listingId`

Get all chats for a specific listing where the authenticated user is the seller.

**Autenticazione:** Bearer token
**Authorization:** Must own the listing (seller pubkey must match Bearer token pubkey)

### Request

```
GET /api/chats/seller/42
```

Path parameters:

- `listingId`: Listing ID (numeric)

### Response (200)

```json
[
  {
    "id": "number",
    "listingId": "number",
    "buyerPubkey": "string",
    "arbiterPubkey": "string | null",
    "signature": "string",
    "status": "string",
    "createdAt": "ISO 8601 datetime",
    "buyer": {
      "pubkey": "string",
      "username": "string",
      "createdAt": "ISO 8601 datetime",
      "isArbiter": "boolean"
    },
    "messages": [
      {
        "id": "number",
        "message": "string | null",
        "senderPubkey": "string | null",
        "sentAt": "ISO 8601 datetime"
        // ... only 1 most recent message included
      }
    ]
  }
]
```

Returns chats ordered with most recent messages first. Includes only the most recent message from each chat.

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |

### Esempio curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3000/api/chats/seller/42 \
  -H "Authorization: Bearer $TOKEN"
```

---

## Offer and Message Endpoints

See [api-messages.md](api-messages.md) for endpoints to:
- Send messages and make offers: POST `/api/messages/:chatId`
- Respond to offers: POST `/api/messages/:chatId/offers/:offerId/respond`
- Get active offers: GET `/api/messages/:chatId/offers/active`

---

## Chat Workflow

1. **Buyer Opens Chat**:
   - POST `/api/chats/:listingId` with signature
   - Seller receives `new_message` notification via WebSocket

2. **Buyer and Seller Exchange Messages**:
   - POST `/api/messages/:chatId` to send messages

3. **Buyer Makes Offers**:
   - POST `/api/messages/:chatId` with `offeredPrice` and `message`
   - Seller receives `new_offer` notification

4. **Seller Accepts or Rejects**:
   - POST `/api/messages/:chatId/offers/:offerId/respond` with `accepted` true/false
   - Both parties receive notification

5. **Create Escrow (once offer accepted)**:
   - POST `/api/escrows/:chatId` to create escrow
   - Proceeds to either collaborative or refund payment flow

---

## Notes

- Each buyer can have at most one active chat per listing
- Chat status transitions from 'open' to 'closed' only when an escrow is completed or refunded
- Messages can be plain text or contain embedded offers (via `offeredPrice` field)
- Offers are immutable once created; new offers invalidate previous ones
- Authorization is checked at the endpoint level and returns 404 if unauthorized (to prevent chat existence leakage)
