# Messages and Offers Endpoints

Messages and offers are the core negotiation mechanism. Buyers send messages and propose offers within a chat; sellers respond to offers. Accepted offers trigger escrow creation and payment flows.

## Autenticazione

All endpoints in this group require a valid Bearer token (obtained from `/api/auth/login`). Authorization is enforced — users can only post/view messages in chats where they are either the buyer or the seller.

---

## `POST /api/messages/:chatId`

Send a message or make a price offer within a chat. If `offeredPrice` is provided, invalidates previous offers and creates a new one.

**Autenticazione:** Bearer token + Schnorr signature
**Sender pubkey:** Extracted from Bearer token
**Offer creation:** Only the buyer can make offers

### Request

```
POST /api/messages/123
```

Body:

```json
{
  "message": "string | null — optional text message",
  "offeredPrice": "number | null — optional price in satoshi if making an offer",
  "signature": "string — hex-encoded Schnorr signature over {message?, offeredPrice?}"
}
```

At least one of `message` or `offeredPrice` must be provided. The signature must verify over the JSON-serialized request body (excluding signature) with keys sorted alphabetically.

If `offeredPrice` is included:
- Only the buyer can send this message
- All previous valid offers in this chat are marked invalid
- A new Offer record is created

If only `message` is provided:
- Both buyer and seller can send

### Response (200)

Plain message response (if no offer):

```json
{
  "id": "number — message ID",
  "chatId": "number",
  "message": "string",
  "senderPubkey": "string — sender's pubkey",
  "signature": "string",
  "isSystem": "false",
  "sentAt": "ISO 8601 datetime"
}
```

Offer response (if `offeredPrice` provided):

```json
{
  "id": "number — message ID",
  "chatId": "number",
  "message": "string | null",
  "senderPubkey": "string — buyer pubkey",
  "signature": "string",
  "isSystem": "false",
  "sentAt": "ISO 8601 datetime",
  "offer": {
    "id": "number — offer ID",
    "messageId": "number",
    "price": "number — offered price",
    "valid": "true",
    "createdAt": "ISO 8601 datetime",
    "acceptance": "null"
  }
}
```

### Side Effects

- Both buyer and seller receive a WebSocket notification:
  - Type: `"new_message"` or `"new_offer"`
  - Includes `chatId` and offer price (if applicable)

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 400    | Neither message nor offeredPrice provided |
| 401    | Missing or invalid Bearer token |
| 401    | Invalid signature |
| 403    | Forbidden — sender is not buyer or seller of this chat |
| 403    | Only the buyer can make offers — sender is seller but included offeredPrice |
| 404    | Chat not found |

### Esempio curl

Send a plain message:

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
PUBKEY="02abcd..."

SIGNATURE=$(sign_schnorr '{"message":"Hello seller"}' $PUBKEY)

curl -X POST http://localhost:3000/api/messages/123 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "message": "Hello seller",
    "signature": "'$SIGNATURE'"
  }'
```

Make an offer:

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
PUBKEY="02abcd..."

SIGNATURE=$(sign_schnorr '{"message":"Below listing price","offeredPrice":4500}' $PUBKEY)

curl -X POST http://localhost:3000/api/messages/123 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "message": "Below listing price",
    "offeredPrice": 4500,
    "signature": "'$SIGNATURE'"
  }'
```

---

## `GET /api/messages/:chatId/offers/active`

Get the most recent valid (active and unanswered) offer in a chat.

**Autenticazione:** Bearer token
**Authorization:** User must be the buyer or seller of this chat

### Request

```
GET /api/messages/123/offers/active
```

Path parameters:

- `chatId`: Chat ID (numeric)

### Response (200)

```json
{
  "id": "number",
  "messageId": "number",
  "price": "number — offered price in satoshi",
  "valid": "true",
  "createdAt": "ISO 8601 datetime",
  "message": {
    "id": "number",
    "chatId": "number",
    "message": "string | null",
    "senderPubkey": "string",
    "signature": "string",
    "isSystem": "boolean",
    "sentAt": "ISO 8601 datetime"
  },
  "acceptance": "null"
}
```

Returns only offers that are both valid and not yet accepted/rejected.

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |
| 404    | Chat not found or not authorized |
| 404    | No active offer found |

### Esempio curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3000/api/messages/123/offers/active \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/messages/:chatId/offers/:offerId/respond`

Accept or reject an offer. Only the seller can respond to offers.

**Autenticazione:** Bearer token + Schnorr signature
**Responder:** Must be the listing seller
**Offer state:** Offer must be valid and not yet responded to

### Request

```
POST /api/messages/123/offers/456/respond
```

Body:

```json
{
  "accepted": "boolean — true to accept, false to reject",
  "signature": "string — hex-encoded Schnorr signature over {accepted: boolean}"
}
```

The signature must verify over the JSON-serialized body (excluding signature) with keys sorted alphabetically.

### Response (200)

```json
{
  "id": "number — acceptance record ID",
  "offerId": "number",
  "signature": "string — seller's signature",
  "accepted": "boolean",
  "createdAt": "ISO 8601 datetime"
}
```

### Side Effects

- Both buyer and seller receive a WebSocket notification:
  - Type: `"offer_accepted"` or `"offer_rejected"`
  - Includes `chatId` and `offerId`

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 400    | Offer is no longer valid — has been superseded by newer offer |
| 400    | Offer already responded to — already accepted/rejected |
| 401    | Missing or invalid Bearer token |
| 401    | Invalid signature |
| 403    | Only the seller can respond to offers |
| 404    | Offer not found |
| 404    | Offer not found (offer does not belong to this chat) |

### Esempio curl

Accept an offer:

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
PUBKEY="02abcd..."

SIGNATURE=$(sign_schnorr '{"accepted":true}' $PUBKEY)

curl -X POST http://localhost:3000/api/messages/123/offers/456/respond \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "accepted": true,
    "signature": "'$SIGNATURE'"
  }'
```

Reject an offer:

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
PUBKEY="02abcd..."

SIGNATURE=$(sign_schnorr '{"accepted":false}' $PUBKEY)

curl -X POST http://localhost:3000/api/messages/123/offers/456/respond \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "accepted": false,
    "signature": "'$SIGNATURE'"
  }'
```

---

## Offer Workflow

1. **Buyer Makes Offer**:
   - POST `/api/messages/:chatId` with `offeredPrice` and optional `message`
   - Seller receives `new_offer` notification

2. **Seller Reviews Active Offer**:
   - GET `/api/messages/:chatId/offers/active` to get current offer
   - Can see message history via GET `/api/chats/:chatId`

3. **Seller Accepts or Rejects**:
   - POST `/api/messages/:chatId/offers/:offerId/respond` with `accepted` true/false
   - Buyer receives notification

4. **Create Escrow (if accepted)**:
   - POST `/api/escrows/:chatId` to create the escrow
   - Escrow address is generated; awaits buyer funding

5. **Payment Flow**:
   - Either collaborative path (both sign) or refund path (after timelock)
   - Described in [api-escrows.md](api-escrows.md)

---

## Notes

- Offers are created per-message; only one valid offer can exist at a time in a chat
- When a buyer makes a new offer, all previous valid offers are automatically marked invalid
- Sellers can only respond to the most recent valid offer
- Once an offer is accepted, an escrow must be created to proceed with payment
- Messages are permanently recorded; there is no delete operation
- All message and offer bodies are signed by the sender using Schnorr signatures for non-repudiation
