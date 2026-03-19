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
    "type": "enum ('select' | 'boolean' | 'text' | 'range' | 'date' | 'multi_select') — attribute type",
    "values": [
      {
        "id": "number — attribute value ID",
        "value": "string — value label (for select and multi_select attributes)"
      }
    ] | null,
    "rangeMin": "number | null — minimum allowed value (for range attributes)",
    "rangeMax": "number | null — maximum allowed value (for range attributes)",
    "rangeStep": "number | null — incremental step for range (for range attributes)",
    "rangeUnit": "string | null — unit of measurement (e.g., 'kg', 'cm') (for range attributes)"
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
    ],
    "rangeMin": null,
    "rangeMax": null,
    "rangeStep": null,
    "rangeUnit": null
  },
  {
    "id": 2,
    "name": "New",
    "slug": "is_new",
    "type": "boolean",
    "values": [],
    "rangeMin": null,
    "rangeMax": null,
    "rangeStep": null,
    "rangeUnit": null
  },
  {
    "id": 3,
    "name": "Weight",
    "slug": "weight",
    "type": "range",
    "values": null,
    "rangeMin": 0.1,
    "rangeMax": 100,
    "rangeStep": 0.1,
    "rangeUnit": "kg"
  },
  {
    "id": 4,
    "name": "Model Description",
    "slug": "model_description",
    "type": "text",
    "values": null,
    "rangeMin": null,
    "rangeMax": null,
    "rangeStep": null,
    "rangeUnit": null
  }
]
```

Attributes are ordered by ID in ascending order. For `select` and `multi_select` type attributes, the `values` array contains predefined value options. For other types (`boolean`, `text`, `range`, `date`), `values` is null or an empty array. For `range` type attributes, `rangeMin`, `rangeMax`, `rangeStep`, and `rangeUnit` provide metadata about the range constraints.

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
    "type": "enum ('select' | 'boolean' | 'text' | 'range' | 'date' | 'multi_select') — attribute type",
    "required": "boolean — whether this attribute is required when creating/updating listings in this category",
    "isFilterable": "boolean — whether this attribute is available for filtering",
    "values": [
      {
        "id": "number — attribute value ID",
        "value": "string — value label"
      }
    ] | null,
    "rangeMin": "number | null — minimum allowed value (for range attributes)",
    "rangeMax": "number | null — maximum allowed value (for range attributes)",
    "rangeStep": "number | null — incremental step for range (for range attributes)",
    "rangeUnit": "string | null — unit of measurement (for range attributes)"
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
    ],
    "rangeMin": null,
    "rangeMax": null,
    "rangeStep": null,
    "rangeUnit": null
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
    ],
    "rangeMin": null,
    "rangeMax": null,
    "rangeStep": null,
    "rangeUnit": null
  },
  {
    "attributeId": 5,
    "name": "Weight",
    "slug": "weight",
    "type": "range",
    "required": false,
    "isFilterable": true,
    "values": null,
    "rangeMin": 0.1,
    "rangeMax": 100,
    "rangeStep": 0.1,
    "rangeUnit": "kg"
  },
  {
    "attributeId": 6,
    "name": "Condition",
    "slug": "condition",
    "type": "text",
    "required": false,
    "isFilterable": false,
    "values": null,
    "rangeMin": null,
    "rangeMax": null,
    "rangeStep": null,
    "rangeUnit": null
  }
]
```

Results are ordered by attribute name in ascending order. For `select` and `multi_select` attributes, `values` contains predefined options. For range attributes, metadata fields provide constraints.

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
    "type": "enum ('select' | 'boolean' | 'text' | 'range' | 'date' | 'multi_select') — attribute type",
    "values": [
      {
        "id": "number — attribute value ID",
        "value": "string — value label"
      }
    ] | null,
    "rangeMin": "number | null — minimum range (for range attributes only)",
    "rangeMax": "number | null — maximum range (for range attributes only)",
    "rangeStep": "number | null — step size (for range attributes only)",
    "rangeUnit": "string | null — unit label (for range attributes only)"
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
  },
  {
    "attributeId": 5,
    "name": "Weight",
    "slug": "weight",
    "type": "range",
    "values": null,
    "rangeMin": 0.1,
    "rangeMax": 100,
    "rangeStep": 0.1,
    "rangeUnit": "kg"
  },
  {
    "attributeId": 7,
    "name": "Colors Available",
    "slug": "colors_available",
    "type": "multi_select",
    "values": [
      { "id": 10, "value": "Red" },
      { "id": 11, "value": "Blue" },
      { "id": 12, "value": "Green" }
    ]
  }
]
```

For `select` and `multi_select` type attributes, only values that have been assigned to at least one listing in this category are included. For `boolean` type attributes, `values` is always `null`, and the attribute is only included if at least one listing in the category has that attribute set. For `range`, `text`, and `date` attributes, `values` is `null`; for range attributes, the `rangeMin`, `rangeMax`, `rangeStep`, and `rangeUnit` fields are populated. Attributes not marked as `isFilterable` in `CategoryAttribute` are excluded entirely.

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

Select attributes have a fixed set of predefined values. When assigning a select attribute to a listing, you must provide the `valueId` of one of those predefined values. Only one value can be selected.

Example: Color (Red, Blue, Green), Brand (Apple, Samsung, Google), Condition (New, Used, Refurbished), etc.

**When creating/updating a listing:**
```json
{ "attributeId": 1, "valueId": 20 }
```

### Boolean Attributes

Boolean attributes represent yes/no flags without predefined values. When assigning a boolean attribute to a listing, you set `valueBool` to `true` or `false`.

Example: "Is New", "Has Warranty", "Refurbished", "Fragile", etc.

**When creating/updating a listing:**
```json
{ "attributeId": 2, "valueBool": true }
```

### Text Attributes

Text attributes allow free-form text input. When assigning a text attribute to a listing, you provide a string value via `valueText`.

Example: "Model Description", "Serial Number", "Notes", "Color Description", etc.

**When creating/updating a listing:**
```json
{ "attributeId": 4, "valueText": "Mint condition, never used" }
```

**Validation:**
- `valueText` is required and cannot be empty (must contain at least one non-whitespace character)

### Range Attributes

Range attributes represent numeric values constrained by min/max bounds and an optional step size. When assigning a range attribute to a listing, you provide a numeric value (as string) via `valueText`. The value is also stored as `valueFloat` for efficient range filtering.

Example: Weight (0.1 - 100 kg, step 0.1), Height (10 - 300 cm, step 1), Battery Capacity (1000 - 5000 mAh), etc.

**Metadata provided by attribute definition:**
- `rangeMin`: minimum allowed value
- `rangeMax`: maximum allowed value
- `rangeStep`: incremental step (e.g., 0.1 for decimals, 1 for integers)
- `rangeUnit`: human-readable unit (e.g., "kg", "cm", "mAh")

**When creating/updating a listing:**
```json
{ "attributeId": 5, "valueText": "25.5" }
```

**Validation:**
- `valueText` must be a valid numeric value
- Value must be >= `rangeMin` (if set)
- Value must be <= `rangeMax` (if set)

### Date Attributes

Date attributes represent calendar dates in ISO 8601 format (YYYY-MM-DD). When assigning a date attribute to a listing, you provide a date string via `valueText`.

Example: "Manufacturing Date", "Expiration Date", "Warranty Expiry", etc.

**When creating/updating a listing:**
```json
{ "attributeId": 8, "valueText": "2024-03-19" }
```

**Validation:**
- `valueText` must match ISO 8601 date format: YYYY-MM-DD
- Date must be a valid calendar date

### Multi-Select Attributes

Multi-select attributes allow selecting multiple predefined values. When assigning a multi-select attribute to a listing, you provide an array of `valueIds` via `valueIds`.

Example: "Available Colors" (Red, Blue, Green, Black), "Certifications" (ISO 9001, ISO 27001, SOC 2), "Included Accessories", etc.

**When creating/updating a listing:**
```json
{ "attributeId": 7, "valueIds": [10, 11, 12] }
```

**Validation:**
- `valueIds` is required and must contain at least one value
- All values must be valid for the attribute
- Duplicate values are not allowed

---

## Using Attributes with Listings

### Creating a Listing with Attributes

For all attribute types, you must provide the exact values for the attribute type. See the schema for each attribute type in the section above.

```bash
curl -X POST http://localhost:3000/api/listings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "iPhone 15 Pro Max - Excellent Condition",
    "price": 50000,
    "categoryId": 2,
    "attributes": [
      { "attributeId": 1, "valueId": 20 },
      { "attributeId": 2, "valueBool": true },
      { "attributeId": 3, "valueText": "Pristine condition, no scratches" },
      { "attributeId": 5, "valueText": "0.22" },
      { "attributeId": 7, "valueIds": [10, 12] },
      { "attributeId": 8, "valueText": "2024-02-15" }
    ],
    "signature": "..."
  }'
```

Requirements:
- All required attributes for the category must be provided
- For `select` attributes: `valueId` must reference a valid value for that attribute
- For `boolean` attributes: `valueBool` must be a boolean
- For `text` attributes: `valueText` must be a non-empty string
- For `range` attributes: `valueText` must be a numeric value within the range bounds
- For `date` attributes: `valueText` must be a valid ISO 8601 date (YYYY-MM-DD)
- For `multi_select` attributes: `valueIds` must be an array of valid value IDs with at least one element
- Attribute values must belong to the chosen category

### Filtering Listings by Attributes

```bash
# Get listings with specific select attribute value
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_1=20" \
  -H "Authorization: Bearer $TOKEN"

# Get listings with multiple values for one attribute (OR logic)
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_1=20&attr_1=21" \
  -H "Authorization: Bearer $TOKEN"

# Get listings with boolean attribute set to true
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_2=true" \
  -H "Authorization: Bearer $TOKEN"

# Get listings by range attribute (min and max separated by comma)
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_5=0.1,50.5" \
  -H "Authorization: Bearer $TOKEN"

# Get listings with specific range (only minimum)
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_5=10," \
  -H "Authorization: Bearer $TOKEN"

# Get listings with specific range (only maximum)
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_5=,100" \
  -H "Authorization: Bearer $TOKEN"

# Filter by multiple attribute types combined
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_1=20&attr_2=true&attr_5=0.1,100" \
  -H "Authorization: Bearer $TOKEN"
```

**Attribute filter query parameter syntax:**

| Attribute Type | Parameter Format | Example |
| -------------- | --------------- | ------- |
| `select` | `attr_<id>=<valueId>` | `attr_1=20` |
| `multi_select` | `attr_<id>=<valueId>&attr_<id>=<valueId>` | `attr_7=10&attr_7=12` |
| `boolean` | `attr_<id>=true\|false` | `attr_2=true` |
| `range` | `attr_<id>=<min>,<max>` | `attr_5=0.1,100` |
| `text` | Not filterable | Cannot be used in query |
| `date` | Not filterable | Cannot be used in query |

**Filtering rules:**
- Multiple values for the same attribute are treated as OR (any value matches)
- Multiple different attributes must all match (AND logic)
- Attributes marked as non-filterable cannot be used in query parameters
- `categoryId` is required when using attribute filters
- Range filters require both min and max separated by a comma; omit either side for unbounded range

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
- Attribute values are predefined for `select` and `multi_select` attributes only
- `text`, `range`, and `date` attributes accept user-provided values
- For `range` attributes, values are stored both as text and as numeric `valueFloat` for efficient filtering
- `select` and `multi_select` attributes support filtering on listings
- `boolean` attributes support filtering on listings
- `range` attributes support range filtering on listings
- `text` and `date` attributes do not support listing filtering (though they can be displayed)

