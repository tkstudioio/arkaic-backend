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
  "categoryId": "number (optional) — ID of the category this listing belongs to",
  "signature": "string — hex-encoded Schnorr signature over {name, price, [categoryId]}"
}
```

The signature must be a valid Schnorr signature over the JSON-serialized request body (excluding the signature field itself) with keys sorted alphabetically. This proves the seller approves this listing creation. The `categoryId` field is optional; if provided, it must reference an existing category.

### Response (200)

```json
{
  "id": "number — unique listing ID",
  "name": "string — listing name",
  "price": "number — price in satoshi",
  "sellerPubkey": "string — hex-encoded public key of seller",
  "signature": "string — the signature provided in the request",
  "createdAt": "ISO 8601 datetime — when listing was created",
  "categoryId": "number | null — ID of the assigned category (null if not set)",
  "category": {
    "id": "number — category ID",
    "name": "string — category name",
    "slug": "string — category slug",
    "childrenOf": "number | null — parent category ID"
  } | null
}
```

### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Price is less than or equal to Ark provider's dust fee |
| 400    | Invalid JSON schema (missing or wrong type for name, price, signature, categoryId) |
| 401    | Missing or invalid Bearer token |
| 401    | Invalid signature — does not verify against the seller's pubkey |
| 404    | Category not found (if categoryId was provided but does not exist) |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
PUBKEY="02abcd..."

# Create signature over sorted {"categoryId": 1, "name": "...", "price": ...}
# (Note: only include categoryId in signature if it's present in the request)
SIGNATURE="deadbeef..."

# Without category
curl -X POST http://localhost:3000/api/listings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Bitcoin Hardware Wallet",
    "price": 5000,
    "signature": "'$SIGNATURE'"
  }'

# With category (categoryId=1 for Electronics)
curl -X POST http://localhost:3000/api/listings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "iPhone 15 Pro",
    "price": 15000,
    "categoryId": 1,
    "signature": "'$SIGNATURE'"
  }'
```

---

## `GET /api/listings`

List all active listings (excluding listings created by the authenticated user). Returns paginated results. Listings can be filtered by category.

**Authentication:** Bearer token
**Pagination:** limit (default 20, max 100) and offset (default 0)
**Category filtering:** optional categoryId query parameter

### Request

Query parameters:

```
GET /api/listings?limit=20&offset=0&categoryId=1
```

- `limit`: Maximum number of listings to return (capped at 100, default 20)
- `offset`: Number of listings to skip for pagination (default 0)
- `categoryId`: (Optional) Category ID to filter listings by. If provided, only listings in that category are returned.

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
    "categoryId": "number | null — category ID (null if not assigned)",
    "category": {
      "id": "number — category ID",
      "name": "string — category name",
      "slug": "string — category slug",
      "childrenOf": "number | null — parent category ID"
    } | null,
    "seller": {
      "pubkey": "string — seller's public key",
      "username": "string — seller's username",
      "createdAt": "ISO 8601 datetime",
      "isArbiter": "boolean"
    }
  }
]
```

Results are ordered by listing ID in descending order (newest first). Listings owned by the authenticated user are excluded. If `categoryId` is provided as a query parameter, results are filtered to only that category.

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Get first 20 listings
curl -X GET "http://localhost:3000/api/listings?limit=20&offset=0" \
  -H "Authorization: Bearer $TOKEN"

# Get next 20 listings
curl -X GET "http://localhost:3000/api/listings?limit=20&offset=20" \
  -H "Authorization: Bearer $TOKEN"

# Filter listings by category (e.g., Electronics category with id=2)
curl -X GET "http://localhost:3000/api/listings?limit=20&offset=0&categoryId=2" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/listings/my-listings`

List all active listings created by the authenticated user.

**Authentication:** Bearer token

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
    "categoryId": "number | null — category ID (null if not assigned)",
    "category": {
      "id": "number — category ID",
      "name": "string — category name",
      "slug": "string — category slug",
      "childrenOf": "number | null — parent category ID"
    } | null,
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

### Errors

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

**Authentication:** Bearer token

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
  "categoryId": "number | null — category ID (null if not assigned)",
  "category": {
    "id": "number — category ID",
    "name": "string — category name",
    "slug": "string — category slug",
    "childrenOf": "number | null — parent category ID"
  } | null,
  "seller": {
    "pubkey": "string — seller's public key",
    "username": "string — seller's username",
    "createdAt": "ISO 8601 datetime",
    "isArbiter": "boolean"
  }
}
```

### Errors

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
