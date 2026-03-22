# Code Review Report

**Date:** 2026-03-22
**Task:** Migrate SQLite to PostgreSQL + Integrate MinIO Object Storage
**Branch:** master
**Files analyzed:** 18 modified/new files (full reads on all source, config, schema, migration, docker-compose, task docs, and documentation files)

## Executive Summary

The changeset migrates the database engine from SQLite (better-sqlite3) to PostgreSQL and replaces local filesystem photo storage with MinIO S3-compatible object storage. The implementation is well-executed, cleanly removes all SQLite and local-fs references, and follows existing project conventions closely. There are no blocking security issues. A few minor issues were found: `@types/pg` is misplaced in `dependencies` instead of `devDependencies`, `MINIO_BUCKET` is typed as `string | undefined` but used where `string` is required (runtime guard exists but TypeScript does not narrow it), the `ensureBucket()` function catches all errors rather than just "bucket not found", and the documentation has a stale claim about Git hooks.

## Verdict

APPROVED WITH NOTES -- Minor issues found; merge is possible but the noted fixes are recommended.

---

## Blocking Issues

None.

---

## Minor Issues

### [M-001] `@types/pg` in dependencies instead of devDependencies

- **Severity:** Minor
- **File:** `package.json:31`
- **Description:** `@types/pg` is a type-definition package that provides no runtime code. It belongs in `devDependencies` alongside `@types/lodash` and `@types/node`.
- **Suggestion:** Move `@types/pg` to `devDependencies`:
  ```bash
  npm install --save-dev @types/pg
  ```

### [M-002] `MINIO_BUCKET` exported as `string | undefined`

- **Severity:** Minor
- **File:** `src/lib/minio.ts:12-14`
- **Description:** `MINIO_BUCKET` is declared as `process.env.MINIO_BUCKET` which TypeScript types as `string | undefined`. The guard on line 14 throws if it is falsy, but TypeScript cannot narrow the type of a module-level `const` based on a later conditional throw. This means `MINIO_BUCKET` is `string | undefined` at every call site (S3 commands, `ensureBucket()` in `src/index.ts`). It compiles because the AWS SDK `Bucket` param accepts `string | undefined`, but this is semantically incorrect and could mask bugs.
- **Problematic code:**
  ```typescript
  export const MINIO_BUCKET = process.env.MINIO_BUCKET;
  ```
- **Suggested fix:**
  ```typescript
  const bucket = process.env.MINIO_BUCKET;
  if (!MINIO_ENDPOINT || !bucket || !MINIO_SECRET_KEY || !MINIO_ACCESS_KEY)
    throw new Error("Missing MINIO configuration");
  export const MINIO_BUCKET: string = bucket;
  ```
  Or use a non-null assertion after the guard: `export const MINIO_BUCKET = process.env.MINIO_BUCKET!;` (less safe but acknowledged by the guard).

### [M-003] `ensureBucket()` catches all errors, not just "bucket not found"

- **Severity:** Minor
- **File:** `src/index.ts:19-25`
- **Description:** The `ensureBucket()` function catches any error from `HeadBucketCommand` (including network errors, authentication failures, etc.) and attempts to create the bucket. If MinIO is unreachable, the `HeadBucketCommand` will throw a network error, then `CreateBucketCommand` will also throw a network error, and the server will fail to start. The behavior is acceptable in practice, but the catch block is overly broad. A `403 AccessDenied` from `HeadBucket` (credentials issue) would incorrectly lead to a `CreateBucket` attempt.
- **Suggested improvement:**
  ```typescript
  async function ensureBucket() {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: MINIO_BUCKET }));
    } catch (err: unknown) {
      if (err && typeof err === "object" && "name" in err && err.name === "NotFound") {
        await s3.send(new CreateBucketCommand({ Bucket: MINIO_BUCKET }));
        console.log(`Created MinIO bucket: ${MINIO_BUCKET}`);
      } else {
        throw err;
      }
    }
  }
  ```

### [M-004] `prisma.config.ts` was modified (contradicts task constraint)

- **Severity:** Minor
- **File:** `prisma.config.ts:1-6`
- **Description:** The task plan for `migrate-sqlite-to-postgresql.md` explicitly stated "Do NOT modify `prisma.config.ts`". However, the developer changed the dotenv import from `import "dotenv/config"` to `import dotenv from "dotenv"; dotenv.config({ path: ".env.local" })`. The handoff document does not mention this change or explain why it was necessary. While the change is functionally correct (it loads `.env.local` instead of `.env`), it represents an undocumented deviation from the task plan.
- **Impact:** Low. The change is correct and necessary for the PostgreSQL migration to find the right `DATABASE_URL`. The task plan's constraint was arguably wrong.

### [M-005] `ListingPhoto.filename` field name mismatch with actual content

- **Severity:** Minor
- **File:** `prisma/schema.prisma:284`
- **Description:** The Prisma field is named `filename` but now stores a full MinIO object key (e.g., `listings/42/abc123.jpg`). The task plan acknowledged this trade-off (avoiding a migration), but the field name is misleading. A comment was added to clarify, which is a reasonable mitigation. Consider renaming to `objectKey` in a future migration for clarity.
- **Impact:** Low. The comment adequately documents the semantic change.

---

## Suggestions and Improvements (non-blocking)

### [S-001] Documentation claims "no git hooks" but husky + lint-staged are configured

- **Severity:** Suggestion
- **File:** `.claude/docs/environment.md:108`
- **Description:** The environment documentation states "Nessun hook attivo. Non c'e' Husky o lint-staged configurato." However, `package.json` now contains `"prepare": "husky"` and `lint-staged` configuration, and a previous commit (`8c67406`) added husky, prettier, and eslint. This documentation is stale.

### [S-002] Developer task plan incorrectly stated Prisma 7.x does not need adapter

- **Severity:** Suggestion
- **File:** `.claude/tasks/developer/migrate-sqlite-to-postgresql.md:87-95`
- **Description:** The planner's task incorrectly stated that Prisma 7.x handles PostgreSQL natively without a driver adapter. The developer correctly identified this as wrong (documented in the handoff) and used `@prisma/adapter-pg` instead. This is a good example of the developer exercising judgment. The planner should be aware that Prisma 7.x removed the built-in query engine and always requires an explicit driver adapter.

### [S-003] Photo upload performs MinIO writes inside a Prisma transaction

- **Severity:** Suggestion
- **File:** `src/routes/api/photos.ts:68-91`
- **Description:** MinIO uploads happen inside the `prisma.$transaction()` callback. If a later DB write fails, the catch block cleans up MinIO objects. However, MinIO uploads are not transactional -- if the process crashes between the MinIO upload and the DB commit, orphaned objects will remain in MinIO. This is acceptable for the current scale, but worth noting for future reference. A more robust pattern would upload to MinIO first (outside the transaction), then create DB records, and clean up MinIO on any failure.
- **Impact:** Negligible for development. Worth revisiting for production.

### [S-004] Presigned URL endpoint does not verify listing ownership

- **Severity:** Suggestion
- **File:** `src/routes/api/photos.ts:120-132`
- **Description:** The `GET /:id/photos/:photoId/url` endpoint only checks that the photo exists, not that the requesting user is the buyer/seller or that the listing is public. The task plan explicitly states this is by design ("any authenticated user can request URLs -- photos are for public listings"), and the other listing endpoints already include photos in their responses. This is consistent and acceptable, but worth flagging: if listing visibility rules change (e.g., draft listings), this endpoint would need corresponding access control.

### [S-005] Docker compose uses default admin credentials

- **Severity:** Suggestion
- **File:** `docker-compose.yml` and `.env.example`
- **Description:** Both PostgreSQL (`arkaic:arkaic`) and MinIO (`minioadmin:minioadmin`) use simple default credentials. This is fine for local development. Ensure production deployments use strong credentials and do not rely on `.env.example` values.

---

## Conformity Checklist

| Criterion                          | Status | Notes                                                                                                      |
| ---------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| Path alias `@/` for imports        | PASS   | All `src/` imports use `@/` alias correctly                                                                |
| TypeScript strict (no `any`)       | PASS   | No `any` usage in changed files                                                                            |
| Hono context pattern               | PASS   | `c.json`, `c.text`, `c.req.param` used correctly                                                           |
| bearerAuth + verifySignature       | PASS   | `photos.use(bearerAuth)` applied globally; no `verifySignature` on multipart/GET (correct per conventions) |
| Zod validation (sValidator)        | PASS   | Used on PATCH order endpoint; POST uses manual multipart parsing (appropriate)                             |
| prisma.$transaction() where needed | PASS   | Used for batch photo creation and reorder                                                                  |
| WebSocket notifications            | N/A    | No notification-worthy events in these changes                                                             |
| Query-level authorization          | PASS   | `sellerPubkey: pubkey` in WHERE clauses for upload/delete/reorder                                          |
| State machine escrow respected     | N/A    | No escrow changes                                                                                          |
| Cryptographic security             | N/A    | No crypto changes                                                                                          |
| Error handling consistent          | PASS   | `c.text()` for simple errors, `c.json()` for structured responses                                          |
| No over-engineering                | PASS   | Clean, minimal implementation without unnecessary abstractions                                             |

---

## Pipeline Analysis

### Planner -> Developer

The developer successfully implemented both tasks with two notable deviations from the planner's instructions:

1. **Prisma adapter:** The planner incorrectly stated that Prisma 7.x does not need a driver adapter for PostgreSQL. The developer correctly identified this as wrong and used `@prisma/adapter-pg`. This is documented in the handoff.

2. **Schema URL field:** The planner instructed adding `url = env("DATABASE_URL")` to the schema's datasource block. The developer correctly identified that Prisma 7.4.2 rejects this and keeps the URL only in `prisma.config.ts`. This is documented in the handoff.

3. **prisma.config.ts modification:** The planner said not to modify this file, but the developer changed the dotenv import. This deviation was necessary but not documented in the handoff's deviation section.

4. **backfill-listing-categories.ts:** Not mentioned in the planner's task but correctly updated by the developer (compilation would have failed otherwise). Documented in the handoff.

Overall, the developer showed good judgment in deviating from incorrect planner instructions and documented the reasons clearly. The handoff document is thorough and includes a reviewer checklist.

---

## Modified Files -- Detail

| File                                                  | Change Type             | Verdict                                                                      |
| ----------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `docker-compose.yml`                                  | new                     | PASS - Clean compose file with postgres, minio, adminer                      |
| `src/lib/minio.ts`                                    | new                     | PASS with note (M-002: type narrowing)                                       |
| `src/lib/prisma.ts`                                   | refactor                | PASS - Clean adapter swap                                                    |
| `src/index.ts`                                        | refactor                | PASS with note (M-003: broad catch)                                          |
| `src/routes/api/photos.ts`                            | refactor + new endpoint | PASS - Clean MinIO integration                                               |
| `prisma/schema.prisma`                                | config change           | PASS with note (M-005: field name)                                           |
| `prisma.config.ts`                                    | config change           | PASS with note (M-004: undocumented)                                         |
| `prisma/seed.ts`                                      | refactor                | PASS - Adapter swap                                                          |
| `prisma/backfill-listing-categories.ts`               | refactor                | PASS - Adapter swap                                                          |
| `prisma/migrations/20260322165027_init/migration.sql` | new                     | PASS - Correct PostgreSQL DDL with enums, SERIAL, TIMESTAMP, all constraints |
| `prisma/migrations/migration_lock.toml`               | config change           | PASS - postgresql provider                                                   |
| `package.json`                                        | dependency change       | PASS with note (M-001: @types/pg placement)                                  |
| `.env.example`                                        | config change           | PASS                                                                         |
| `.claude/docs/architecture.md`                        | doc update              | PASS                                                                         |
| `.claude/docs/packages.md`                            | doc update              | PASS                                                                         |
| `.claude/docs/environment.md`                         | doc update              | PASS with note (S-001: stale hooks section)                                  |
| `.claude/tasks/developer/*.md`                        | task docs               | PASS - Thorough documentation                                                |
| `package-lock.json` / `yarn.lock`                     | lockfiles               | PASS - Consistent with package.json changes                                  |
