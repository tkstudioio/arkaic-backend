# Arkaic Backend

TypeScript backend API (Hono + Prisma + PostgreSQL + MinIO) for a Bitcoin escrow marketplace based on the Ark protocol (mutinynet). Buyers and sellers negotiate through chat and offers, then finalize trades through a multi-signature escrow flow with two paths: collaborative (both sign) and refund (timelock).

**Full documentation:** See [`docs/`](docs/) for detailed guides on endpoints, flows, and data model.

## Stack

- **Framework:** Hono (lightweight web framework, ESM-only)
- **Database:** Prisma + PostgreSQL
- **Object Storage:** MinIO/S3 (AWS SDK client, presigned URLs for secure photo access)
- **Crypto:** `@noble/curves/secp256k1` (Schnorr signatures), `@arkade-os/sdk` (Ark Bitcoin primitives)
- **Runtime:** Node.js with `@hono/node-server`

## Requirements

- Node.js 18+
- npm
- PostgreSQL (for database)
- MinIO (for object storage)

## Getting Started

### Option 1: Using Docker Compose (Recommended)

The simplest way to run the backend locally with PostgreSQL and MinIO:

```bash
docker-compose up -d
```

This starts:

- **PostgreSQL** on `127.0.0.1:5432` (user: `arkaic`, password: `arkaic`)
- **MinIO** on `127.0.0.1:9000` (access key: `minioadmin`, secret key: `minioadmin`)
- **MinIO Console** on `http://127.0.0.1:9001` (for bucket management)
- **Adminer** on `http://127.0.0.1:8080` (optional, for database browsing)

### Option 2: Manual Setup

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Server runs on `http://localhost:3000`.

### Environment Configuration

Create `.env.local` in the project root:

```env
PORT=3000
DATABASE_URL="postgresql://arkaic:arkaic@127.0.0.1:5432/arkaic"
JWT_SECRET="your-secret-here"
MINIO_ENDPOINT="http://127.0.0.1:9000"
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"
MINIO_BUCKET="arkaic"
SERVER_PRIVKEY="your-server-private-key-hex"
```

**Environment Variables:**

| Variable           | Description                                     | Default                 |
| ------------------ | ----------------------------------------------- | ----------------------- |
| `PORT`             | Server port                                     | `3000`                  |
| `DATABASE_URL`     | PostgreSQL connection string                    | (required)              |
| `JWT_SECRET`       | Secret key for JWT signing/verification (HS256) | (required)              |
| `SERVER_PRIVKEY`   | Server private key (hex) for escrow signatures  | (required)              |
| `MINIO_ENDPOINT`   | MinIO/S3 endpoint URL                           | `http://127.0.0.1:9000` |
| `MINIO_ACCESS_KEY` | MinIO access key                                | `minioadmin`            |
| `MINIO_SECRET_KEY` | MinIO secret key                                | `minioadmin`            |
| `MINIO_BUCKET`     | MinIO bucket name for photo storage             | `arkaic`                |

**MinIO Setup Notes:**

- The backend automatically creates the MinIO bucket on startup if it doesn't exist
- Photos are stored with the key pattern: `listings/<listing_id>/<timestamp>-<uuid>.<ext>`
- Presigned URLs are generated for secure, time-limited photo access (default 1 hour)
- The MinIO Console (port 9001) allows manual bucket/object management and credential changes
- For production, use a dedicated MinIO instance or AWS S3 by configuring `MINIO_ENDPOINT` accordingly

## Primary Flows

### Collaborative Release Flow

Buyer and seller cooperate to release funds to the seller:

1. Buyer creates escrow and sends funds to the escrow address
2. Seller requests PSBT, signs, and submits
3. Buyer receives PSBT, fully signs, and submits to Ark
4. Buyer signs checkpoints; seller retrieves them and finalizes
5. Funds released to seller

**Documentation:** [docs/flow-collaborative-release.md](docs/flow-collaborative-release.md)

### Refund Flow

Buyer recovers funds if seller disappears or after timelock expiration:

1. Buyer requests refund PSBT
2. Buyer signs and submits to Ark
3. Buyer signs checkpoint
4. Buyer finalizes
5. Funds returned to buyer

**Documentation:** [docs/flow-refund.md](docs/flow-refund.md)

## API Reference

All endpoints require Bearer token authentication except for `/api/auth/register`, `/api/auth/challenge`, and `/api/auth/login`.

### Authentication

| Method | Endpoint              | Description                                      |
| ------ | --------------------- | ------------------------------------------------ |
| POST   | `/api/auth/register`  | Register account with Schnorr signature          |
| POST   | `/api/auth/challenge` | Request challenge (nonce) for login              |
| POST   | `/api/auth/login`     | Complete login with nonce and signature, get JWT |

[Full details](docs/api-auth.md)

### Listings

| Method | Endpoint                     | Description                                                                          |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------ |
| GET    | `/api/listings`              | List active listings (excluding own, with active escrows) with photos and pagination |
| POST   | `/api/listings`              | Create new listing with optional category and attributes                             |
| PATCH  | `/api/listings/:id`          | Update listing (name, price, description, category, attributes)                      |
| GET    | `/api/listings/my-listings`  | List your own listings                                                               |
| GET    | `/api/listings/my-purchases` | List listings where you were buyer (completed escrows)                               |
| GET    | `/api/listings/:id`          | Get specific listing details with attributes and photos                              |

[Full details](docs/api-listings.md)

### Photo Management

| Method | Endpoint                                | Description                                         |
| ------ | --------------------------------------- | --------------------------------------------------- |
| POST   | `/api/listings/:id/photos`              | Upload photos to listing (max 10 photos, 4 MB each) |
| DELETE | `/api/listings/:id/photos/:photoId`     | Delete a photo                                      |
| PATCH  | `/api/listings/:id/photos/order`        | Reorder photos (change position)                    |
| GET    | `/api/listings/:id/photos/:photoId/url` | Get presigned URL for secure photo access           |

[Full details](docs/api-photos.md)

### Attributes

Flexible attribute system supporting six types: **select** (predefined single value), **boolean** (yes/no flag), **text** (free-form text), **range** (numeric with min/max), **date** (ISO 8601), and **multi_select** (multiple predefined values).

| Method | Endpoint                          | Description                                                       |
| ------ | --------------------------------- | ----------------------------------------------------------------- |
| GET    | `/api/attributes`                 | List all attributes with predefined values and metadata           |
| GET    | `/api/attributes/by-category/:id` | Attributes applicable to a category with required/filterable info |
| GET    | `/api/attributes/filters/:id`     | Filterable attributes with values actually used in listings       |

When creating or updating listings, provide the appropriate field for each attribute type:

- `select`: `valueId` (single predefined value)
- `boolean`: `valueBool` (true/false)
- `text`: `valueText` (free-form string)
- `range`: `valueText` (numeric value within bounds)
- `date`: `valueText` (YYYY-MM-DD format)
- `multi_select`: `valueIds` (array of predefined value IDs)

Filterable attributes can be used with `GET /api/listings` query parameters: `attr_<id>=<value>` for select/multi*select, `attr*<id>=true|false`for boolean, and`attr\_<id>=<min>,<max>` for range.

[Full documentation](docs/api-attributes.md)

### Categories

| Method | Endpoint                | Description                                             |
| ------ | ----------------------- | ------------------------------------------------------- |
| GET    | `/api/categories`       | List root categories (top level)                        |
| GET    | `/api/categories/:slug` | List subcategories and attributes of a category by slug |

[Full details](docs/api-categories.md)

### Chat

| Method | Endpoint                       | Description                                        |
| ------ | ------------------------------ | -------------------------------------------------- |
| GET    | `/api/chats`                   | List user chats (buyer and seller) with pagination |
| POST   | `/api/chats/:listingId`        | Start chat with seller                             |
| GET    | `/api/chats/:chatId`           | Get chat details with messages                     |
| GET    | `/api/chats/:chatId/escrow`    | Get escrow associated with chat                    |
| GET    | `/api/chats/:chatId/offer`     | Get last valid offer                               |
| GET    | `/api/chats/seller/:listingId` | Get chats where you are seller                     |

[Full details](docs/api-chats.md)

### Favorites

| Method | Endpoint                    | Description                            |
| ------ | --------------------------- | -------------------------------------- |
| GET    | `/api/favorites`            | List favorite listings with pagination |
| POST   | `/api/favorites/:listingId` | Add listing to favorites (idempotent)  |
| DELETE | `/api/favorites/:listingId` | Remove listing from favorites          |

[Full details](docs/api-favorites.md)

### Messages and Offers

| Method | Endpoint                                        | Description           |
| ------ | ----------------------------------------------- | --------------------- |
| POST   | `/api/messages/:chatId`                         | Send message or offer |
| POST   | `/api/messages/:chatId/offers/:offerId/respond` | Accept/reject offer   |
| GET    | `/api/messages/:chatId/offers/active`           | Get current offer     |

[Full details](docs/api-messages.md)

### Escrow and Payment Flows

| Method                 | Endpoint                                                            | Description                                            |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| POST                   | `/api/escrows/:chatId`                                              | Create escrow after offer accepted                     |
| GET                    | `/api/escrows/:chatId`                                              | Get escrow details by chat                             |
| GET                    | `/api/escrows/address/:address`                                     | Get escrow details by address (updates funding status) |
| **Collaborative Path** |                                                                     |                                                        |
| GET                    | `/api/escrows/address/:address/collaborate/seller-psbt`             | Seller requests PSBT                                   |
| POST                   | `/api/escrows/address/:address/collaborate/seller-submit-psbt`      | Seller submits signed PSBT                             |
| GET                    | `/api/escrows/address/:address/collaborate/buyer-psbt`              | Buyer receives PSBT                                    |
| POST                   | `/api/escrows/address/:address/collaborate/buyer-submit-psbt`       | Buyer submits signed PSBT to Ark                       |
| POST                   | `/api/escrows/address/:address/collaborate/buyer-sign-checkpoints`  | Buyer signs checkpoint                                 |
| GET                    | `/api/escrows/address/:address/collaborate/seller-checkpoints`      | Seller receives checkpoint                             |
| POST                   | `/api/escrows/address/:address/collaborate/seller-sign-checkpoints` | Seller finalizes (on-chain)                            |
| **Refund Path**        |                                                                     |                                                        |
| GET                    | `/api/escrows/address/:address/refund/psbt`                         | Buyer requests refund PSBT                             |
| POST                   | `/api/escrows/address/:address/refund/submit-signed-psbt`           | Buyer submits PSBT to Ark                              |
| POST                   | `/api/escrows/address/:address/refund/finalize`                     | Buyer finalizes refund (on-chain)                      |

[Full details](docs/api-escrows.md)

### WebSocket

| Method | Endpoint          | Description                           |
| ------ | ----------------- | ------------------------------------- |
| GET    | `/ws?token=<JWT>` | WebSocket for real-time notifications |

Events: `new_message`, `new_offer`, `offer_accepted`, `offer_rejected`, `escrow_update`

[Full details](docs/api-websocket.md)

## Data Model

The database uses PostgreSQL via Prisma ORM. Key entities:

- **Account:** Users identified by Schnorr public key
- **Listing:** Products for sale with name, price, and seller
- **ListingPhoto:** Photos attached to listings, stored in MinIO with presigned URLs
- **Chat:** Conversation between buyer and seller for a listing
- **Message:** Messages and offers within a chat
- **Offer/OfferAcceptance:** Price proposal and seller response
- **Escrow:** Multi-signature contract holding funds
- **Review:** Post-transaction ratings

[Full schema](docs/data-model.md)

## Architecture

```
src/
  index.ts              # Entry point: mounts router, ensures MinIO bucket
  routes/
    api/
      index.ts          # API sub-router composition
      auth.ts           # Authentication and login
      listings.ts       # Listing CRUD
      photos.ts         # Photo management (MinIO-backed)
      chats.ts          # Chat management
      messages.ts       # Messages and offers
      escrows.ts        # Escrow and payment flows
    ws.ts               # WebSocket for notifications
  lib/
    auth.ts             # Authentication middleware
    escrow.ts           # PSBT builder and context
    ark.ts              # Ark provider (REST API)
    prisma.ts           # Singleton Prisma client
    minio.ts            # MinIO/S3 client library (upload, delete, presigned URLs)
  generated/
    prisma/             # Generated Prisma client (auto)
prisma/
  schema.prisma         # PostgreSQL schema
```

## Operational Notes

- **Network:** Uses mutinynet Ark (`https://mutinynet.arkade.sh`)
- **Public Key:** Hex-encoded, 33-byte compressed or 32-byte x-only
- **Prices:** In satoshis (1 BTC = 100,000,000 sats)
- **JWT:** Token valid for 1 hour, included as `Authorization: Bearer <TOKEN>`
- **Schnorr Signatures:** All critical data is signed for non-repudiation
- **Escrow Address:** Deterministic based on (buyer, seller, timelock) tuple
- **CLTV Timelock:** Embedded in refund path, immutable after escrow creation
- **Photo Storage:** All listing photos are stored in MinIO with server-signed presigned URLs for secure, time-limited access
- **MinIO Bucket:** Automatically created on server startup; object key pattern: `listings/<listing_id>/<timestamp>-<uuid>.<ext>`
