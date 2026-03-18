# Categories Endpoints

Categories provide a hierarchical taxonomy for organizing listings on the marketplace. Categories are read-only and can be browsed to filter listings by product type.

## Authentication

All endpoints in this group require a valid Bearer token (obtained from `/api/auth/login`).

---

## `GET /api/categories`

List all root-level categories (top level of the hierarchy). Root categories have no parent (`childrenOf` is null).

**Authentication:** Bearer token

### Request

```
GET /api/categories
```

No query parameters.

### Response (200)

```json
[
  {
    "name": "string — category name",
    "slug": "string — unique url-friendly identifier",
    "childrenOf": null
  }
]
```

Example response:

```json
[
  {
    "name": "Clothing",
    "slug": "clothing",
    "childrenOf": null
  },
  {
    "name": "Electronics",
    "slug": "electronics",
    "childrenOf": null
  }
]
```

Results are ordered by category ID in ascending order.

### Errors

| Status | Description |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3000/api/categories \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/categories/:slug`

Get details of a specific category, list its direct children, and display the attributes that apply to this category. Categories form a tree structure where each category can have a parent and multiple children.

**Authentication:** Bearer token

### Request

```
GET /api/categories/clothing
```

Path parameters:

- `slug`: Category slug (unique identifier, url-friendly)

### Response (200)

```json
{
  "id": "number — category ID",
  "name": "string — category name",
  "slug": "string — unique identifier",
  "childrenOf": "number | null — parent category ID (null if root)",
  "children": [
    {
      "id": "number — child category ID",
      "name": "string — child category name",
      "slug": "string — child category slug",
      "childrenOf": "number — ID of this parent category"
    }
  ],
  "categoryAttributes": [
    {
      "id": "number — category attribute assignment ID",
      "categoryId": "number — category ID",
      "attributeId": "number — attribute ID",
      "required": "boolean — whether this attribute is required for listings in this category",
      "isFilterable": "boolean — whether this attribute can be used for filtering",
      "attribute": {
        "id": "number — attribute ID",
        "name": "string — attribute name",
        "slug": "string — attribute slug",
        "type": "enum ('select' | 'boolean') — attribute type",
        "values": [
          {
            "id": "number — attribute value ID",
            "value": "string — value label (for select attributes)"
          }
        ]
      }
    }
  ]
}
```

Example response for `GET /api/categories/electronics`:

```json
{
  "id": 2,
  "name": "Electronics",
  "slug": "electronics",
  "childrenOf": null,
  "children": [
    {
      "id": 5,
      "name": "Phones",
      "slug": "phones",
      "childrenOf": 2
    },
    {
      "id": 6,
      "name": "Laptops",
      "slug": "laptops",
      "childrenOf": 2
    }
  ],
  "categoryAttributes": [
    {
      "id": 10,
      "categoryId": 2,
      "attributeId": 1,
      "required": true,
      "isFilterable": true,
      "attribute": {
        "id": 1,
        "name": "Brand",
        "slug": "brand",
        "type": "select",
        "values": [
          { "id": 20, "value": "Apple" },
          { "id": 21, "value": "Samsung" },
          { "id": 22, "value": "Google" }
        ]
      }
    },
    {
      "id": 11,
      "categoryId": 2,
      "attributeId": 3,
      "required": false,
      "isFilterable": true,
      "attribute": {
        "id": 3,
        "name": "Color",
        "slug": "color",
        "type": "select",
        "values": [
          { "id": 10, "value": "Red" },
          { "id": 11, "value": "Blue" }
        ]
      }
    }
  ]
}
```

Children are ordered by category ID in ascending order. CategoryAttributes are ordered by attribute name in ascending order. For each category attribute, the full attribute definition with predefined values is included.

### Errors

| Status | Description |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |
| 404    | Category not found (invalid slug) |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Get root categories
curl -X GET http://localhost:3000/api/categories \
  -H "Authorization: Bearer $TOKEN"

# Get children of a category
curl -X GET http://localhost:3000/api/categories/clothing \
  -H "Authorization: Bearer $TOKEN"

# Get children of a sub-category
curl -X GET http://localhost:3000/api/categories/shoes \
  -H "Authorization: Bearer $TOKEN"
```

---

## Category Browsing Workflow

1. **List Root Categories**:
   - GET `/api/categories` to see top-level categories
   - Returns categories with `childrenOf: null`

2. **Browse Subcategories**:
   - GET `/api/categories/:slug` to see children of a category
   - Returns the parent category and its direct children

3. **Filter Listings by Category**:
   - GET `/api/listings?categoryId=<id>` to list products in a specific category
   - Use the category ID from the categories endpoints

---

## Default Category Taxonomy

The system comes with a default set of categories (seeded via `prisma seed`):

```
Clothing (slug: clothing, id: 1)
├── Shoes (slug: shoes, id: 3)
└── Bags (slug: bags, id: 4)

Electronics (slug: electronics, id: 2)
├── Phones (slug: phones, id: 5)
└── Laptops (slug: laptops, id: 6)
```

---

## Notes

- Categories are read-only through the API (no create, update, or delete endpoints)
- Categories form a tree structure with no depth limit, but typically 2-3 levels
- Slugs are unique and used for URL-friendly category identification
- A listing can optionally belong to one category via its `categoryId` field
- The `ListingCategory` join table is reserved for future multi-category support
- Category hierarchy is deterministic and stable (always ordered by ID)
