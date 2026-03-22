# Handoff: SQLite to PostgreSQL Migration + MinIO Integration

## Summary

Two tasks were implemented sequentially:

1. **`migrate-sqlite-to-postgresql.md`** — Replace SQLite with PostgreSQL as the database engine.
2. **`integrate-minio-storage.md`** — Replace local disk photo storage with MinIO S3-compatible object storage.

Both tasks passed `npx tsc --noEmit` and `npm run dev` end-to-end verification.

---

## Task 1: SQLite to PostgreSQL

### What changed

| File                                    | Change                                                                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`                    | Added `postgres` service (postgres:17-alpine, port 5432, named volume `postgres-data`) before the existing `minio` service                          |
| `prisma/schema.prisma`                  | Changed `datasource db` provider from `"sqlite"` to `"postgresql"` (no `url` field — Prisma 7.x requires connection URL in `prisma.config.ts` only) |
| `src/lib/prisma.ts`                     | Replaced `PrismaBetterSqlite3` adapter with `PrismaPg` from `@prisma/adapter-pg`                                                                    |
| `prisma/seed.ts`                        | Same adapter change as `prisma.ts`                                                                                                                  |
| `prisma/backfill-listing-categories.ts` | Same adapter change (not mentioned in task but was a compilation blocker — leftover reference to `@prisma/adapter-better-sqlite3`)                  |
| `package.json`                          | Removed `@prisma/adapter-better-sqlite3`; added `@prisma/adapter-pg`, `pg`, `@types/pg`                                                             |
| `.env.example`                          | Updated `DATABASE_URL` to `postgresql://arkaic:arkaic@127.0.0.1:5432/arkaic`                                                                        |
| `.env.local`                            | Updated `DATABASE_URL` to PostgreSQL connection string                                                                                              |
| `prisma/migrations/`                    | Deleted all SQLite-specific migrations; new `20260322163040_init` PostgreSQL migration generated                                                    |
| `.claude/docs/architecture.md`          | Updated database reference                                                                                                                          |
| `.claude/docs/packages.md`              | Updated `prisma.ts` description                                                                                                                     |
| `.claude/docs/environment.md`           | Updated technology stack, dependency table, env vars, database section                                                                              |

### Important deviation from task plan

The task stated that Prisma 7.x handles PostgreSQL natively without a driver adapter and that `@prisma/adapter-pg` is not required. This is incorrect for Prisma 7.4.2 — the runtime throws `PrismaClientInitializationError: PrismaClient needs to be constructed with a non-empty, valid PrismaClientOptions` when no adapter is passed. Prisma 7 removed the built-in query engine and requires an explicit driver adapter.

Additionally, the task stated the schema `datasource` block should include `url = env("DATABASE_URL")`. Prisma 7.4.2 rejects this with error `P1012`: the connection URL must be configured exclusively in `prisma.config.ts` (which already had it). The schema only declares `provider = "postgresql"`.

### Verification

- `docker compose up -d postgres` — PostgreSQL 17 container on port 5432
- `npx prisma migrate dev --name init` — fresh PostgreSQL migration created and applied
- `npx prisma db seed` — 725 categories, 84 attributes seeded successfully
- `npx tsc --noEmit` — no errors
- `npm run dev` + `POST /api/auth/challenge` — server responds correctly

---

## Task 2: MinIO Integration

### What changed

| File                           | Change                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/minio.ts`             | Created: S3Client singleton, `uploadObject`, `deleteObject`, `getPresignedUrl`, `getPresignedUrls` exports                                     |
| `src/index.ts`                 | Removed `serveStatic` import and `/uploads/*` middleware; added `ensureBucket()` async initialization with top-level await before `serve()`    |
| `src/routes/api/photos.ts`     | Replaced all `node:fs/promises` operations with MinIO calls; added `GET /:id/photos/:photoId/url` presigned URL endpoint; updated NOTE comment |
| `prisma/schema.prisma`         | Added comment to `ListingPhoto.filename` field clarifying it stores MinIO object keys                                                          |
| `.env.example`                 | Added `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`                                                                 |
| `.env.local`                   | Same MinIO env vars                                                                                                                            |
| `package.json`                 | Added `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`                                                                                    |
| `.claude/docs/architecture.md` | Added Object Storage entry; updated `ListingPhoto` description                                                                                 |
| `.claude/docs/packages.md`     | Added `minio.ts` lib section; updated `photos.ts` route description and endpoint table                                                         |
| `.claude/docs/environment.md`  | Added MinIO env vars; added AWS SDK dependencies to table                                                                                      |

### Key design decisions

- `forcePathStyle: true` set on S3Client (mandatory for MinIO)
- Object key format: `listings/<listingId>/<timestamp>-<uuid><ext>`
- `ListingPhoto.filename` field repurposed to store the full MinIO object key — no schema migration needed
- Bucket auto-creation at startup: `HeadBucketCommand` first, then `CreateBucketCommand` on 404; server startup fails with a thrown error if MinIO is unreachable (acceptable behavior per task)
- Presigned URL endpoint inherits `bearerAuth` from `photos.use(bearerAuth)` — any authenticated user can request URLs (photos are for public listings)
- Upload rollback: if the DB transaction fails after one or more MinIO uploads, the catch block iterates `uploadedKeys` and calls `deleteObject` for each (silently ignoring individual delete failures)

### Verification

- `docker compose up -d` — both PostgreSQL and MinIO start without errors
- `npm run dev` — server starts, `ensureBucket()` creates the `arkaic` bucket on first run
- `npx tsc --noEmit` — no errors
- No `node:fs/promises`, `UPLOADS_BASE`, `uploads/`, `writeFile`, `unlink`, or `mkdir` references remain in `src/`
- No `better-sqlite3` or `sqlite` references remain in `package.json` or `src/`

---

## Reviewer Checklist

### Task 1

- [ ] Verify `prisma/migrations/20260322163040_init/migration.sql` contains PostgreSQL DDL (not SQLite): `CREATE TYPE` for enums, `SERIAL` for autoincrement IDs, `TIMESTAMP` for DateTime
- [ ] Verify `@@unique` constraints and `@@index` directives are present in the migration SQL
- [ ] Confirm no references to `better-sqlite3` or `sqlite` exist anywhere in the codebase
- [ ] Confirm `prisma.config.ts` was not modified (it already had `datasource.url` reading from env)
- [ ] Note: `backfill-listing-categories.ts` was also updated (not in task scope but required for compilation)

### Task 2

- [ ] Verify `forcePathStyle: true` is set in `src/lib/minio.ts`
- [ ] Verify catch block in `POST /:id/photos` cleans up MinIO objects on transaction failure
- [ ] Verify presigned URLs use default 3600s expiry (not cached indefinitely)
- [ ] Verify no `serveStatic` import remains in `src/index.ts`
- [ ] Note: existing photos previously stored on disk under `uploads/` are not migrated (acceptable for development)
