# WebSocket API

WebSocket provides real-time bidirectional notifications to keep clients synchronized with marketplace events (new messages, offers, escrow updates, etc.).

## Connection

**Endpoint:** `GET /ws`

**Query parameters:**

```
GET /ws?token=<JWT_TOKEN>
```

- `token`: Required. JWT token obtained from `/api/auth/login`

**Upgrade:** HTTP/101 Switching Protocols (WebSocket upgrade)

### Connection Flow

1. Client sends HTTP GET request to `/ws?token=<JWT_TOKEN>`
2. Server verifies JWT signature and extracts `sub` (user's pubkey)
3. Server responds with HTTP 101 upgrade
4. WebSocket connection established

### Authentication Failure

If token is invalid or missing:
- Server closes connection with code 1008 (policy violation)
- Reason: "Unauthorized"

### Successful Connection

Upon successful connection, server immediately sends a hello message:

```json
{
  "type": "hello",
  "pubkey": "string — connected user's pubkey"
}
```

---

## Message Types

All WebSocket messages are JSON objects with a `type` field. This section documents all possible message types from server to client.

### `new_message`

Sent when a new message is posted in a chat involving the user.

```json
{
  "type": "new_message",
  "chatId": "number — chat ID where message was posted"
}
```

**Trigger:** POST `/api/messages/:chatId` (plain message)

**Use case:** Client polls GET `/api/chats/:chatId` to fetch updated messages

---

### `new_offer`

Sent when a buyer makes a price offer in a chat.

```json
{
  "type": "new_offer",
  "chatId": "number — chat ID",
  "price": "number — offered price in satoshi"
}
```

**Trigger:** POST `/api/messages/:chatId` with `offeredPrice`

**Recipients:**
- Buyer (who made the offer)
- Seller (listing owner)

**Use case:** Both parties are notified of the new offer and can respond

---

### `offer_accepted`

Sent when seller accepts a price offer.

```json
{
  "type": "offer_accepted",
  "chatId": "number",
  "offerId": "number"
}
```

**Trigger:** POST `/api/messages/:chatId/offers/:offerId/respond` with `accepted: true`

**Recipients:**
- Buyer
- Seller

---

### `offer_rejected`

Sent when seller rejects a price offer.

```json
{
  "type": "offer_rejected",
  "chatId": "number",
  "offerId": "number"
}
```

**Trigger:** POST `/api/messages/:chatId/offers/:offerId/respond` with `accepted: false`

**Recipients:**
- Buyer
- Seller

---

### `escrow_update`

Sent when escrow state changes (creation, status transition, funding, etc.).

```json
{
  "type": "escrow_update",
  "address": "string — escrow Ark address"
}
```

**Triggers:**
- POST `/api/escrows/:chatId` (escrow created)
- POST `/.../collaborate/seller-submit-psbt` (status → sellerReady)
- POST `/.../collaborate/buyer-submit-psbt` (status → buyerSubmitted)
- POST `/.../collaborate/buyer-sign-checkpoints` (status → buyerCheckpointsSigned)
- POST `/.../collaborate/seller-sign-checkpoints` (status → completed)
- POST `/.../refund/finalize` (status → refunded)

**Recipients:**
- Buyer
- Seller

**Use case:** Client polls GET `/api/escrows/address/:address` to fetch updated escrow state

---

## Client Implementation Example

### JavaScript/Node.js

```javascript
const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
const baseUrl = "http://localhost:3000";
const wsUrl = baseUrl.replace(/^http/, "ws");

const ws = new WebSocket(`${wsUrl}/ws?token=${token}`);

ws.addEventListener("open", () => {
  console.log("WebSocket connected");
});

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  switch (message.type) {
    case "hello":
      console.log(`Connected as ${message.pubkey}`);
      break;

    case "new_message":
      console.log(`New message in chat ${message.chatId}`);
      // Fetch updated messages: GET /api/chats/{chatId}
      break;

    case "new_offer":
      console.log(`New offer: ${message.price} sat in chat ${message.chatId}`);
      // Fetch updated offer: GET /api/messages/{chatId}/offers/active
      break;

    case "offer_accepted":
      console.log(`Offer ${message.offerId} accepted in chat ${message.chatId}`);
      break;

    case "offer_rejected":
      console.log(`Offer ${message.offerId} rejected in chat ${message.chatId}`);
      break;

    case "escrow_update":
      console.log(`Escrow updated: ${message.address}`);
      // Fetch updated escrow: GET /api/escrows/address/{address}
      break;

    default:
      console.log("Unknown message type:", message.type);
  }
});

ws.addEventListener("error", (event) => {
  console.error("WebSocket error:", event);
});

ws.addEventListener("close", (event) => {
  console.log(`Closed with code ${event.code}: ${event.reason}`);
});
```

### Reconnection Strategy

WebSocket connections can drop due to network issues. Implement automatic reconnection:

```javascript
function connectWebSocket() {
  const ws = new WebSocket(`${wsUrl}/ws?token=${token}`);

  ws.addEventListener("close", () => {
    console.log("WebSocket disconnected, reconnecting in 3 seconds...");
    setTimeout(connectWebSocket, 3000);
  });

  ws.addEventListener("error", (event) => {
    console.error("WebSocket error:", event);
    ws.close();
  });

  return ws;
}

let ws = connectWebSocket();
```

---

## Multiple Connections

Users can maintain multiple WebSocket connections (e.g., from different browser tabs). The server manages a list of connections per pubkey:

```javascript
// Map<pubkey, WSContext[]>
const clients = new Map();
```

When the server sends a notification, it broadcasts to **all** active WebSocket connections for that pubkey.

### Example

If a user is logged in on two browser tabs:
1. Tab A opens WebSocket connection
2. Tab B opens WebSocket connection
3. New message posted in chat
4. Server sends `new_message` notification to **both** tabs

---

## Notes

- WebSocket connections are not authenticated via HTTP headers; authentication happens via JWT in query parameter
- There is no server-to-client message if the user is not involved in the event (e.g., message in a chat where user is neither buyer nor seller)
- WebSocket messages are fire-and-forget; the server does not wait for client acknowledgment
- Clients should implement reconnection logic for production robustness
- The server keeps connections open indefinitely; clients can gracefully close with `ws.close()`
- All notifications are JSON; there is no binary data
- The server's `sendToUser(pubkey, data)` function is used internally to broadcast to all connections for a pubkey
