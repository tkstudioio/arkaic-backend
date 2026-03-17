# Listings Endpoints

Listings represent products for sale on the marketplace. Sellers create listings with a name and price; buyers browse and initiate purchase negotiations through chats.

## Autenticazione

All endpoints in this group require a valid Bearer token (obtained from `/api/auth/login`).

---

## `POST /api/listings`

Create a new listing. Requires Schnorr signature over the listing data.

**Autenticazione:** Bearer token + Schnorr signature
**Seller pubkey:** Extracted from Bearer token
**Price range:** Must be greater than the Ark provider's dust fee

### Request

```json
{
  "name": "string — listing title (minimum 3 characters)",
  "price": "number — price in satoshi (must exceed dust fee)",
  "signature": "string — hex-encoded Schnorr signature over {name, price}"
}
```

The signature must be a valid Schnorr signature over the JSON-serialized request body (excluding the signature field itself) with keys sorted alphabetically. This proves the seller approves this listing creation.

### Response (200)

```json
{
  "id": "number — unique listing ID",
  "name": "string — listing name",
  "price": "number — price in satoshi",
  "sellerPubkey": "string — hex-encoded public key of seller",
  "signature": "string — the signature provided in the request",
  "createdAt": "ISO 8601 datetime — when listing was created"
}
```

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 400    | Price is less than or equal to Ark provider's dust fee |
| 400    | Invalid JSON schema (missing or wrong type for name, price, signature) |
| 401    | Missing or invalid Bearer token |
| 401    | Invalid signature — does not verify against the seller's pubkey |

### Esempio curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
PUBKEY="02abcd..."

# Create signature over sorted {"name": "...", "price": ...}
SIGNATURE="deadbeef..."

curl -X POST http://localhost:3000/api/listings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Bitcoin Hardware Wallet",
    "price": 5000,
    "signature": "'$SIGNATURE'"
  }'
```

---

## `GET /api/listings`

List all active listings (excluding listings created by the authenticated user). Returns paginated results.

**Autenticazione:** Bearer token
**Pagination:** limit (default 20, max 100) and offset (default 0)

### Request

Query parameters:

```
GET /api/listings?limit=20&offset=0
```

- `limit`: Maximum number of listings to return (capped at 100)
- `offset`: Number of listings to skip (for pagination)

### Response (200)

```json
[
  {
    "id": "number — listing ID",
    "name": "string — listing name",
    "price": "number — price in satoshi",
    "sellerPubkey": "string — hex-encoded seller pubkey",
    "signature": "string — creator signature",
    "createdAt": "ISO 8601 datetime",
    "seller": {
      "pubkey": "string — seller's public key",
      "username": "string — seller's username",
      "createdAt": "ISO 8601 datetime",
      "isArbiter": "boolean"
    }
  }
]
```

Results are ordered by listing ID in descending order (newest first). Listings owned by the authenticated user are excluded.

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |

### Esempio curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Get first 20 listings
curl -X GET "http://localhost:3000/api/listings?limit=20&offset=0" \
  -H "Authorization: Bearer $TOKEN"

# Get next 20 listings
curl -X GET "http://localhost:3000/api/listings?limit=20&offset=20" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/listings/my-listings`

List all active listings created by the authenticated user.

**Autenticazione:** Bearer token

### Request

```
GET /api/listings/my-listings
```

No query parameters.

### Response (200)

```json
[
  {
    "id": "number — listing ID",
    "name": "string — listing name",
    "price": "number — price in satoshi",
    "sellerPubkey": "string — hex-encoded seller pubkey",
    "signature": "string — creator signature",
    "createdAt": "ISO 8601 datetime",
    "seller": {
      "pubkey": "string — seller's public key",
      "username": "string — seller's username",
      "createdAt": "ISO 8601 datetime",
      "isArbiter": "boolean"
    }
  }
]
```

Includes seller details. Results are unordered (returned as-is from database).

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |

### Esempio curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3000/api/listings/my-listings \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/listings/:id`

Get details of a specific listing by ID.

**Autenticazione:** Bearer token

### Request

```
GET /api/listings/42
```

Path parameters:

- `id`: Listing ID (numeric)

### Response (200)

```json
{
  "id": "number — listing ID",
  "name": "string — listing name",
  "price": "number — price in satoshi",
  "sellerPubkey": "string — hex-encoded seller pubkey",
  "signature": "string — creator signature",
  "createdAt": "ISO 8601 datetime",
  "seller": {
    "pubkey": "string — seller's public key",
    "username": "string — seller's username",
    "createdAt": "ISO 8601 datetime",
    "isArbiter": "boolean"
  }
}
```

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |
| 404    | Listing not found (invalid ID) |

### Esempio curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3000/api/listings/42 \
  -H "Authorization: Bearer $TOKEN"
```

---

## Listing Workflow

1. **Seller Creates Listing**:
   - POST `/api/listings` with name, price, and signature
   - Seller is identified from Bearer token

2. **Buyers Browse**:
   - GET `/api/listings` to see all listings except their own
   - GET `/api/listings/:id` for details

3. **Buyer Initiates Chat**:
   - POST `/api/chats/:listingId` to open a negotiation chat with the seller
   - Seller receives notifications via WebSocket

---

## Notes

- Listings are permanent (no delete endpoint provided)
- All prices are in satoshi (1 BTC = 100,000,000 satoshi)
- Dust fee is set by the Ark provider and varies with network conditions
- Seller identification is automatic (extracted from Bearer token pubkey claim)
- Listings do not track inventory or availability — assume infinite stock unless managed at the application layer
