# Attributes Endpoints

Attributes provide a flexible system for defining product properties (like size, color, brand, or condition) that can be associated with categories and listings. The attributes API allows browsing all available attributes, discovering which attributes apply to a specific category, and building dynamic filters based on actual listing values.

## Authentication

All endpoints in this group require a valid Bearer token (obtained from `/api/auth/login`).

---

## `GET /api/attributes`

List all attributes in the system with their predefined values.

**Authentication:** Bearer token

### Request

```
GET /api/attributes
```

No query parameters.

### Response (200)

```json
[
  {
    "id": "number — unique attribute ID",
    "name": "string — human-readable attribute name",
    "slug": "string — unique url-friendly identifier",
    "type": "enum ('select' | 'boolean') — attribute type",
    "values": [
      {
        "id": "number — attribute value ID",
        "value": "string — value label (for select attributes)"
      }
    ]
  }
]
```

Example response:

```json
[
  {
    "id": 1,
    "name": "Color",
    "slug": "color",
    "type": "select",
    "values": [
      { "id": 10, "value": "Red" },
      { "id": 11, "value": "Blue" },
      { "id": 12, "value": "Green" }
    ]
  },
  {
    "id": 2,
    "name": "New",
    "slug": "is_new",
    "type": "boolean",
    "values": []
  }
]
```

Attributes are ordered by ID in ascending order. For `select` type attributes, the `values` array contains predefined value options. For `boolean` type attributes, `values` is an empty array.

### Errors

| Status | Description |
| ------ | ----------- |
| 401    | Missing or invalid Bearer token |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3000/api/attributes \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/attributes/by-category/:categoryId`

Get all attributes that apply to a specific category, along with their required and filterable flags.

**Authentication:** Bearer token

### Request

```
GET /api/attributes/by-category/2
```

Path parameters:

- `categoryId`: Category ID (numeric)

### Response (200)

```json
[
  {
    "attributeId": "number — unique attribute ID",
    "name": "string — human-readable attribute name",
    "slug": "string — unique url-friendly identifier",
    "type": "enum ('select' | 'boolean') — attribute type",
    "required": "boolean — whether this attribute is required when creating/updating listings in this category",
    "isFilterable": "boolean — whether this attribute is available for filtering",
    "values": [
      {
        "id": "number — attribute value ID",
        "value": "string — value label (for select attributes)"
      }
    ]
  }
]
```

Example response for Electronics category:

```json
[
  {
    "attributeId": 1,
    "name": "Brand",
    "slug": "brand",
    "type": "select",
    "required": true,
    "isFilterable": true,
    "values": [
      { "id": 20, "value": "Apple" },
      { "id": 21, "value": "Samsung" },
      { "id": 22, "value": "Google" }
    ]
  },
  {
    "attributeId": 3,
    "name": "Color",
    "slug": "color",
    "type": "select",
    "required": false,
    "isFilterable": true,
    "values": [
      { "id": 10, "value": "Red" },
      { "id": 11, "value": "Blue" }
    ]
  }
]
```

Results are ordered by attribute name in ascending order.

### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid categoryId (not a number) |
| 401    | Missing or invalid Bearer token |
| 404    | Category not found |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Get attributes for Electronics category (id=2)
curl -X GET http://localhost:3000/api/attributes/by-category/2 \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/attributes/filters/:categoryId`

Get filterable attributes for a category, including only those values that are actually used in listings of that category. This endpoint is optimized for building dynamic filter UI — it returns only select-type attributes with values, and boolean-type attributes if at least one listing has that attribute.

**Authentication:** Bearer token

### Request

```
GET /api/attributes/filters/2
```

Path parameters:

- `categoryId`: Category ID (numeric)

### Response (200)

```json
[
  {
    "attributeId": "number — unique attribute ID",
    "name": "string — human-readable attribute name",
    "slug": "string — unique url-friendly identifier",
    "type": "enum ('select' | 'boolean') — attribute type",
    "values": [
      {
        "id": "number — attribute value ID",
        "value": "string — value label"
      }
    ] | null
  }
]
```

Example response for Electronics category with filters:

```json
[
  {
    "attributeId": 1,
    "name": "Brand",
    "slug": "brand",
    "type": "select",
    "values": [
      { "id": 20, "value": "Apple" },
      { "id": 21, "value": "Samsung" }
    ]
  },
  {
    "attributeId": 2,
    "name": "New",
    "slug": "is_new",
    "type": "boolean",
    "values": null
  }
]
```

For `select` type attributes, only values that have been assigned to at least one listing in this category are included. For `boolean` type attributes, `values` is always `null`, and the attribute is only included if at least one listing in the category has that attribute set. Attributes not marked as `isFilterable` in `CategoryAttribute` are excluded entirely.

### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid categoryId (not a number) |
| 401    | Missing or invalid Bearer token |
| 404    | Category not found |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Get filterable attributes for Electronics category
curl -X GET http://localhost:3000/api/attributes/filters/2 \
  -H "Authorization: Bearer $TOKEN"
```

---

## Attribute Types

### Select Attributes

Select attributes have a fixed set of predefined values. When assigning a select attribute to a listing, you must provide the `valueId` of one of those predefined values. Example: Color (Red, Blue, Green), Brand (Apple, Samsung), etc.

### Boolean Attributes

Boolean attributes represent yes/no flags without predefined values. When assigning a boolean attribute to a listing, you set `valueBool` to `true` or `false`. Example: "Is New", "Has Warranty", "Refurbished", etc.

---

## Using Attributes with Listings

### Creating a Listing with Attributes

```bash
curl -X POST http://localhost:3000/api/listings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "iPhone 15 Pro Max",
    "price": 50000,
    "categoryId": 2,
    "attributes": [
      { "attributeId": 1, "valueId": 20 },
      { "attributeId": 3, "valueId": 11 },
      { "attributeId": 2, "valueBool": true }
    ],
    "signature": "...",
  }'
```

Requirements:
- All required attributes for the category must be provided
- For select attributes, `valueId` must reference a valid value for that attribute
- For boolean attributes, `valueBool` must be a boolean
- Attribute values must belong to the chosen category

### Filtering Listings by Attributes

```bash
# Get listings with specific attribute values
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_1=20&attr_3=11" \
  -H "Authorization: Bearer $TOKEN"

# Get listings with multiple values for one attribute (OR logic)
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_1=20&attr_1=21" \
  -H "Authorization: Bearer $TOKEN"

# Get listings with boolean attribute set to true
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_2=true" \
  -H "Authorization: Bearer $TOKEN"
```

Attribute filters use query parameters: `attr_<attributeId>=<valueId>` for select attributes, and `attr_<attributeId>=true|false` for boolean attributes. Multiple values for the same attribute are treated as OR (any match). Multiple different attributes must all match (AND).

---

## Attribute Browsing Workflow

1. **Discover All Attributes**:
   - GET `/api/attributes` to see all attributes in the system

2. **Get Category-Specific Attributes**:
   - GET `/api/attributes/by-category/<categoryId>` to see which attributes apply to a category and whether they are required

3. **Build Dynamic Filters**:
   - GET `/api/attributes/filters/<categoryId>` to get filterable attributes with actual values used in listings

4. **Create/Update Listings with Attributes**:
   - POST/PATCH `/api/listings` with the `attributes` array
   - Validate that all required attributes are provided
   - Use attribute values from the attribute endpoints

5. **Filter Listings by Attributes**:
   - GET `/api/listings?attr_<id>=<value>&attr_<id>=<value>` to find listings with specific attributes

---

## Notes

- Attributes are read-only through this API (no create, update, or delete endpoints)
- A category defines which attributes are available for listings in that category
- Required attributes must be provided when creating/updating a listing in a category
- Filterable attributes can be used to build filter UIs for buyers
- Attribute values are predefined per attribute and cannot be created dynamically
- Both select and boolean attributes support filtering on listings

