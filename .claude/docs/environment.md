# Environment & Infrastructure

> **Audience**: All agents

## Package Manager

**Usa `npm` (mai `yarn`).**

---

## Commands

```bash
# Avvio dev server (porta 3000, hot reload)
npm run dev

# Type-check
npx tsc --noEmit

# Genera Prisma client
npx prisma generate

# Crea/applica migration Prisma
npx prisma migrate dev

# Installa dipendenze
npm install
```

---

## Technology Stack

- **Hono** 4.12+ (web framework)
- **Node.js** con `@hono/node-server` (runtime)
- **TypeScript** strict mode, ESNext, bundler module resolution
- **Prisma** 7.4+ with PostgreSQL
- **tsx** (dev runner con hot reload, carica `.env.local`)

### Dipendenze chiave

| Pacchetto                       | Versione | Scopo                                                 |
| ------------------------------- | -------- | ----------------------------------------------------- |
| `@arkade-os/sdk`                | ^0.4.6   | Ark protocol (VtxoScript, tapscript, buildOffchainTx) |
| `hono`                          | ^4.12.5  | Web framework                                         |
| `@hono/node-server`             | ^1.19.11 | Node.js adapter                                       |
| `@hono/node-ws`                 | ^1.3.0   | WebSocket support                                     |
| `@hono/standard-validator`      | ^0.2.2   | Request validation (Zod)                              |
| `@prisma/client`                | ^7.4.2   | Database ORM                                          |
| `@prisma/adapter-pg`            | ^7.4.2   | PostgreSQL driver adapter for Prisma                  |
| `pg`                            | ^8.x     | PostgreSQL client for Node.js                         |
| `@aws-sdk/client-s3`            | ^3.x     | S3-compatible client for MinIO                        |
| `@aws-sdk/s3-request-presigner` | ^3.x     | Presigned URL generation for S3/MinIO                 |
| `@noble/curves`                 | 2.0.0    | Schnorr signature verification                        |
| `@scure/base`                   | ^2.0.0   | hex/base64 encoding                                   |
| `zod`                           | ^4.3.6   | Schema validation                                     |
| `date-fns`                      | ^4.1.0   | Date utilities                                        |
| `lodash`                        | ^4.17.23 | Utility functions                                     |

---

## Environment Variables

Configurate via `.env.local` (caricato automaticamente da tsx):

| Variabile          | Scopo                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------- |
| `JWT_SECRET`       | Secret per firma/verifica JWT HS256                                                     |
| `DATABASE_URL`     | PostgreSQL connection string (e.g., `postgresql://arkaic:arkaic@127.0.0.1:5432/arkaic`) |
| `SERVER_PRIVKEY`   | Chiave privata del server per firme escrow                                              |
| `MINIO_ENDPOINT`   | MinIO/S3 endpoint URL (default: `http://127.0.0.1:9000`)                                |
| `MINIO_ACCESS_KEY` | MinIO access key (default: `minioadmin`)                                                |
| `MINIO_SECRET_KEY` | MinIO secret key (default: `minioadmin`)                                                |
| `MINIO_BUCKET`     | MinIO bucket name (default: `arkaic`)                                                   |

---

## Database

- **Engine:** PostgreSQL
- **Schema:** `prisma/schema.prisma`
- **Client generato:** `src/generated/prisma/` (non modificare manualmente)
- **Migration:** `prisma/migrations/`

Per rigenerare il client dopo modifiche allo schema:

```bash
npx prisma migrate dev    # crea migration + rigenera client
npx prisma generate       # solo rigenera client (no migration)
```

---

## Ark Protocol (mutinynet)

Il backend si connette all'Ark server su `https://mutinynet.arkade.sh`:

- `RestArkProvider` — submit/finalize transazioni
- `RestIndexerProvider` — query VTXO per script
- `EsploraProvider` — chain tip per network time

**Nota:** mutinynet e' una testnet. Le transazioni non coinvolgono fondi reali.

---

## Git Hooks

**Husky** is configured (`"prepare": "husky"` in package.json) with **lint-staged** for pre-commit hooks:

- `*.{ts,tsx}` files: `eslint --fix` + `prettier --write`
- `*.{json,md}` files: `prettier --write`

---

## Commit Convention

Formato `type(scope): description`:

### Valid Types

| Type       | Description                                |
| ---------- | ------------------------------------------ |
| `feat`     | New feature                                |
| `fix`      | Bug fix                                    |
| `refactor` | Code restructuring without behavior change |
| `chore`    | Maintenance tasks                          |
| `docs`     | Documentation only                         |
| `perf`     | Performance improvement                    |
| `test`     | Adding or updating tests                   |
| `ci`       | CI/CD configuration                        |
| `build`    | Build system changes                       |
| `style`    | Formatting changes                         |
| `revert`   | Reverts a previous commit                  |

### Valid Scopes

| Scope    | Quando               |
| -------- | -------------------- |
| `routes` | Route handler        |
| `escrow` | Flusso escrow        |
| `auth`   | Autenticazione       |
| `ws`     | WebSocket            |
| `prisma` | Schema/client Prisma |
| `lib`    | Helper/utility       |
| `deps`   | Dipendenze           |

### Esempi

```
feat(routes): add dispute resolution endpoint
fix(escrow): correct timelock validation in refund flow
refactor(auth): extract JWT verification into helper
chore(prisma): add index on escrow address field
```
