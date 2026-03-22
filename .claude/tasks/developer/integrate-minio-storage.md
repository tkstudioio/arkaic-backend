# Task: Integrate MinIO for object storage (replace local disk uploads)

## Context

Listing photos are currently stored on the local filesystem under `uploads/listings/<listingId>/` and served via Hono's `serveStatic` middleware at `GET /uploads/*`. This approach does not scale across multiple server instances and ties storage to the server's disk.

A MinIO instance (S3-compatible object storage) is already configured in `docker-compose.yml` at `127.0.0.1:9000`. This task replaces the local file system storage with MinIO, using the official AWS S3 SDK (`@aws-sdk/client-s3`) which is compatible with MinIO.

**Prerequisite:** The PostgreSQL migration task (`migrate-sqlite-to-postgresql.md`) must be completed first, since this task builds on the same codebase state.

## Objective

- Create a MinIO/S3 client library module
- Rewrite the photo upload endpoint to store files in MinIO instead of local disk
- Rewrite the photo delete endpoint to remove objects from MinIO instead of local disk
- Add a presigned URL endpoint (or proxy endpoint) so clients can access photos
- Remove the `serveStatic` middleware for `/uploads/*`
- Update the `ListingPhoto` model to store the MinIO object key instead of a local filename
- Add MinIO environment variables

## Files involved

| File                           | Action                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/minio.ts`             | Create: S3-compatible client singleton and helper functions                                                                                  |
| `src/routes/api/photos.ts`     | Modify: replace fs operations with MinIO operations                                                                                          |
| `src/index.ts`                 | Modify: remove `serveStatic` for `/uploads/*`, add photo URL route                                                                           |
| `.env.example`                 | Modify: add MinIO env vars                                                                                                                   |
| `.env.local`                   | Modify: add MinIO env vars                                                                                                                   |
| `prisma/schema.prisma`         | Modify: rename `filename` to `objectKey` in ListingPhoto (or keep `filename` and repurpose it as the object key -- see implementation notes) |
| `.claude/docs/packages.md`     | Modify: add minio.ts documentation                                                                                                           |
| `.claude/docs/architecture.md` | Modify: mention MinIO in application structure                                                                                               |
| `.claude/docs/environment.md`  | Modify: add MinIO env vars and dependency                                                                                                    |

## Implementation

### Step 1 -- Install the AWS S3 SDK

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- `@aws-sdk/client-s3` -- S3 client for put, get, delete operations
- `@aws-sdk/s3-request-presigner` -- generates presigned URLs for GET requests

### Step 2 -- Add MinIO environment variables

Add these to `.env.example`:

```
MINIO_ENDPOINT="http://127.0.0.1:9000"
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"
MINIO_BUCKET="arkaic"
```

Add the same values to `.env.local`.

### Step 3 -- Create src/lib/minio.ts

Create a new library module with the S3 client singleton and helper functions:

```typescript
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || "http://127.0.0.1:9000";
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || "minioadmin";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || "minioadmin";
export const MINIO_BUCKET = process.env.MINIO_BUCKET || "arkaic";

export const s3 = new S3Client({
  endpoint: MINIO_ENDPOINT,
  region: "us-east-1", // MinIO ignores this but the SDK requires it
  credentials: {
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  },
  forcePathStyle: true, // Required for MinIO (path-style access instead of virtual-hosted)
});

/**
 * Upload a file to MinIO.
 * @param key   Object key (e.g., "listings/42/abc123.jpg")
 * @param body  File content as Buffer or Uint8Array
 * @param contentType  MIME type (e.g., "image/jpeg")
 * @returns The object key
 */
export async function uploadObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return key;
}

/**
 * Delete an object from MinIO.
 * @param key  Object key to delete
 */
export async function deleteObject(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: key,
    }),
  );
}

/**
 * Generate a presigned GET URL for an object.
 * @param key        Object key
 * @param expiresIn  URL validity in seconds (default: 3600 = 1 hour)
 * @returns Presigned URL string
 */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: key,
    }),
    { expiresIn },
  );
}
```

Key design decisions:

- `forcePathStyle: true` is mandatory for MinIO (it does not support virtual-hosted-style URLs)
- `region: "us-east-1"` is a dummy value required by the SDK but ignored by MinIO
- The bucket name is configurable via env var with a sensible default

### Step 4 -- Create the bucket at startup

Add bucket initialization to the application startup. In `src/index.ts`, add bucket creation logic that runs before the server starts listening. Import from the minio lib:

```typescript
import { s3, MINIO_BUCKET } from "@/lib/minio";
import { CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
```

Add an async initialization function before `serve()`:

```typescript
async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: MINIO_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: MINIO_BUCKET }));
    console.log(`Created MinIO bucket: ${MINIO_BUCKET}`);
  }
}
```

Call it before starting the server. Wrap the server startup in an async IIFE or top-level await:

```typescript
await ensureBucket();

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on port ${port}`);
});
```

Since the project uses ESM (`"type": "module"`) and tsx runtime, top-level await is supported.

### Step 5 -- Update the ListingPhoto model

The `ListingPhoto.filename` field currently stores only the file name (e.g., `1711234567890-uuid.jpg`). Repurpose this field to store the full MinIO object key (e.g., `listings/42/1711234567890-uuid.jpg`). This avoids a Prisma migration to rename the column.

**No schema change is needed.** The `filename` field will now store the full object key string. Update the comment in the schema for clarity:

In `prisma/schema.prisma`, above the `filename` field in `ListingPhoto`, add a comment:

```prisma
model ListingPhoto {
  id        Int      @id @default(autoincrement())
  listingId Int
  listing   Listing  @relation(fields: [listingId], references: [id], onDelete: Cascade)
  filename  String   // MinIO object key (e.g., "listings/42/abc123.jpg")
  mimeType  String
  size      Int
  position  Int      @default(0)
  createdAt DateTime @default(now())

  @@index([listingId])
}
```

Since only a comment is added, no migration is needed.

### Step 6 -- Rewrite src/routes/api/photos.ts

Replace the local filesystem operations with MinIO operations. Here are the specific changes:

**Imports:** Replace:

```typescript
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
```

with:

```typescript
import { uploadObject, deleteObject } from "@/lib/minio";
```

**Remove** the `UPLOADS_BASE` constant and `extFromMime` function entirely -- the `extFromMime` function is still needed, keep it.

Actually, keep `extFromMime` as-is (it is used to generate the file extension for the object key). Remove only:

- `import { mkdir, unlink, writeFile } from "node:fs/promises";`
- `import path from "node:path";`
- `const UPLOADS_BASE = path.resolve(process.cwd(), "uploads");`

**Upload handler (`POST /:id/photos`):**

Replace the file write + transaction block. The new logic:

1. Remove `const uploadDir` and `await mkdir(...)` lines
2. Remove `const writtenFiles: string[] = []`
3. Inside the transaction loop, replace file write with MinIO upload:

```typescript
const ext = extFromMime(file.type, file.name);
const filename = `${Date.now()}-${crypto.randomUUID()}${ext}`;
const objectKey = `listings/${id}/${filename}`;

await uploadObject(objectKey, Buffer.from(await file.arrayBuffer()), file.type);
uploadedKeys.push(objectKey);

const photo = await tx.listingPhoto.create({
  data: {
    listingId: id,
    filename: objectKey, // Store full object key
    mimeType: file.type,
    size: file.size,
    position: existingCount + i,
  },
});
```

4. Track uploaded keys for rollback: replace `writtenFiles` with `uploadedKeys`:

```typescript
const uploadedKeys: string[] = [];
```

5. In the catch block, clean up MinIO objects instead of local files:

```typescript
catch (_err) {
  for (const key of uploadedKeys) {
    await deleteObject(key).catch(() => {});
  }
  return c.text("Failed to upload photos", 500);
}
```

**Delete handler (`DELETE /:id/photos/:photoId`):**

Replace the local file deletion:

```typescript
const filePath = path.join(UPLOADS_BASE, "listings", String(id), photo.filename);
await unlink(filePath).catch(() => {});
```

with:

```typescript
await deleteObject(photo.filename).catch(() => {});
```

Note: `photo.filename` now contains the full object key (e.g., `listings/42/abc.jpg`), so it can be passed directly to `deleteObject`.

**Reorder handler (`PATCH /:id/photos/order`):** No changes needed -- it only updates DB positions.

### Step 7 -- Add a presigned URL endpoint for photo access

Add a new GET endpoint to serve photo URLs. There are two approaches. Use the **presigned URL approach** as it offloads bandwidth to MinIO.

Add a new route in `src/routes/api/photos.ts`:

```typescript
photos.get("/:id/photos/:photoId/url", async (c) => {
  const id = Number(c.req.param("id"));
  const photoId = Number(c.req.param("photoId"));
  if (isNaN(id) || isNaN(photoId)) return c.text("Invalid id", 400);

  const photo = await prisma.listingPhoto.findFirst({
    where: { id: photoId, listingId: id },
  });
  if (!photo) return c.text("Photo not found", 404);

  const url = await getPresignedUrl(photo.filename);
  return c.json({ url });
});
```

Import `getPresignedUrl` from `@/lib/minio` at the top of the file.

This endpoint is behind `bearerAuth` (applied globally via `photos.use(bearerAuth)` at the top of the file).

Additionally, add a **batch presigned URL helper** that listing endpoints can use. Add this to `src/lib/minio.ts`:

```typescript
/**
 * Generate presigned URLs for multiple object keys.
 * @param keys  Array of object keys
 * @param expiresIn  URL validity in seconds (default: 3600)
 * @returns Map of key -> presigned URL
 */
export async function getPresignedUrls(
  keys: string[],
  expiresIn = 3600,
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    keys.map(async (key) => [key, await getPresignedUrl(key, expiresIn)] as const),
  );
  return new Map(entries);
}
```

### Step 8 -- Remove static file serving from src/index.ts

Remove the following line from `src/index.ts`:

```typescript
app.use("/uploads/*", serveStatic({ root: "./" }));
```

Also remove the import:

```typescript
import { serveStatic } from "@hono/node-server/serve-static";
```

The `/uploads/*` route is no longer needed since files are served from MinIO via presigned URLs.

### Step 9 -- Remove the NOTE comment from photos.ts

Remove the comment at the top of `src/routes/api/photos.ts`:

```typescript
// NOTE: If a DELETE /api/listings/:id endpoint is added in the future,
// it must also delete the uploads/listings/<id>/ directory from disk.
```

Replace it with:

```typescript
// NOTE: If a DELETE /api/listings/:id endpoint is added in the future,
// it must also delete the listing's photo objects from MinIO.
```

### Step 10 -- Update documentation

**`.claude/docs/architecture.md`** -- in the Application Structure section, add after the Database line:

```
- **Object Storage:** MinIO (S3-compatible) via `@aws-sdk/client-s3`
```

Update the `ListingPhoto` description in the Data Model table to mention MinIO instead of disk:

```
| **ListingPhoto**    | Photo attached to a listing (objectKey for MinIO, mimeType, size, position; cascade delete on listing removal) | `id` |
```

**`.claude/docs/packages.md`** -- add a new section in the Lib section:

```
### minio.ts -- Object storage client

S3-compatible client for MinIO. Import from `@/lib/minio`.

| Export              | Type     | Purpose                                          |
| ------------------- | -------- | ------------------------------------------------ |
| `s3`                | S3Client | Configured S3 client instance                    |
| `MINIO_BUCKET`      | string   | Bucket name from env (default: "arkaic")         |
| `uploadObject`      | Function | Upload a file buffer to MinIO                    |
| `deleteObject`      | Function | Delete an object from MinIO                      |
| `getPresignedUrl`   | Function | Generate a presigned GET URL (default: 1h expiry)|
| `getPresignedUrls`  | Function | Batch presigned URL generation                   |
```

Update the `photos.ts` route section description to mention MinIO instead of disk storage.

**`.claude/docs/environment.md`** -- add MinIO env vars to the table:

```
| `MINIO_ENDPOINT`   | MinIO/S3 endpoint URL (default: `http://127.0.0.1:9000`) |
| `MINIO_ACCESS_KEY`  | MinIO access key (default: `minioadmin`) |
| `MINIO_SECRET_KEY`  | MinIO secret key (default: `minioadmin`) |
| `MINIO_BUCKET`      | MinIO bucket name (default: `arkaic`) |
```

Add `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` to the dependency table.

## Constraints

- ESM only, use `@/` path alias for imports within `src/`
- Follow the existing singleton pattern (see `src/lib/prisma.ts`, `src/lib/ark.ts`) for the MinIO client
- The `photos.ts` route file already applies `bearerAuth` globally -- new endpoints inherit it
- Do NOT add `verifySignature` to the photo URL endpoint (GET requests have no body to sign)
- `forcePathStyle: true` is mandatory for the S3 client when targeting MinIO
- Object keys must use the format `listings/<listingId>/<filename>` for organizational consistency
- The presigned URL endpoint does not require ownership verification -- any authenticated user can request a photo URL (photos are associated with publicly visible listings)

## Acceptance criteria

- `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are in `package.json` dependencies
- `src/lib/minio.ts` exists with `s3`, `MINIO_BUCKET`, `uploadObject`, `deleteObject`, `getPresignedUrl`, `getPresignedUrls` exports
- The `arkaic` bucket is auto-created at server startup if it does not exist
- `POST /:id/photos` uploads files to MinIO and stores the object key in `ListingPhoto.filename`
- `DELETE /:id/photos/:photoId` removes the object from MinIO
- `GET /:id/photos/:photoId/url` returns a presigned URL for the photo
- The `serveStatic` middleware for `/uploads/*` is removed from `src/index.ts`
- No references to `node:fs/promises` (`writeFile`, `unlink`, `mkdir`) remain in `photos.ts`
- No references to `UPLOADS_BASE` or local path construction remain in `photos.ts`
- `docker compose up -d` starts both PostgreSQL and MinIO without errors
- `npm run dev` starts the server, auto-creates the bucket, and logs success
- `npx tsc --noEmit` passes without type errors
- Documentation is updated

## Notes for reviewer

- Verify `forcePathStyle: true` is set on the S3 client (MinIO requirement)
- Verify that the catch block in the upload handler properly cleans up MinIO objects on transaction failure
- Verify that presigned URLs expire (default 1 hour) and are not cached indefinitely by clients
- Verify that the bucket auto-creation in `src/index.ts` handles the case where MinIO is not yet available (server should fail to start with a clear error, not crash silently)
- Verify no leftover `fs` imports or `uploads/` path references exist in the codebase after the change
- Note: existing photos stored on disk (in `uploads/`) will NOT be migrated automatically. This is acceptable for development. If production data exists, a separate migration script would be needed.
