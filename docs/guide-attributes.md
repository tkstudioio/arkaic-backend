# Attributes System Guide

This guide provides a comprehensive overview of the attributes system, including all six attribute types, their storage patterns, validation rules, and usage examples.

## Overview

Attributes provide a flexible way to define product properties that can be associated with listings. The system supports six distinct types, each with different storage patterns and filtering capabilities. Attributes are organized hierarchically: they belong to categories (via `CategoryAttribute`), and listings can have attributes assigned (via `ListingAttribute`).

---

## Attribute Types

### Type 1: Select Attributes

**Purpose:** Single choice from a fixed set of predefined values.

**When to use:** Colors, brands, conditions, sizes, categories where only one choice is valid.

**Example:** A listing can have exactly one "Color" (Red, Blue, or Green), not multiple.

**Storage Pattern:**
```
ListingAttribute {
  valueId: 20              // Points to specific AttributeValue
  valueBool: null
  valueText: null
  valueFloat: null
  multiValues: []          // Not used
}
```

**API Request (POST/PATCH `/api/listings`):**
```json
{
  "attributeId": 1,
  "valueId": 20
}
```

**Validation:**
- `valueId` is required
- `valueId` must reference an existing `AttributeValue` that belongs to this attribute
- Only one value per listing (if you need multiple, use `multi_select`)
- No other value fields (`valueBool`, `valueText`, `valueIds`) should be present

**API Response (GET `/api/listings/:id`):**
```json
{
  "id": 1,
  "attributeId": 1,
  "attribute": {
    "id": 1,
    "name": "Color",
    "slug": "color",
    "type": "select",
    "rangeMin": null,
    "rangeMax": null,
    "rangeStep": null,
    "rangeUnit": null
  },
  "valueId": 20,
  "valueBool": null,
  "valueText": null,
  "valueFloat": null,
  "value": {
    "id": 20,
    "value": "Red"
  },
  "multiValues": []
}
```

**Filtering (GET `/api/listings`):**
```bash
# Single value
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_1=20"

# Multiple values (OR logic: match any)
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_1=20&attr_1=21"
```

---

### Type 2: Boolean Attributes

**Purpose:** Yes/no flags without predefined options.

**When to use:** "Is New", "Has Warranty", "Fragile", "Refurbished" — conditions that are either true or false.

**Example:** A listing either is new (true) or is not new (false), nothing in between.

**Storage Pattern:**
```
ListingAttribute {
  valueId: null
  valueBool: true          // true or false
  valueText: null
  valueFloat: null
  multiValues: []          // Not used
}
```

**API Request (POST/PATCH `/api/listings`):**
```json
{
  "attributeId": 2,
  "valueBool": true
}
```

**Validation:**
- `valueBool` is required and must be a boolean
- No other value fields (`valueId`, `valueText`, `valueIds`) should be present

**API Response (GET `/api/listings/:id`):**
```json
{
  "id": 2,
  "attributeId": 2,
  "attribute": {
    "id": 2,
    "name": "Is New",
    "slug": "is_new",
    "type": "boolean",
    "rangeMin": null,
    "rangeMax": null,
    "rangeStep": null,
    "rangeUnit": null
  },
  "valueId": null,
  "valueBool": true,
  "valueText": null,
  "valueFloat": null,
  "value": null,
  "multiValues": []
}
```

**Filtering (GET `/api/listings`):**
```bash
# Only listings where attribute is true
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_2=true"

# Only listings where attribute is false
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_2=false"
```

---

### Type 3: Text Attributes

**Purpose:** Free-form text input for arbitrary string values.

**When to use:** Serial numbers, model descriptions, condition notes, dimensions formatted as text.

**Example:** "Model Description" could be "512GB SSD variant", "Serial Number" could be "XYZ-12345-ABC".

**Storage Pattern:**
```
ListingAttribute {
  valueId: null
  valueBool: null
  valueText: "Mint condition, never opened"  // Free-form string
  valueFloat: null
  multiValues: []          // Not used
}
```

**API Request (POST/PATCH `/api/listings`):**
```json
{
  "attributeId": 4,
  "valueText": "Mint condition, never opened"
}
```

**Validation:**
- `valueText` is required
- `valueText` cannot be empty or whitespace-only
- No other value fields (`valueId`, `valueBool`, `valueIds`) should be present

**API Response (GET `/api/listings/:id`):**
```json
{
  "id": 4,
  "attributeId": 4,
  "attribute": {
    "id": 4,
    "name": "Condition Notes",
    "slug": "condition_notes",
    "type": "text",
    "rangeMin": null,
    "rangeMax": null,
    "rangeStep": null,
    "rangeUnit": null
  },
  "valueId": null,
  "valueBool": null,
  "valueText": "Mint condition, never opened",
  "valueFloat": null,
  "value": null,
  "multiValues": []
}
```

**Filtering:** Text attributes are **not filterable** (no query parameter support).

**Notes:**
- User provides the exact value
- No predefined options
- Can be any string (no length constraints at schema level, but may be constrained by business rules)

---

### Type 4: Range Attributes

**Purpose:** Numeric values constrained by min/max bounds and an optional step size.

**When to use:** Weight, height, battery capacity, dimensions, storage capacity — any numeric measurement.

**Example:** "Weight" with min=0.1, max=100, step=0.1, unit="kg"; a listing could have weight=25.5.

**Storage Pattern:**
```
ListingAttribute {
  valueId: null
  valueBool: null
  valueText: "25.5"        // String representation
  valueFloat: 25.5         // Numeric value for efficient filtering
  multiValues: []          // Not used
}
```

**Attribute Metadata (from `Attribute` model):**
```json
{
  "id": 5,
  "name": "Weight",
  "slug": "weight",
  "type": "range",
  "rangeMin": 0.1,
  "rangeMax": 100,
  "rangeStep": 0.1,
  "rangeUnit": "kg"
}
```

**API Request (POST/PATCH `/api/listings`):**
```json
{
  "attributeId": 5,
  "valueText": "25.5"      // Numeric value as string
}
```

**Validation:**
- `valueText` is required and must be a valid numeric string
- Parsed value must be >= `rangeMin` (if set)
- Parsed value must be <= `rangeMax` (if set)
- No other value fields (`valueId`, `valueBool`, `valueIds`) should be present

**API Response (GET `/api/listings/:id`):**
```json
{
  "id": 5,
  "attributeId": 5,
  "attribute": {
    "id": 5,
    "name": "Weight",
    "slug": "weight",
    "type": "range",
    "rangeMin": 0.1,
    "rangeMax": 100,
    "rangeStep": 0.1,
    "rangeUnit": "kg"
  },
  "valueId": null,
  "valueBool": null,
  "valueText": "25.5",
  "valueFloat": 25.5,
  "value": null,
  "multiValues": []
}
```

**Filtering (GET `/api/listings`):**
```bash
# Min and max
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_5=10,50"

# Only minimum
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_5=10,"

# Only maximum
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_5=,100"
```

**Metadata Fields:**
- `rangeMin`: Minimum allowed value (inclusive)
- `rangeMax`: Maximum allowed value (inclusive)
- `rangeStep`: Suggested increment (for UI spinners/sliders)
- `rangeUnit`: Human-readable unit (e.g., "kg", "cm", "mAh")

---

### Type 5: Date Attributes

**Purpose:** Calendar dates in ISO 8601 format (YYYY-MM-DD).

**When to use:** Manufacturing dates, expiration dates, warranty expiry, release dates.

**Example:** "Warranty Expiry" could be "2025-12-31".

**Storage Pattern:**
```
ListingAttribute {
  valueId: null
  valueBool: null
  valueText: "2024-03-19"  // ISO 8601 format
  valueFloat: null
  multiValues: []          // Not used
}
```

**API Request (POST/PATCH `/api/listings`):**
```json
{
  "attributeId": 8,
  "valueText": "2024-03-19"
}
```

**Validation:**
- `valueText` is required and must match pattern `YYYY-MM-DD`
- Must be a valid calendar date (e.g., not Feb 30)
- No other value fields (`valueId`, `valueBool`, `valueIds`) should be present

**API Response (GET `/api/listings/:id`):**
```json
{
  "id": 8,
  "attributeId": 8,
  "attribute": {
    "id": 8,
    "name": "Warranty Expiry",
    "slug": "warranty_expiry",
    "type": "date",
    "rangeMin": null,
    "rangeMax": null,
    "rangeStep": null,
    "rangeUnit": null
  },
  "valueId": null,
  "valueBool": null,
  "valueText": "2024-03-19",
  "valueFloat": null,
  "value": null,
  "multiValues": []
}
```

**Filtering:** Date attributes are **not filterable** (no query parameter support).

---

### Type 6: Multi-Select Attributes

**Purpose:** Multiple choices from a fixed set of predefined values.

**When to use:** "Available Colors", "Certifications", "Included Accessories" — properties where multiple options apply.

**Example:** A product can have multiple available colors: Red AND Blue AND Green.

**Storage Pattern:**
```
ListingAttribute {
  valueId: null            // Not used for multi_select
  valueBool: null
  valueText: null
  valueFloat: null
  multiValues: [           // Array of selected values
    {
      id: 100,
      value: { id: 10, value: "Red" }
    },
    {
      id: 101,
      value: { id: 11, value: "Blue" }
    },
    {
      id: 102,
      value: { id: 12, value: "Green" }
    }
  ]
}
```

The storage uses the `ListingAttributeValue` join table:
```sql
ListingAttributeValue (listingAttributeId, valueId)
  (1, 10)   -- Red
  (1, 11)   -- Blue
  (1, 12)   -- Green
```

**API Request (POST/PATCH `/api/listings`):**
```json
{
  "attributeId": 7,
  "valueIds": [10, 11, 12]
}
```

**Validation:**
- `valueIds` is required and must be a non-empty array
- All value IDs must reference existing `AttributeValue` records that belong to this attribute
- No duplicate value IDs allowed
- No other value fields (`valueId`, `valueBool`, `valueText`) should be present

**API Response (GET `/api/listings/:id`):**
```json
{
  "id": 7,
  "attributeId": 7,
  "attribute": {
    "id": 7,
    "name": "Available Colors",
    "slug": "available_colors",
    "type": "multi_select",
    "rangeMin": null,
    "rangeMax": null,
    "rangeStep": null,
    "rangeUnit": null
  },
  "valueId": null,
  "valueBool": null,
  "valueText": null,
  "valueFloat": null,
  "value": null,
  "multiValues": [
    {
      "id": 100,
      "value": { "id": 10, "value": "Red" }
    },
    {
      "id": 101,
      "value": { "id": 11, "value": "Blue" }
    },
    {
      "id": 102,
      "value": { "id": 12, "value": "Green" }
    }
  ]
}
```

**Filtering (GET `/api/listings`):**
```bash
# Multiple values (OR logic: match any color)
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_7=10&attr_7=11"

# Single value
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_7=10"
```

**Notes:**
- Unlike `select` (one choice), `multi_select` allows many
- Values are stored in a separate join table (`ListingAttributeValue`)
- Order of values is not guaranteed in responses

---

## Category-Attribute Associations

Attributes are linked to categories via `CategoryAttribute`, which provides metadata:

```json
{
  "attributeId": 1,
  "name": "Color",
  "slug": "color",
  "type": "select",
  "required": true,        // Must be provided when creating listings in this category
  "isFilterable": true,    // Can be used in GET /api/listings filter params
  "values": [              // Predefined options (for select/multi_select only)
    { "id": 10, "value": "Red" },
    { "id": 11, "value": "Blue" }
  ],
  "rangeMin": null,        // For range attributes only
  "rangeMax": null,
  "rangeStep": null,
  "rangeUnit": null
}
```

**Key flags:**

- **`required`:** If true, you must provide this attribute when creating or updating a listing in this category. Enforced by POST/PATCH `/api/listings` validation.
- **`isFilterable`:** If true, this attribute can be used in GET `/api/listings` query parameters. Controls inclusion in GET `/api/attributes/filters/:categoryId` response.

---

## Complete Listing Creation Example

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
SIGNATURE="deadbeef..."

curl -X POST http://localhost:3000/api/listings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "iPhone 15 Pro Max",
    "price": 50000,
    "description": "Brand new iPhone 15 Pro Max in pristine condition.",
    "categoryId": 2,
    "attributes": [
      {
        "attributeId": 1,
        "valueId": 20
      },
      {
        "attributeId": 2,
        "valueBool": true
      },
      {
        "attributeId": 3,
        "valueText": "Pristine condition, never opened"
      },
      {
        "attributeId": 5,
        "valueText": "0.22"
      },
      {
        "attributeId": 7,
        "valueIds": [10, 12]
      },
      {
        "attributeId": 8,
        "valueText": "2024-02-15"
      }
    ],
    "signature": "'$SIGNATURE'"
  }'
```

---

## Filtering and Discovery

### Step 1: Get All Attributes

```bash
curl -X GET http://localhost:3000/api/attributes \
  -H "Authorization: Bearer $TOKEN"
```

Returns all attributes in the system with their types, predefined values, and range metadata.

### Step 2: Get Category-Specific Attributes

```bash
curl -X GET http://localhost:3000/api/attributes/by-category/2 \
  -H "Authorization: Bearer $TOKEN"
```

Returns attributes relevant to category 2, with `required` and `isFilterable` flags.

### Step 3: Get Filterable Attributes

```bash
curl -X GET http://localhost:3000/api/attributes/filters/2 \
  -H "Authorization: Bearer $TOKEN"
```

Returns only filterable attributes with values actually used in listings of category 2. Useful for building dynamic filter UIs.

### Step 4: Query Listings by Attributes

```bash
# Combining multiple attribute filters
curl -X GET "http://localhost:3000/api/listings?categoryId=2&attr_1=20&attr_2=true&attr_5=10,50&attr_7=10&attr_7=11" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Summary Table

| Type | Single/Multi | Predefined | Storage Columns | Filterable | Metadata |
|------|--------------|-----------|-----------------|-----------|----------|
| **select** | Single | Yes | `valueId` | Yes | None |
| **boolean** | Single | No | `valueBool` | Yes | None |
| **text** | Single | No | `valueText` | No | None |
| **range** | Single | No | `valueText` + `valueFloat` | Yes | min/max/step/unit |
| **date** | Single | No | `valueText` (YYYY-MM-DD) | No | None |
| **multi_select** | Multiple | Yes | `ListingAttributeValue` table | Yes | None |

---

## Error Handling

### Common Validation Errors

**400: Attribute not found for category**
```
"Attribute 'color' is not valid for category 'Electronics'"
```
Solution: Use `GET /api/attributes/by-category/:categoryId` to see valid attributes.

**400: Required attribute missing**
```
"Required attribute 'Brand' is missing"
```
Solution: Get category attributes with `GET /api/attributes/by-category/:categoryId` and check `required` flag.

**400: Type mismatch**
```
"Attribute 'color' is a select type and requires a valueId"
```
Solution: Check the attribute type and provide the correct field (valueId, valueBool, valueText, or valueIds).

**400: Value out of range**
```
"Attribute 'weight' value must be >= 0.1"
```
Solution: Check range metadata via `GET /api/attributes/:attributeId` and provide a value within bounds.

**400: Invalid date format**
```
"Attribute 'warranty_expiry' requires an ISO date (YYYY-MM-DD) in valueText"
```
Solution: Provide date in YYYY-MM-DD format (e.g., "2024-12-31").

---

## Design Patterns

### Pattern 1: Optional Attributes

If `CategoryAttribute.required = false`, the attribute may be omitted when creating/updating a listing.

### Pattern 2: Read-Only Attributes

Attributes themselves are read-only through this API. You cannot create, update, or delete attributes. This is managed through admin tools or direct database access.

### Pattern 3: Attribute Inheritance

A listing belongs to exactly one category (via `categoryId`). Attributes are associated with that category. When you change a listing's category, all attributes must be re-provided for the new category.

### Pattern 4: Filtering Without Categories

Range filtering is only available when you provide `categoryId` in the query. You cannot use attribute filters on a category-less listing search.

---

## Performance Notes

- **Range queries:** `valueFloat` is indexed for efficient range filtering
- **Value IDs:** `valueId` and foreign keys are indexed
- **Multi-select lookups:** Use the `ListingAttributeValue` join table for efficient queries

---
