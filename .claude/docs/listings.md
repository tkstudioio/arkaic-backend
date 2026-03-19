# Listings (Products) Documentation

> **Audience**: Frontend developers, API consumers

## Overview

Listings are products on the marketplace. The backend provides full CRUD support with filtering, categories, and dynamic attributes (range, select, multi-select, boolean, text, date).

---

## Key Endpoints

### List Products
```
GET /api/listings
```

**Query Parameters:**
- `limit` (default: 20, max: 100) — Items per page
- `offset` (default: 0) — Pagination offset
- `categoryId` (optional) — Filter by category
- `includeChildren` (optional: "true") — Include listings from subcategories
- `minPrice`, `maxPrice` (optional) — Price range
- `search` (optional) — Search name/description
- `sort` (optional: "price_asc", "price_desc", "newest", "oldest") — Sort order
- `attr_<id>=value` — Filter by attribute (see below)

**Authentication:** Bearer JWT required

**Response:**
```json
{
  "listings": [
    {
      "id": 1,
      "name": "Product Name",
      "price": 50000,
      "description": "...",
      "categoryId": 2,
      "sellerPubkey": "...",
      "category": {
        "id": 2,
        "name": "Vehicles",
        "slug": "vehicles"
      },
      "attributes": [
        {
          "attribute": { "id": 1, "name": "Year", "type": "range" },
          "valueFloat": 2022,
          "valueText": "2022"
        }
      ]
    }
  ],
  "total": 42
}
```

### Get Single Product
```
GET /api/listings/:id
```

**Response:** Full listing object including seller info, category with parent, and all attributes.

### Get My Listings (Seller)
```
GET /api/listings/my-listings
```

**Response:** Array of listings owned by authenticated user.

---

## Filtering by Attributes

Attributes enable dynamic filtering. Pass them as query parameters with the pattern `attr_<attributeId>=value`.

**Format by attribute type:**

| Type | Format | Example |
|------|--------|---------|
| `select` | `attr_1=valueId` | `attr_1=5` (single value) |
| `multi_select` | `attr_1=valueId&attr_1=valueId` | `attr_1=5&attr_1=6` (multiple values) |
| `boolean` | `attr_1=true` or `attr_1=false` | `attr_1=true` |
| `range` | `attr_1=min,max` | `attr_1=1000,5000` |
| `text` | Not filterable | — |
| `date` | Not filterable | — |

**Example:**
```
GET /api/listings?categoryId=2&attr_1=5&attr_2=true&attr_3=1000,5000
```

### Get Available Filters for a Category
```
GET /api/attributes/filters/:categoryId
```

Returns filterable attributes and their distinct values used in listings of that category.

**Response:**
```json
[
  {
    "id": 1,
    "name": "Year",
    "type": "range",
    "rangeMin": 2000,
    "rangeMax": 2024,
    "rangeStep": 1,
    "rangeUnit": "year"
  },
  {
    "id": 2,
    "name": "Color",
    "type": "select",
    "values": [
      { "id": 5, "value": "Red" },
      { "id": 6, "value": "Blue" }
    ]
  }
]
```

---

## Creating/Updating Products

### Create Listing
```
POST /api/listings
Content-Type: application/json
Authorization: Bearer <JWT>
X-Signature: <schnorr-signature>
```

**Body:**
```json
{
  "name": "2020 Tesla Model 3",
  "price": 300000,
  "description": "Excellent condition, full autopilot",
  "categoryId": 2,
  "attributes": [
    { "attributeId": 1, "valueText": "2020" },
    { "attributeId": 2, "valueId": 5 },
    { "attributeId": 3, "valueBool": true },
    { "attributeId": 4, "valueIds": [10, 11] }
  ]
}
```

**Requirements:**
- `name` (min 3 chars), `price` (>= dust fee)
- `categoryId` required if attributes are included
- Attributes must match category configuration
- Multi-select attributes use `valueIds` (array)

### Update Listing
```
PATCH /api/listings/:id
```

Same as create, but all fields optional. Listing must not have an active escrow.

---

## Category Structure

### Root Categories
```
GET /api/categories
```

Returns root categories with their children:
```json
[
  {
    "id": 1,
    "name": "Electronics",
    "slug": "electronics",
    "children": [
      { "id": 2, "name": "Phones", "slug": "phones", "childrenOf": 1 }
    ]
  }
]
```

### Category with Attributes
```
GET /api/categories/:slug
```

Returns category with all linked attributes:
```json
{
  "id": 2,
  "name": "Vehicles",
  "slug": "vehicles",
  "categoryAttributes": [
    {
      "attributeId": 1,
      "required": true,
      "isFilterable": true,
      "attribute": {
        "id": 1,
        "name": "Year",
        "type": "range",
        "rangeMin": 2000,
        "rangeMax": 2024
      }
    }
  ]
}
```

---

## Example Flow

**1. Get categories:**
```
GET /api/categories
→ Find "Vehicles" category (id: 2)
```

**2. Browse filters for Vehicles:**
```
GET /api/attributes/filters/2
→ Get year range (2000-2024), color select, etc.
```

**3. List vehicles with filters:**
```
GET /api/listings?categoryId=2&includeChildren=true&attr_1=2020,2023&attr_2=5&sort=price_asc
→ Get all vehicles (+ subcategories) from 2020-2023 in red color, sorted by price
```

**4. Get product details:**
```
GET /api/listings/42
→ Full product info with seller and all attributes
```

---

## Authentication

All listing endpoints require Bearer JWT token in `Authorization` header:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

Create endpoints also require Schnorr signature (`X-Signature` header) on the request body fields (ordered JSON).

---

## Notes

- **Price is in sats** (satoshis, Bitcoin's smallest unit)
- **Sellers cannot see their own listings** in GET /api/listings
- **Escrow prevents modification** — once a buyer initiates escrow, the listing is locked
- **Multi-select attributes** allow multiple values per product (e.g., vehicle features)
- **Range attributes** support numeric filtering with min/max bounds
