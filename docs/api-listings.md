# Listings Endpoints

Listings represent products for sale on the marketplace. Sellers create listings with a name and price; buyers browse and initiate purchase negotiations through chats.

## Autenticazione

All endpoints in this group require a valid Bearer token (obtained from `/api/auth/login`).

---

## `POST /api/listings`

Create a new listing. Requires Schnorr signature over the listing data. Optionally assign attributes that apply to the listing's category.

**Autenticazione:** Bearer token + Schnorr signature
**Seller pubkey:** Extracted from Bearer token
**Price range:** Must be greater than the Ark provider's dust fee

### Request

```json
{
  "name": "string — listing title (minimum 3 characters)",
  "price": "number — price in satoshi (must exceed dust fee)",
  "description": "string (optional) — listing description (minimum 12 characters)",
  "categoryId": "number (optional) — ID of the category this listing belongs to",
  "attributes": [
    {
      "attributeId": "number — ID of the attribute",
      "valueId": "number (optional) — ID of the attribute value (required for select attributes)",
      "valueBool": "boolean (optional) — boolean value (required for boolean attributes)"
    }
  ] (optional) — array of attribute assignments",
  "signature": "string — hex-encoded Schnorr signature over {name, price, [description], [categoryId], [attributes]}"
}
```

The signature must be a valid Schnorr signature over the JSON-serialized request body (excluding the signature field itself) with keys sorted alphabetically. This proves the seller approves this listing creation. The `categoryId` field is optional; if provided, it must reference an existing category. If `attributes` is provided, `categoryId` must also be provided. All required attributes for the category must be included. For select attributes, provide `valueId`; for boolean attributes, provide `valueBool`.

### Response (201)

```json
{
  "id": "number — unique listing ID",
  "name": "string — listing name",
  "price": "number — price in satoshi",
  "description": "string | null — listing description",
  "sellerPubkey": "string — hex-encoded public key of seller",
  "signature": "string — the signature provided in the request",
  "createdAt": "ISO 8601 datetime — when listing was created",
  "categoryId": "number | null — ID of the assigned category (null if not set)",
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
  },
  "attributes": [
    {
      "attributeId": "number",
      "attribute": {
        "id": "number",
        "name": "string",
        "slug": "string",
        "type": "enum ('select' | 'boolean')"
      },
      "value": {
        "id": "number | null",
        "value": "string | null"
      } | null,
      "valueBool": "boolean | null"
    }
  ]
}
```

### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Price is less than or equal to Ark provider's dust fee |
| 400    | `categoryId` is required when attributes are provided |
| 400    | Attribute not found or not valid for this category |
| 400    | Required attribute is missing |
| 400    | Attribute type mismatch (select attribute without valueId, boolean without valueBool, etc.) |
| 400    | Invalid JSON schema (missing or wrong type for name, price, signature, categoryId, attributes) |
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

# With category (categoryId=2 for Electronics)
curl -X POST http://localhost:3000/api/listings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "iPhone 15 Pro",
    "price": 15000,
    "categoryId": 2,
    "signature": "'$SIGNATURE'"
  }'

# With category and attributes
curl -X POST http://localhost:3000/api/listings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "iPhone 15 Pro",
    "price": 15000,
    "description": "Brand new iPhone 15 Pro Max in mint condition.",
    "categoryId": 2,
    "attributes": [
      { "attributeId": 1, "valueId": 20 },
      { "attributeId": 3, "valueId": 11 },
      { "attributeId": 2, "valueBool": true }
    ],
    "signature": "'$SIGNATURE'"
  }'
```

---

## `PATCH /api/listings/:id`

Update an existing listing. Requires Schnorr signature over the updated fields. Only the listing's seller can update it. Updating the category will reset all attributes; new attributes must be provided if needed.

**Authentication:** Bearer token + Schnorr signature
**Authorization:** Only the seller who created the listing can update it
**Price range:** If price is updated, must be greater than the Ark provider's dust fee

### Request

```json
{
  "name": "string (optional) — updated listing title (minimum 3 characters)",
  "price": "number (optional) — updated price in satoshi (must exceed dust fee)",
  "description": "string (optional) — updated listing description (minimum 12 characters)",
  "categoryId": "number | null (optional) — updated category ID or null to remove category",
  "attributes": [
    {
      "attributeId": "number — ID of the attribute",
      "valueId": "number (optional) — ID of the attribute value (required for select attributes)",
      "valueBool": "boolean (optional) — boolean value (required for boolean attributes)"
    }
  ] (optional) — array of updated attribute assignments",
  "signature": "string — hex-encoded Schnorr signature over the request body"
}
```

At least one field (other than signature) must be provided. The signature is computed over the fields being updated. If `attributes` is provided, `categoryId` must either be provided in the update or already set on the listing. When category or attributes are updated, old attributes are deleted and new ones are inserted.

### Response (200)

```json
{
  "id": "number — unique listing ID",
  "name": "string — listing name",
  "price": "number — price in satoshi",
  "description": "string | null — listing description",
  "sellerPubkey": "string — hex-encoded public key of seller",
  "signature": "string — the signature provided in the request",
  "createdAt": "ISO 8601 datetime — when listing was created",
  "categoryId": "number | null — ID of the assigned category (null if not set)",
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
  },
  "attributes": [
    {
      "attributeId": "number",
      "attribute": {
        "id": "number",
        "name": "string",
        "slug": "string",
        "type": "enum ('select' | 'boolean')"
      },
      "value": {
        "id": "number | null",
        "value": "string | null"
      } | null,
      "valueBool": "boolean | null"
    }
  ]
}
```

### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Price is less than or equal to Ark provider's dust fee (if price was updated) |
| 400    | `categoryId` is required when attributes are provided |
| 400    | Attribute not found or not valid for this category |
| 400    | Required attribute is missing |
| 400    | Attribute type mismatch (select attribute without valueId, boolean without valueBool, etc.) |
| 400    | Invalid JSON schema (wrong type for fields) |
| 401    | Missing or invalid Bearer token |
| 401    | Invalid signature — does not verify against the seller's pubkey |
| 403    | Listing belongs to a different seller (not authorized to update) |
| 404    | Listing not found |
| 404    | Category not found (if categoryId was provided but does not exist) |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Update listing name and price
curl -X PATCH http://localhost:3000/api/listings/42 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Updated Item Name",
    "price": 20000,
    "signature": "...",
  }'

# Update category and attributes
curl -X PATCH http://localhost:3000/api/listings/42 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "categoryId": 3,
    "attributes": [
      { "attributeId": 4, "valueId": 30 },
      { "attributeId": 5, "valueBool": false }
    ],
    "signature": "...",
  }'

# Remove category and attributes
curl -X PATCH http://localhost:3000/api/listings/42 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "categoryId": null,
    "signature": "...",
  }'
```

---

## `GET /api/listings`

List all active listings (excluding listings created by the authenticated user). Returns paginated results. Listings can be filtered by category and by attribute values.

**Authentication:** Bearer token
**Pagination:** limit (default 20, max 100) and offset (default 0)
**Filtering:** optional categoryId query parameter and attribute filters

### Request

Query parameters:

```
GET /api/listings?limit=20&offset=0&categoryId=2&attr_1=20&attr_3=11
```

- `limit`: Maximum number of listings to return (capped at 100, default 20)
- `offset`: Number of listings to skip for pagination (default 0)
- `categoryId`: (Optional) Category ID to filter listings by. If provided, only listings in that category are returned.
- `attr_<attributeId>=<valueId>`: (Optional) Filter by attribute values. For select attributes, provide the value ID. Multiple values for the same attribute are treated as OR (any match).
- `attr_<attributeId>=true|false`: (Optional) Filter by boolean attributes.

### Response (200)

```json
[
  {
    "id": "number — listing ID",
    "name": "string — listing name",
    "price": "number — price in satoshi",
    "description": "string | null — listing description",
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
    },
    "attributes": [
      {
        "attributeId": "number",
        "attribute": {
          "id": "number",
          "name": "string",
          "slug": "string",
          "type": "enum ('select' | 'boolean')"
        },
        "value": {
          "id": "number | null",
          "value": "string | null"
        } | null,
        "valueBool": "boolean | null"
      }
    ]
  }
]
```

Results are ordered by listing ID in descending order (newest first). Listings owned by the authenticated user are excluded. If `categoryId` is provided as a query parameter, results are filtered to only that category. Attribute filters are combined with AND logic (all filters must match a listing).

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

# Filter listings by attribute (e.g., Brand=Apple, id=20 for attribute 1)
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_1=20" \
  -H "Authorization: Bearer $TOKEN"

# Filter listings by multiple values for one attribute (OR logic)
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_1=20&attr_1=21" \
  -H "Authorization: Bearer $TOKEN"

# Filter listings by multiple attributes (AND logic)
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_1=20&attr_3=11" \
  -H "Authorization: Bearer $TOKEN"

# Filter listings by boolean attribute
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_2=true" \
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
    "description": "string | null — listing description",
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
    },
    "attributes": [
      {
        "attributeId": "number",
        "attribute": {
          "id": "number",
          "name": "string",
          "slug": "string",
          "type": "enum ('select' | 'boolean')"
        },
        "value": {
          "id": "number | null",
          "value": "string | null"
        } | null,
        "valueBool": "boolean | null"
      }
    ]
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
  "description": "string | null — listing description",
  "sellerPubkey": "string — hex-encoded seller pubkey",
  "signature": "string — creator signature",
  "createdAt": "ISO 8601 datetime",
  "categoryId": "number | null — category ID (null if not assigned)",
  "category": {
    "id": "number — category ID",
    "name": "string — category name",
    "slug": "string — category slug",
    "childrenOf": "number | null — parent category ID",
    "parent": {
      "id": "number | null — parent category ID (if category has a parent)"
    } | null
  } | null,
  "seller": {
    "pubkey": "string — seller's public key",
    "username": "string — seller's username",
    "createdAt": "ISO 8601 datetime",
    "isArbiter": "boolean"
  },
  "attributes": [
    {
      "attributeId": "number",
      "attribute": {
        "id": "number",
        "name": "string",
        "slug": "string",
        "type": "enum ('select' | 'boolean')"
      },
      "value": {
        "id": "number | null",
        "value": "string | null"
      } | null,
      "valueBool": "boolean | null"
    }
  ]
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
