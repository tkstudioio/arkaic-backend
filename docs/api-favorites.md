# Favorites Endpoints

Favorites allow authenticated users to bookmark listings for later reference. Each user can favorite any listing (except their own), and favorite status is tracked per user-listing pair.

## Authentication

All endpoints in this group require a valid Bearer token (obtained from `/api/auth/login`). Users can only view and modify their own favorites.

---

## `GET /api/favorites`

Get a paginated list of all listings favorited by the authenticated user, ordered by most recent favorite first.

**Authentication:** Bearer token
**Pagination:** limit (default 20, max 100) and offset (default 0)

### Request

Query parameters:

```
GET /api/favorites?limit=20&offset=0
```

- `limit`: Maximum number of favorite listings to return (capped at 100, default 20)
- `offset`: Number of results to skip for pagination (default 0)

### Response (200)

```json
{
  "favorites": [
    {
      "id": "number — favorite record ID",
      "accountPubkey": "string — hex-encoded pubkey of user who favorited",
      "listingId": "number — ID of the favorited listing",
      "createdAt": "ISO 8601 datetime — when listing was added to favorites",
      "listing": {
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
        ]
      }
    }
  ],
  "total": "number — total count of user's favorited listings"
}
```

Favorites are ordered by `createdAt` in descending order (most recent first). Each favorite includes the full listing object with all attributes.

### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid limit (less than 1 or greater than 100) |
| 400    | Invalid offset (negative) |
| 401    | Missing or invalid Bearer token |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Get first 20 favorited listings
curl -X GET "http://localhost:3000/api/favorites?limit=20&offset=0" \
  -H "Authorization: Bearer $TOKEN"

# Get next page (offset by 20)
curl -X GET "http://localhost:3000/api/favorites?limit=20&offset=20" \
  -H "Authorization: Bearer $TOKEN"

# Get all favorites (in one request if total < 100)
curl -X GET "http://localhost:3000/api/favorites?limit=100" \
  -H "Authorization: Bearer $TOKEN"
```

---

## `POST /api/favorites/:listingId`

Add a listing to the authenticated user's favorites. If the listing is already favorited by this user, the operation is idempotent (succeeds and returns the existing favorite record).

**Authentication:** Bearer token
**Idempotent:** Returns 201 on both creation and subsequent requests for the same listing

### Request

```
POST /api/favorites/42
```

Path parameters:

- `listingId`: ID of the listing to favorite (numeric)

No request body required.

### Response (201)

```json
{
  "id": "number — favorite record ID",
  "accountPubkey": "string — hex-encoded pubkey of user",
  "listingId": "number — ID of the favorited listing",
  "createdAt": "ISO 8601 datetime — when listing was added to favorites"
}
```

### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid listingId (not numeric) |
| 400    | Cannot favorite your own listing — listing seller is the authenticated user |
| 401    | Missing or invalid Bearer token |
| 404    | Listing not found |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Add listing 42 to favorites
curl -X POST http://localhost:3000/api/favorites/42 \
  -H "Authorization: Bearer $TOKEN"

# Adding again returns same favorite (idempotent)
curl -X POST http://localhost:3000/api/favorites/42 \
  -H "Authorization: Bearer $TOKEN"
```

---

## `DELETE /api/favorites/:listingId`

Remove a listing from the authenticated user's favorites.

**Authentication:** Bearer token
**Idempotent:** Returns 200 even if the listing was not in the user's favorites

### Request

```
DELETE /api/favorites/42
```

Path parameters:

- `listingId`: ID of the listing to remove from favorites (numeric)

No request body required.

### Response (200)

```json
{
  "deleted": true
}
```

### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid listingId (not numeric) |
| 401    | Missing or invalid Bearer token |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Remove listing 42 from favorites
curl -X DELETE http://localhost:3000/api/favorites/42 \
  -H "Authorization: Bearer $TOKEN"

# Removing again succeeds (idempotent)
curl -X DELETE http://localhost:3000/api/favorites/42 \
  -H "Authorization: Bearer $TOKEN"
```

---

## Favorites Workflow

### Add to Favorites

1. **User Views Listing**:
   - GET `/api/listings/:id` shows listing details

2. **User Favorites the Listing**:
   - POST `/api/favorites/:listingId`
   - Success returns favorite record with 201 status

3. **Frontend Updates UI**:
   - Shows "favorite" button as active/toggled
   - Increments favorite count if displayed

### View Favorites

1. **User Views Favorites List**:
   - GET `/api/favorites?limit=20&offset=0`
   - Returns paginated list of all favorited listings

2. **User Removes Favorite**:
   - DELETE `/api/favorites/:listingId`
   - Frontend toggles favorite button and updates list

### Integration with Listing Endpoints

When browsing listings via `GET /api/listings` or `GET /api/listings/:id`, each listing includes:

- `_count.favorites`: Total number of users who have favorited this listing
- `isFavorited`: Boolean flag indicating whether the authenticated user has favorited this listing

These fields enable the frontend to:
- Show total favorite count on listing cards/details
- Display favorite button state (favorited or not)
- Update UI after favorite/unfavorite actions

---

## Notes

- Users cannot favorite their own listings (returns 400 error)
- A user can only have one favorite record per listing
- Removing a favorite is idempotent — removing a non-favorited listing succeeds with no error
- Adding a favorite is idempotent — adding an already-favorited listing returns the existing record
- Favorites are tied to user account and are not affected by listing changes
- When a listing is deleted, all its favorite records are automatically deleted (cascade delete)
- The `_count.favorites` field on listings reflects the total count across all users
