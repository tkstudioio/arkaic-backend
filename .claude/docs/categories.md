# Categories: Icons & Colors

> **Audience**: Frontend team
> **Purpose**: Documentation for displaying category icons and colors in the UI

## Overview

Each category in the marketplace can have an associated **icon name** and **color code**. These fields are optional (`nullable`) but are populated for root categories to help users quickly identify the main marketplace sections.

## Data Model

```typescript
// Prisma schema
model Category {
  id        Int     @id @default(autoincrement())
  name      String
  slug      String  @unique
  iconName  String?  // Icon identifier (e.g., "shirt", "shopping-bag")
  color     String?  // Hex color code (e.g., "#8B5CF6")
  childrenOf Int?   // Parent category ID (null = root category)
  // ... relationships
}
```

## API Endpoints

### GET /api/categories

Returns all root categories with their direct children.

**Response example:**
```json
[
  {
    "id": 1,
    "name": "Fashion",
    "slug": "fashion",
    "iconName": "shirt",
    "color": "#8B5CF6",
    "childrenOf": null,
    "children": [
      { "id": 2, "name": "Women", "slug": "fashion-women", "iconName": null, "color": null, ... },
      { "id": 3, "name": "Men", "slug": "fashion-men", "iconName": null, "color": null, ... }
    ],
    "parent": null
  },
  {
    "id": 10,
    "name": "Market",
    "slug": "market",
    "iconName": "shopping-bag",
    "color": "#F59E0B",
    "childrenOf": null,
    "children": [ ... ],
    "parent": null
  },
  {
    "id": 50,
    "name": "Work & Services",
    "slug": "work",
    "iconName": "briefcase",
    "color": "#3B82F6",
    "childrenOf": null,
    "children": [ ... ],
    "parent": null
  }
]
```

### GET /api/categories/:slug

Returns a specific category with its children and attributes.

**Response example (GET /api/categories/fashion):**
```json
{
  "id": 1,
  "name": "Fashion",
  "slug": "fashion",
  "iconName": "shirt",
  "color": "#8B5CF6",
  "childrenOf": null,
  "parent": null,
  "children": [ ... ],
  "categoryAttributes": [ ... ]
}
```

## Root Categories Reference

| Name | Slug | Icon | Color |
|------|------|------|-------|
| Fashion | `fashion` | `shirt` | `#8B5CF6` (purple) |
| Market | `market` | `shopping-bag` | `#F59E0B` (amber) |
| Work & Services | `work` | `briefcase` | `#3B82F6` (blue) |

## Usage Examples

### React TypeScript Component

```typescript
import React, { useEffect, useState } from 'react';

interface Category {
  id: number;
  name: string;
  slug: string;
  iconName: string | null;
  color: string | null;
  children: Category[];
}

function CategoryCard({ category }: { category: Category }) {
  return (
    <div style={{
      borderColor: category.color || '#e5e7eb',
      borderWidth: '2px',
      padding: '1rem',
      borderRadius: '0.5rem'
    }}>
      {category.iconName && (
        <img
          src={`/icons/${category.iconName}.svg`}
          alt={category.name}
          style={{
            width: '2rem',
            height: '2rem',
            filter: category.color ? `hue-rotate(${getHueShift(category.color)})` : 'none'
          }}
        />
      )}
      <h3 style={{ color: category.color || 'inherit' }}>
        {category.name}
      </h3>
    </div>
  );
}

function CategoryBrowser() {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    fetch('/api/categories', {
      headers: { 'Authorization': 'Bearer <JWT_TOKEN>' }
    })
      .then(r => r.json())
      .then(setCategories);
  }, []);

  return (
    <div className="grid grid-cols-3 gap-4">
      {categories.map(cat => (
        <CategoryCard key={cat.id} category={cat} />
      ))}
    </div>
  );
}
```

### Fallback Behavior

Since `iconName` and `color` are nullable:
- **For root categories**: Always present (populated during seeding)
- **For subcategories**: Usually `null` (inherit parent styling if needed)

```typescript
function getCategoryColor(category: Category): string {
  if (category.color) return category.color;
  if (category.parent?.color) return category.parent.color;
  return '#6b7280'; // Default gray
}
```

## Icon Library

The `iconName` field contains identifiers that map to an icon library. Currently used icons:
- `shirt` — Fashion category
- `shopping-bag` — Market category
- `briefcase` — Work & Services category

These map to common icon sets like:
- **Heroicons** (`heroicons.com`)
- **Feather Icons** (`feathericons.com`)
- **Material Design Icons** (`fonts.google.com/icons`)

Choose icons from your frontend's icon library that match these names.

## Color Scheme

Colors are provided as **hex codes** for flexibility. All root categories use a vibrant, accessible palette:
- `#8B5CF6` — Purple (Fashion)
- `#F59E0B` — Amber (Market)
- `#3B82F6` — Blue (Work & Services)

Use these colors for:
- Category card backgrounds or borders
- Icon tinting
- Navigation highlights
- Listing categorization indicators

## Null Handling

```typescript
// Safe rendering
<div className={`category-card ${category.iconName ? 'has-icon' : 'no-icon'}`}>
  {category.iconName ? (
    <Icon name={category.iconName} />
  ) : (
    <DefaultIcon />
  )}
  <h2 style={category.color ? { color: category.color } : {}}>
    {category.name}
  </h2>
</div>
```

## Database Seed

Icons and colors are populated during database initialization from `/data/marketplace.json`. To update root category styling:

1. Edit the category definition in `data/marketplace.json`
2. Run `npx prisma migrate dev` to create a migration
3. Seed data is automatically applied during reset or seeding

Example marketplace.json entry:
```json
{
  "name": "Fashion",
  "slug": "fashion",
  "iconName": "shirt",
  "color": "#8B5CF6",
  "attributes": [ ... ],
  "children": [ ... ]
}
```

## Notes

- **Availability**: Only root categories are guaranteed to have `iconName` and `color` values
- **Immutability**: These values are set during seeding and should not change frequently
- **Performance**: Icons and colors are included in all category API responses (no extra queries needed)
- **Accessibility**: Use colors in combination with icons or text labels for clarity; don't rely on color alone
