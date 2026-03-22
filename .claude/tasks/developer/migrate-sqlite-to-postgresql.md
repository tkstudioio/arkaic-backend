# Task: Migrate from SQLite to PostgreSQL

## Context

The project currently uses SQLite via `better-sqlite3` as its database engine through Prisma ORM. To prepare for production deployment and enable concurrent access, the database must be migrated to PostgreSQL. A PostgreSQL instance will be added to the existing `docker-compose.yml` alongside the MinIO service.

## Objective

Replace the SQLite database driver with PostgreSQL across the entire stack: Prisma schema, Prisma client initialization, seed script, Prisma config, environment variables, package dependencies, and docker-compose infrastructure.

## File involved

| File                           | Action                                                            |
| ------------------------------ | ----------------------------------------------------------------- |
| `docker-compose.yml`           | Modify: add PostgreSQL service                                    |
| `prisma/schema.prisma`         | Modify: change datasource provider                                |
| `prisma.config.ts`             | Modify: no changes needed (already reads `DATABASE_URL` from env) |
| `src/lib/prisma.ts`            | Modify: remove better-sqlite3 adapter, use direct PrismaClient    |
| `prisma/seed.ts`               | Modify: remove better-sqlite3 adapter, use direct PrismaClient    |
| `package.json`                 | Modify: remove better-sqlite3 adapter dep, add pg adapter dep     |
| `.env.example`                 | Modify: update DATABASE_URL example value                         |
| `.env.local`                   | Modify: update DATABASE_URL to PostgreSQL connection string       |
| `prisma/migrations/`           | Delete all existing migration files (SQLite-specific SQL)         |
| `.claude/docs/architecture.md` | Modify: update database references                                |
| `.claude/docs/packages.md`     | Modify: update prisma.ts description                              |
| `.claude/docs/environment.md`  | Modify: update database section and dependency table              |

## Implementation

### Step 1 -- Add PostgreSQL to docker-compose.yml

Add a `postgres` service to the existing `docker-compose.yml`. Place it before the `minio` service. Add a `postgres-data` named volume.

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: arkaic-postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: arkaic
      POSTGRES_PASSWORD: arkaic
      POSTGRES_DB: arkaic
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped

  minio:
    # ... existing minio config unchanged ...

volumes:
  postgres-data:
  minio-data:
```

### Step 2 -- Update Prisma schema datasource

In `prisma/schema.prisma`, change the datasource block from:

```prisma
datasource db {
  provider = "sqlite"
}
```

to:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Keep the generator block exactly as-is. Keep all models exactly as-is -- the schema is already PostgreSQL-compatible (Prisma handles the type mapping automatically; `Int`, `String`, `Boolean`, `DateTime`, `Float` all map correctly; enums are natively supported in PostgreSQL).

### Step 3 -- Update package.json dependencies

Remove the SQLite adapter package and add the PostgreSQL adapter:

```bash
npm uninstall @prisma/adapter-better-sqlite3
npm install @prisma/adapter-pg
```

**Important:** After Prisma 7.x with PostgreSQL, the `@prisma/adapter-pg` package is the correct adapter. However, since Prisma 7.x supports PostgreSQL natively without a driver adapter when using the built-in `@prisma/client` with a `postgresql` datasource, the adapter is **not required**. The simplest approach is to remove `@prisma/adapter-better-sqlite3` and use PrismaClient directly without any adapter (Prisma's built-in PostgreSQL driver handles everything).

Run:

```bash
npm uninstall @prisma/adapter-better-sqlite3
```

No new adapter package is needed -- Prisma 7.x handles PostgreSQL connections natively via the `url` in the datasource.

### Step 4 -- Update src/lib/prisma.ts

Replace the entire file content with:

```typescript
import { PrismaClient } from "@/generated/prisma/client";

export const prisma = new PrismaClient();
```

The `DATABASE_URL` environment variable is read automatically by Prisma from the datasource block in the schema. No adapter is needed for PostgreSQL.

### Step 5 -- Update prisma/seed.ts

Replace the import and client initialization at the top of the file. Change:

```typescript
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({
  url: process.env["DATABASE_URL"] ?? "file:./dev.db",
});

const prisma = new PrismaClient({ adapter });
```

to:

```typescript
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();
```

Leave the rest of the seed file completely unchanged.

### Step 6 -- Update environment files

In `.env.example`, change:

```
DATABASE_URL="file:./dev.db"
```

to:

```
DATABASE_URL="postgresql://arkaic:arkaic@127.0.0.1:5432/arkaic"
```

In `.env.local`, set the same value (or the user's preferred credentials):

```
DATABASE_URL="postgresql://arkaic:arkaic@127.0.0.1:5432/arkaic"
```

### Step 7 -- Delete existing SQLite migrations

All files under `prisma/migrations/` contain SQLite-specific SQL. They must be deleted so Prisma can create a fresh baseline migration for PostgreSQL.

```bash
rm -rf prisma/migrations/
```

### Step 8 -- Generate fresh PostgreSQL migration

Start the PostgreSQL container, then create a fresh migration:

```bash
docker compose up -d postgres
npx prisma migrate dev --name init
```

This will:

1. Create a new `prisma/migrations/` directory
2. Generate the initial PostgreSQL migration SQL
3. Apply it to the database
4. Regenerate the Prisma client in `src/generated/prisma/`

### Step 9 -- Run the seed

```bash
npx prisma db seed
```

Verify the seed completes without errors.

### Step 10 -- Verify the application starts

```bash
npm run dev
```

Confirm the server starts on port 3000 and can accept requests. Test a simple endpoint like `POST /api/auth/challenge`.

### Step 11 -- Update documentation

**`.claude/docs/architecture.md`** -- line 16, change:

```
- **Database:** SQLite via Prisma con `better-sqlite3` adapter
```

to:

```
- **Database:** PostgreSQL via Prisma ORM
```

**`.claude/docs/packages.md`** -- in the `prisma.ts` section, change:

```
Singleton `PrismaClient` con adapter `better-sqlite3`. Importa da `@/lib/prisma`.
```

to:

```
Singleton `PrismaClient` for PostgreSQL. Import from `@/lib/prisma`.
```

**`.claude/docs/environment.md`** -- multiple changes:

1. In the Technology Stack section, change:

   ```
   - **Prisma** 7.4+ con `better-sqlite3` adapter (SQLite)
   ```

   to:

   ```
   - **Prisma** 7.4+ with PostgreSQL
   ```

2. In the dependency table, remove the row for `@prisma/adapter-better-sqlite3`.

3. In the Environment Variables table, change the DATABASE_URL description:

   ```
   | `DATABASE_URL` | Path database SQLite (default: `file:./dev.db`) |
   ```

   to:

   ```
   | `DATABASE_URL` | PostgreSQL connection string (e.g., `postgresql://arkaic:arkaic@127.0.0.1:5432/arkaic`) |
   ```

4. In the Database section, change:
   ```
   - **Engine:** SQLite via `better-sqlite3`
   ```
   to:
   ```
   - **Engine:** PostgreSQL
   ```

## Constraints

- ESM only, use `@/` path alias for imports within `src/`
- Do NOT modify any model definitions in `prisma/schema.prisma` -- only the `datasource` block changes
- Do NOT modify the `generator` block
- Do NOT modify `prisma.config.ts` (it already reads `DATABASE_URL` from env via dotenv)
- The `.gitignore` already excludes `.env.local` and `*.db` files -- no changes needed
- Delete the existing `prisma/migrations/` content before running `migrate dev`

## Acceptance criteria

- `docker compose up -d postgres` starts a PostgreSQL 17 container on port 5432
- `prisma/schema.prisma` datasource provider is `"postgresql"` with `url = env("DATABASE_URL")`
- `src/lib/prisma.ts` creates a `PrismaClient` without any adapter
- `prisma/seed.ts` creates a `PrismaClient` without any adapter
- `@prisma/adapter-better-sqlite3` is removed from `package.json`
- `npx prisma migrate dev` succeeds and creates a fresh PostgreSQL migration
- `npx prisma db seed` populates categories and attributes
- `npm run dev` starts the server without errors
- `npx tsc --noEmit` passes without type errors
- Documentation files are updated to reflect PostgreSQL

## Notes for reviewer

- Verify that all `autoincrement()` IDs work correctly with PostgreSQL's `SERIAL` type (Prisma handles this automatically)
- Verify that `DateTime @default(now())` maps to `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` in PostgreSQL
- Verify that the enums `ChatStatus`, `EscrowStatus`, `AttributeType` are created as PostgreSQL native enums in the migration SQL
- Verify that `@@unique` constraints and `@@index` directives are properly translated
- Confirm no leftover references to `better-sqlite3` or `sqlite` exist in the codebase (search for both strings)
