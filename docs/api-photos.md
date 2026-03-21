# Photo Management Endpoints

Photos are images attached to listings. Sellers can upload, delete, and reorder photos for their listings. Each listing can have a maximum of 10 photos. Photos are returned in order by position (0-indexed) in all listing responses.

## Authentication

All endpoints in this group require a valid Bearer token (obtained from `/api/auth/login`). Additionally, the authenticated user must be the seller who created the listing to upload, delete, or reorder photos.

---

## `POST /api/listings/:id/photos`

Upload one or more photos to a listing. Photos are stored on disk in the `uploads/listings/<id>/` directory and indexed in the database.

**Authentication:** Bearer token
**Authorization:** Only the seller who created the listing can upload photos
**File limits:** Maximum 10 photos total per listing, 4 MB per file
**Supported formats:** JPEG, PNG, WebP, GIF

### Request

Multipart form data with:

- `photos`: One or more File objects (form field name is `photos`)

```
POST /api/listings/42/photos
Content-Type: multipart/form-data; boundary=---boundary

-----boundary
Content-Disposition: form-data; name="photos"; filename="photo1.jpg"
Content-Type: image/jpeg

[binary image data]
-----boundary
Content-Disposition: form-data; name="photos"; filename="photo2.png"
Content-Type: image/png

[binary image data]
-----boundary--
```

### Response (201)

```json
[
  {
    "id": "number — unique photo ID",
    "listingId": "number — ID of the listing this photo belongs to",
    "filename": "string — generated filename (timestamp-uuid.ext)",
    "mimeType": "string — MIME type as sent in upload (e.g., 'image/jpeg')",
    "size": "number — file size in bytes",
    "position": "number — sort position (0-indexed, assigned sequentially)",
    "createdAt": "ISO 8601 datetime — when photo was uploaded"
  }
]
```

### Errors

| Status | Description |
| ------ | ----------- |
| 400    | No photos provided |
| 400    | File is not an image (MIME type does not start with `image/`) |
| 400    | File exceeds 4 MB |
| 400    | Listing already has 10 photos (maximum reached) |
| 401    | Missing or invalid Bearer token |
| 404    | Listing not found or not owned by authenticated user |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Upload a single photo
curl -X POST http://localhost:3000/api/listings/42/photos \
  -H "Authorization: Bearer $TOKEN" \
  -F "photos=@/path/to/photo1.jpg"

# Upload multiple photos
curl -X POST http://localhost:3000/api/listings/42/photos \
  -H "Authorization: Bearer $TOKEN" \
  -F "photos=@/path/to/photo1.jpg" \
  -F "photos=@/path/to/photo2.jpg" \
  -F "photos=@/path/to/photo3.png"
```

---

## `DELETE /api/listings/:id/photos/:photoId`

Delete a specific photo from a listing. The physical file is deleted from disk and the database record is removed. Positions of remaining photos are automatically adjusted.

**Authentication:** Bearer token
**Authorization:** Only the seller who created the listing can delete photos

### Request

```
DELETE /api/listings/42/photos/123
```

Path parameters:

- `id`: Listing ID (numeric)
- `photoId`: Photo ID to delete (numeric)

### Response (200)

```json
{
  "deleted": true
}
```

### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid listing ID or photo ID (not numeric) |
| 401    | Missing or invalid Bearer token |
| 404    | Photo not found or not owned by authenticated user |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X DELETE http://localhost:3000/api/listings/42/photos/123 \
  -H "Authorization: Bearer $TOKEN"
```

---

## `PATCH /api/listings/:id/photos/order`

Reorder photos in a listing by specifying the new order of photo IDs. The `photoIds` array must contain exactly the same photo IDs as currently exist for the listing, in the desired order.

**Authentication:** Bearer token
**Authorization:** Only the seller who created the listing can reorder photos

### Request

```json
{
  "photoIds": [123, 125, 124]
}
```

Field:

- `photoIds`: Array of photo IDs in the desired order. Must contain exactly the same IDs as currently exist for the listing.

### Response (200)

```json
[
  {
    "id": "number — photo ID",
    "listingId": "number — listing ID",
    "filename": "string — filename",
    "mimeType": "string — MIME type",
    "size": "number — file size in bytes",
    "position": "number — new sort position (0-indexed)",
    "createdAt": "ISO 8601 datetime"
  }
]
```

Photos are returned sorted by the new position values in ascending order.

### Errors

| Status | Description |
| ------ | ----------- |
| 400    | Invalid listing ID (not numeric) |
| 400    | `photoIds` is not an array of positive integers |
| 400    | `photoIds` does not contain exactly the same IDs as existing photos |
| 400    | `photoIds` contains duplicate IDs |
| 401    | Missing or invalid Bearer token |
| 404    | Listing not found or no photos exist |

### Example curl

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Reorder photos: move photo 125 to first position
curl -X PATCH http://localhost:3000/api/listings/42/photos/order \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "photoIds": [125, 123, 124]
  }'
```

---

## Photo Upload Workflow

1. **Seller Creates Listing**: POST `/api/listings` without photos initially
2. **Seller Uploads Photos**: POST `/api/listings/:id/photos` with one or more image files
3. **Photos Appear in Listing**: GET `/api/listings/:id` returns photos in order
4. **Seller Reorders Photos** (optional): PATCH `/api/listings/:id/photos/order` with new photo ID order
5. **Seller Deletes Photos** (optional): DELETE `/api/listings/:id/photos/:photoId` to remove individual photos

---

## Notes

- Photos are stored on disk in the `uploads/listings/<id>/` directory relative to the server's working directory
- Filenames are generated as `<timestamp>-<uuid>.<extension>` to ensure uniqueness and prevent collisions
- The file extension is determined from the MIME type sent in the upload (JPEG → .jpg, PNG → .png, WebP → .webp, GIF → .gif) or extracted from the original filename as fallback
- Position values (0-indexed) are used for sorting. When photos are reordered, all positions are updated atomically in a single transaction
- When a photo is deleted, remaining photos are **not** automatically renumbered. Use the PATCH endpoint to explicitly reorder if needed
- Maximum of 10 photos per listing is enforced at upload time
- Photos are included in all listing responses (GET `/api/listings`, GET `/api/listings/:id`, GET `/api/listings/my-listings`, GET `/api/listings/my-purchases`) sorted by position
