# Authentication Endpoints

Authentication endpoints provide challenge-response Schnorr signature verification for user registration and JWT-based login flows. The system uses public key cryptography for all authentication.

## Authentication Model

Authentication is based on Schnorr signatures over messages containing username, pubkey, and/or nonce values. The backend verifies signatures using the account's public key. Upon successful login, a JWT token is issued (valid for 1 hour) that must be included in subsequent API requests via `Authorization: Bearer <TOKEN>` header.

---

## `POST /api/auth/register`

Register a new account or update existing account username.

**Autenticazione:** Schnorr signature (no Bearer token required)
**Rate limit:** None specified in code

### Request

```json
{
  "pubkey": "string — hex-encoded public key (33-byte compressed or 32-byte x-only)",
  "username": "string — desired username for the account",
  "signature": "string — hex-encoded Schnorr signature over `username pubkey`"
}
```

The signature must be a valid Schnorr signature over the message: `<username> <pubkey>` (space-separated). The public key is converted to x-only format (32 bytes) for verification.

### Response (200)

```json
{
  "pubkey": "string — registered public key",
  "username": "string — registered username",
  "createdAt": "ISO 8601 datetime — account creation time",
  "isArbiter": "boolean — whether account is marked as arbiter (default false)"
}
```

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 400    | Missing or invalid JSON schema (missing pubkey, username, or signature) |
| 401    | Invalid signature — does not verify against the provided pubkey |

### Esempio curl

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "pubkey": "02abcd...",
    "username": "alice",
    "signature": "deadbeef..."
  }'
```

---

## `POST /api/auth/challenge`

Request a challenge (nonce) to be signed for login. The nonce is valid for 30 seconds.

**Autenticazione:** None (public endpoint)
**Rate limit:** None specified in code

### Request

```json
{
  "pubkey": "string — hex-encoded public key"
}
```

### Response (200)

```json
{
  "nonce": "string — hex-encoded 32-byte random nonce",
  "pubkey": "string — the requested pubkey",
  "expiry": "ISO 8601 datetime — challenge expiry time (30 seconds from now)"
}
```

The nonce should be signed by the client and included in the `/api/auth/login` request.

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 400    | Missing or invalid JSON schema |

### Esempio curl

```bash
curl -X POST http://localhost:3000/api/auth/challenge \
  -H "Content-Type: application/json" \
  -d '{
    "pubkey": "02abcd..."
  }'
```

---

## `POST /api/auth/login`

Complete the login flow by providing a signed challenge. Returns a JWT token valid for 1 hour.

**Autenticazione:** Schnorr signature (no Bearer token required)
**Rate limit:** None specified in code

### Request

```json
{
  "pubkey": "string — hex-encoded public key",
  "nonce": "string — hex-encoded nonce from /challenge endpoint",
  "signature": "string — hex-encoded Schnorr signature over `nonce pubkey`"
}
```

The signature must be a valid Schnorr signature over the message: `<nonce> <pubkey>` (space-separated). The nonce must match a valid, non-expired challenge previously obtained from `/api/auth/challenge`.

### Response (200)

Returns a JWT token as plain text (Content-Type: text/plain):

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

The token payload contains:
- `sub` (subject): the user's pubkey
- `iat` (issued at): Unix timestamp of token creation
- `exp` (expiration): Unix timestamp of token expiry (iat + 3600 seconds)

Include this token in subsequent API requests as: `Authorization: Bearer <TOKEN>`

### Errori

| Status | Descrizione |
| ------ | ----------- |
| 400    | Missing or invalid JSON schema |
| 401    | Invalid nonce — nonce does not exist or was already used |
| 401    | Wrong pubkey — pubkey does not match the one associated with the nonce |
| 401    | Challenge expired — challenge has exceeded the 30-second validity window |
| 401    | Invalid signature — does not verify against the provided pubkey |

### Esempio curl

First, request a challenge:

```bash
CHALLENGE=$(curl -X POST http://localhost:3000/api/auth/challenge \
  -H "Content-Type: application/json" \
  -d '{"pubkey": "02abcd..."}')

NONCE=$(echo $CHALLENGE | jq -r '.nonce')
```

Then sign the nonce and login:

```bash
TOKEN=$(curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{
    \"pubkey\": \"02abcd...\",
    \"nonce\": \"$NONCE\",
    \"signature\": \"<signed_nonce_pubkey>\"
  }")

echo $TOKEN
```

Use the token in subsequent requests:

```bash
curl -X GET http://localhost:3000/api/listings \
  -H "Authorization: Bearer $TOKEN"
```

---

## Authentication Flow Summary

1. **Register** (optional, if new account):
   - POST `/api/auth/register` with pubkey, username, and Schnorr signature over `username pubkey`
   - Receive Account object

2. **Request Challenge**:
   - POST `/api/auth/challenge` with pubkey
   - Receive nonce (valid 30 seconds)

3. **Sign Challenge**:
   - Client creates Schnorr signature over `nonce pubkey`

4. **Login**:
   - POST `/api/auth/login` with pubkey, nonce, and signature
   - Receive JWT token

5. **Use Token**:
   - Include `Authorization: Bearer <TOKEN>` in all subsequent authenticated requests
   - Token valid for 1 hour

---

## Notes

- All pubkeys in the system are hex-encoded strings
- Schnorr signatures are hex-encoded 64-byte signatures
- The JWT_SECRET environment variable must be set for the server to start
- If JWT_SECRET is missing, the server will crash on startup
- Signature verification uses the `@noble/curves/secp256k1` library
- The `verifySignature` middleware automatically extracts and validates request signatures for protected endpoints
