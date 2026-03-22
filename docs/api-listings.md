# Listings Endpoints

Listings represent products for sale on the marketplace. Sellers create listings with a name and price; buyers browse and initiate purchase negotiations through chats.

## Authentication

All endpoints in this group require a valid Bearer token (obtained from `/api/auth/login`).

---

## `POST /api/listings`

Create a new listing. Requires Schnorr signature over the listing data. Optionally assign attributes that apply to the listing's category.

**Authentication:** Bearer token + Schnorr signature
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
      "valueId": "number (optional) — ID of predefined attribute value (for select attributes)",
      "valueBool": "boolean (optional) — boolean value (for boolean attributes)",
      "valueText": "string (optional) — text value (for text, range, or date attributes)",
      "valueIds": "array of numbers (optional) — array of value IDs (for multi_select attributes)"
    }
  ] (optional) — array of attribute assignments",
  "signature": "string — hex-encoded Schnorr signature over {name, price, [description], [categoryId], [attributes]}"
}
```

The signature must be a valid Schnorr signature over the JSON-serialized request body (excluding the signature field itself) with keys sorted alphabetically. This proves the seller approves this listing creation. The `categoryId` field is optional; if provided, it must reference an existing category. If `attributes` is provided, `categoryId` must also be provided. All required attributes for the category must be included.

**Attribute field mapping by type:**

| Type           | Required Field(s) | Description                                             |
| -------------- | ----------------- | ------------------------------------------------------- |
| `select`       | `valueId`         | Single predefined value ID                              |
| `boolean`      | `valueBool`       | `true` or `false`                                       |
| `text`         | `valueText`       | Free-form text (non-empty)                              |
| `range`        | `valueText`       | Numeric value as string (must be within min/max bounds) |
| `date`         | `valueText`       | ISO 8601 date string (YYYY-MM-DD)                       |
| `multi_select` | `valueIds`        | Array of predefined value IDs (at least one)            |

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
      "id": "number — listing attribute record ID",
      "attributeId": "number",
      "attribute": {
        "id": "number",
        "name": "string",
        "slug": "string",
        "type": "enum ('select' | 'boolean' | 'text' | 'range' | 'date' | 'multi_select')",
        "rangeMin": "number | null",
        "rangeMax": "number | null",
        "rangeStep": "number | null",
        "rangeUnit": "string | null"
      },
      "valueId": "number | null — for select attributes",
      "valueBool": "boolean | null — for boolean attributes",
      "valueText": "string | null — for text, range, date attributes",
      "valueFloat": "number | null — numeric value for range attributes",
      "value": {
        "id": "number | null",
        "value": "string | null"
      } | null,
      "multiValues": [
        {
          "id": "number",
          "value": {
            "id": "number",
            "value": "string"
          }
        }
      ]
    }
  ],
  "_count": {
    "favorites": "number — total count of users who have favorited this listing"
  }
}
```

### Errors

| Status | Description                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------- |
| 400    | Price is less than or equal to Ark provider's dust fee                                                              |
| 400    | `categoryId` is required when attributes are provided                                                               |
| 400    | Attribute not found or not valid for this category                                                                  |
| 400    | Required attribute is missing                                                                                       |
| 400    | Attribute type mismatch (select attribute without valueId, boolean without valueBool, text without valueText, etc.) |
| 400    | Duplicate attributeId in attributes array                                                                           |
| 400    | For select attribute: valueId must reference a valid value for this attribute                                       |
| 400    | For text attribute: valueText is required and cannot be empty                                                       |
| 400    | For range attribute: valueText must be numeric and within min/max bounds                                            |
| 400    | For date attribute: valueText must be in ISO 8601 format (YYYY-MM-DD)                                               |
| 400    | For multi_select attribute: valueIds must be a non-empty array of valid value IDs                                   |
| 400    | Invalid JSON schema (missing or wrong type for fields)                                                              |
| 401    | Missing or invalid Bearer token                                                                                     |
| 401    | Invalid signature — does not verify against the seller's pubkey                                                     |
| 404    | Category not found (if categoryId was provided but does not exist)                                                  |

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

# With category and mixed attribute types
curl -X POST http://localhost:3000/api/listings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "iPhone 15 Pro Max",
    "price": 15000,
    "description": "Brand new iPhone 15 Pro Max in mint condition.",
    "categoryId": 2,
    "attributes": [
      { "attributeId": 1, "valueId": 20 },
      { "attributeId": 2, "valueBool": true },
      { "attributeId": 3, "valueText": "Pristine, never opened" },
      { "attributeId": 5, "valueText": "0.22" },
      { "attributeId": 7, "valueIds": [10, 12] },
      { "attributeId": 8, "valueText": "2024-02-01" }
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
      "valueId": "number (optional) — ID of predefined attribute value (for select attributes)",
      "valueBool": "boolean (optional) — boolean value (for boolean attributes)",
      "valueText": "string (optional) — text value (for text, range, or date attributes)",
      "valueIds": "array of numbers (optional) — array of value IDs (for multi_select attributes)"
    }
  ] (optional) — array of updated attribute assignments",
  "signature": "string — hex-encoded Schnorr signature over the request body"
}
```

At least one field (other than signature) must be provided. The signature is computed over the fields being updated. If `attributes` is provided, `categoryId` must either be provided in the update or already set on the listing. When category or attributes are updated, old attributes are deleted and new ones are inserted.

**Same attribute field mapping as POST:**

| Type           | Required Field(s) |
| -------------- | ----------------- |
| `select`       | `valueId`         |
| `boolean`      | `valueBool`       |
| `text`         | `valueText`       |
| `range`        | `valueText`       |
| `date`         | `valueText`       |
| `multi_select` | `valueIds`        |

### Response (200)

Same as POST response above (with all new attribute types and fields included).

### Errors

| Status | Description                                                                                 |
| ------ | ------------------------------------------------------------------------------------------- |
| 400    | Price is less than or equal to Ark provider's dust fee (if price was updated)               |
| 400    | `categoryId` is required when attributes are provided                                       |
| 400    | Attribute not found or not valid for this category                                          |
| 400    | Required attribute is missing                                                               |
| 400    | Attribute type mismatch (select attribute without valueId, boolean without valueBool, etc.) |
| 400    | Duplicate attributeId in attributes array                                                   |
| 400    | For text attribute: valueText is required and cannot be empty                               |
| 400    | For range attribute: valueText must be numeric and within min/max bounds                    |
| 400    | For date attribute: valueText must be in ISO 8601 format (YYYY-MM-DD)                       |
| 400    | For multi_select attribute: valueIds must be a non-empty array of valid value IDs           |
| 400    | Invalid JSON schema (wrong type for fields)                                                 |
| 401    | Missing or invalid Bearer token                                                             |
| 401    | Invalid signature — does not verify against the seller's pubkey                             |
| 403    | Listing belongs to a different seller (not authorized to update)                            |
| 404    | Listing not found                                                                           |
| 404    | Category not found (if categoryId was provided but does not exist)                          |
| 409    | Cannot modify a listing with an active escrow                                               |

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

# Update category and attributes with mixed types
curl -X PATCH http://localhost:3000/api/listings/42 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "categoryId": 3,
    "attributes": [
      { "attributeId": 4, "valueId": 30 },
      { "attributeId": 5, "valueBool": false },
      { "attributeId": 6, "valueText": "Updated condition notes" },
      { "attributeId": 7, "valueText": "15.5" },
      { "attributeId": 8, "valueIds": [40, 42] }
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

List all active listings (excluding listings created by the authenticated user and listings with active escrows). Returns paginated results with photos included. Listings can be filtered by category and by attribute values.

**Authentication:** Bearer token
**Pagination:** limit (default 20, max 100) and offset (default 0)
**Filtering:** optional categoryId query parameter and attribute filters
**Exclusions:** Listings with active escrows are automatically filtered out

### Request

Query parameters:

```
GET /api/listings?limit=20&offset=0&categoryId=2&attr_1=20&attr_3=11
```

- `limit`: Maximum number of listings to return (capped at 100, default 20)
- `offset`: Number of listings to skip for pagination (default 0)
- `categoryId`: (Optional) Category ID to filter listings by. If provided, only listings in that category are returned.
- `minPrice`: (Optional) Minimum price in satoshi to filter listings
- `maxPrice`: (Optional) Maximum price in satoshi to filter listings
- `search`: (Optional) Search term to filter listings by name or description
- `sort`: (Optional) Sort order: `newest` (default), `oldest`, `price_asc`, `price_desc`
- `includeChildren`: (Optional) If `true` and `categoryId` is provided, includes listings from child categories
- `attr_<attributeId>=<valueId>`: (Optional) Filter by select/multi*select attribute values. For select attributes, provide the value ID. For multi_select, separate multiple values with `&attr*<id>=<value>`. Multiple values for the same attribute are treated as OR (any match).
- `attr_<attributeId>=true|false`: (Optional) Filter by boolean attributes.
- `attr_<attributeId>=<min>,<max>`: (Optional) Filter by range attributes. Provide min and max separated by comma. Can omit either side for unbounded range (e.g., `attr_5=10,` for min only, `attr_5=,100` for max only).

### Response (200)

```json
{
  "listings": [
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
          "id": "number — listing attribute record ID",
          "attributeId": "number",
          "attribute": {
            "id": "number",
            "name": "string",
            "slug": "string",
            "type": "enum ('select' | 'boolean' | 'text' | 'range' | 'date' | 'multi_select')"
          },
          "valueId": "number | null",
          "valueBool": "boolean | null",
          "valueText": "string | null",
          "valueFloat": "number | null",
          "value": {
            "id": "number | null",
            "value": "string | null"
          } | null,
          "multiValues": [
            {
              "id": "number",
              "value": {
                "id": "number",
                "value": "string"
              }
            }
          ]
        }
      ],
      "photos": [
        {
          "id": "number — unique photo ID",
          "filename": "string — MinIO object key (listings/<listing_id>/<timestamp>-<uuid>.<ext>)",
          "mimeType": "string — MIME type (e.g., 'image/jpeg')",
          "size": "number — file size in bytes",
          "position": "number — sort position (0-indexed)",
          "createdAt": "ISO 8601 datetime — when photo was uploaded",
          "url": "string — direct public URL for accessing the photo"
        }
      ],
      "_count": {
        "favorites": "number — total count of users who have favorited this listing"
      },
      "isFavorited": "boolean — whether the authenticated user has favorited this listing"
    }
  ],
  "total": "number — total count of matching listings"
}
```

Results are ordered by listing ID in descending order (newest first), or by the `sort` parameter if provided. Listings owned by the authenticated user are excluded. If `categoryId` is provided as a query parameter, results are filtered to only that category (or child categories if `includeChildren=true`). Attribute filters are combined with AND logic (all filters must match a listing). Search applies to both name and description fields. Price filters use inclusive range logic. The `isFavorited` flag indicates whether the authenticated user has favorited this listing.

### Errors

| Status | Description                                                                 |
| ------ | --------------------------------------------------------------------------- |
| 400    | Invalid limit (less than 1 or greater than 100)                             |
| 400    | Invalid offset (negative)                                                   |
| 400    | Invalid minPrice or maxPrice (negative or not numeric)                      |
| 400    | minPrice exceeds maxPrice                                                   |
| 400    | Invalid sort value (must be: `newest`, `oldest`, `price_asc`, `price_desc`) |
| 400    | categoryId is required when using attribute filters                         |
| 400    | Attribute is not filterable for this category                               |
| 401    | Missing or invalid Bearer token                                             |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Get first 20 listings
curl -X GET "http://localhost:3000/api/listings?limit=20&offset=0" \
  -H "Authorization: Bearer $TOKEN"

# Filter listings by category (e.g., Electronics category with id=2)
curl -X GET "http://localhost:3000/api/listings?categoryId=2&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Filter by price range
curl -X GET "http://localhost:3000/api/listings?minPrice=5000&maxPrice=50000&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Search and sort
curl -X GET "http://localhost:3000/api/listings?search=iPhone&sort=price_asc&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Filter listings by select attribute value
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_1=20" \
  -H "Authorization: Bearer $TOKEN"

# Filter by multiple values for one attribute (OR logic)
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_1=20&attr_1=21" \
  -H "Authorization: Bearer $TOKEN"

# Filter by multiple attributes (AND logic)
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_1=20&attr_2=true&attr_5=0.1,100" \
  -H "Authorization: Bearer $TOKEN"

# Filter by boolean attribute
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_2=true" \
  -H "Authorization: Bearer $TOKEN"

# Filter by range attribute with min and max
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_5=10,50" \
  -H "Authorization: Bearer $TOKEN"

# Filter by range attribute with only minimum
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_5=10," \
  -H "Authorization: Bearer $TOKEN"

# Filter by multi_select attribute
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_7=10&attr_7=12" \
  -H "Authorization: Bearer $TOKEN"

# Include child categories
curl -X GET "http://localhost:3000/api/listings?categoryId=1&includeChildren=true" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/listings/my-purchases`

List all listings where the authenticated user was the buyer and the transaction is completed.

**Authentication:** Bearer token

### Request

```
GET /api/listings/my-purchases
```

No query parameters.

### Response (200)

```json
{
  "listings": [
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
      "photos": [
        {
          "id": "number — unique photo ID",
          "filename": "string — MinIO object key (listings/<listing_id>/<timestamp>-<uuid>.<ext>)",
          "mimeType": "string — MIME type (e.g., 'image/jpeg')",
          "size": "number — file size in bytes",
          "position": "number — sort position (0-indexed)",
          "createdAt": "ISO 8601 datetime — when photo was uploaded",
          "url": "string — direct public URL for accessing the photo"
        }
      ],
      "attributes": [
        {
          "id": "number — listing attribute record ID",
          "attributeId": "number",
          "attribute": {
            "id": "number",
            "name": "string",
            "slug": "string",
            "type": "enum ('select' | 'boolean' | 'text' | 'range' | 'date' | 'multi_select')",
            "rangeMin": "number | null",
            "rangeMax": "number | null",
            "rangeStep": "number | null",
            "rangeUnit": "string | null"
          },
          "valueId": "number | null",
          "valueBool": "boolean | null",
          "valueText": "string | null",
          "valueFloat": "number | null",
          "value": {
            "id": "number | null",
            "value": "string | null"
          } | null,
          "multiValues": [
            {
              "id": "number",
              "value": {
                "id": "number",
                "value": "string"
              }
            }
          ]
        }
      ],
      "_count": {
        "favorites": "number — total count of users who have favorited this listing"
      }
    }
  ],
  "total": "number — total count of purchased listings"
}
```

### Errors

| Status | Description                     |
| ------ | ------------------------------- |
| 401    | Missing or invalid Bearer token |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3000/api/listings/my-purchases \
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
{
  "listings": [
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
      "photos": [
        {
          "id": "number — unique photo ID",
          "filename": "string — MinIO object key (listings/<listing_id>/<timestamp>-<uuid>.<ext>)",
          "mimeType": "string — MIME type (e.g., 'image/jpeg')",
          "size": "number — file size in bytes",
          "position": "number — sort position (0-indexed)",
          "createdAt": "ISO 8601 datetime — when photo was uploaded",
          "url": "string — direct public URL for accessing the photo"
        }
      ],
      "attributes": [
        {
          "id": "number — listing attribute record ID",
          "attributeId": "number",
          "attribute": {
            "id": "number",
            "name": "string",
            "slug": "string",
            "type": "enum ('select' | 'boolean' | 'text' | 'range' | 'date' | 'multi_select')",
            "rangeMin": "number | null",
            "rangeMax": "number | null",
            "rangeStep": "number | null",
            "rangeUnit": "string | null"
          },
          "valueId": "number | null",
          "valueBool": "boolean | null",
          "valueText": "string | null",
          "valueFloat": "number | null",
          "value": {
            "id": "number | null",
            "value": "string | null"
          } | null,
          "multiValues": [
            {
              "id": "number",
              "value": {
                "id": "number",
                "value": "string"
              }
            }
          ]
        }
      ],
      "_count": {
        "favorites": "number — total count of users who have favorited this listing"
      }
    }
  ],
  "total": "number — total count of user's listings"
}
```

Includes seller details and favorite counts. Results are unordered (returned as-is from database).

### Errors

| Status | Description                     |
| ------ | ------------------------------- |
| 401    | Missing or invalid Bearer token |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3000/api/listings/my-listings \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/listings/:id`

Get details of a specific listing by ID, including favorite information, photos, and all attributes. Returns 404 if the listing has an active escrow and the user is neither the seller nor the buyer.

**Authentication:** Bearer token
**Authorization:** If listing has an active escrow, only the seller and buyer can view it

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
  "photos": [
    {
      "id": "number — unique photo ID",
      "filename": "string — filename with extension",
      "mimeType": "string — MIME type (e.g., 'image/jpeg')",
      "size": "number — file size in bytes",
      "position": "number — sort position (0-indexed)",
      "createdAt": "ISO 8601 datetime — when photo was uploaded"
    }
  ],
  "chats": [
    {
      "id": "number — chat ID",
      "listingId": "number",
      "buyerPubkey": "string",
      "arbiterPubkey": "string | null",
      "signature": "string",
      "status": "string",
      "createdAt": "ISO 8601 datetime",
      "escrow": {
        "status": "string"
      } | null
    }
  ],
  "attributes": [
    {
      "id": "number — listing attribute record ID",
      "attributeId": "number",
      "attribute": {
        "id": "number",
        "name": "string",
        "slug": "string",
        "type": "enum ('select' | 'boolean' | 'text' | 'range' | 'date' | 'multi_select')",
        "rangeMin": "number | null",
        "rangeMax": "number | null",
        "rangeStep": "number | null",
        "rangeUnit": "string | null"
      },
      "valueId": "number | null",
      "valueBool": "boolean | null",
      "valueText": "string | null",
      "valueFloat": "number | null",
      "value": {
        "id": "number | null",
        "value": "string | null"
      } | null,
      "multiValues": [
        {
          "id": "number",
          "value": {
            "id": "number",
            "value": "string"
          }
        }
      ]
    }
  ],
  "_count": {
    "favorites": "number — total count of users who have favorited this listing"
  },
  "isFavorited": "boolean — whether the authenticated user has favorited this listing"
}
```

### Errors

| Status | Description                                                                      |
| ------ | -------------------------------------------------------------------------------- |
| 401    | Missing or invalid Bearer token                                                  |
| 404    | Listing not found (invalid ID or has active escrow and user is not seller/buyer) |

### Example curl

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
