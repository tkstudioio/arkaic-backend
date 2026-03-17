# Data Model

This document describes the database schema and core entities in the Arkaic backend.

## Overview

The database uses SQLite (via Prisma ORM). The schema is defined in `prisma/schema.prisma` and the generated client is output to `src/generated/prisma/`.

---

## Entities

### Account

User accounts on the marketplace. Each account is uniquely identified by a public key (Schnorr signing key).

```
Account {
  pubkey: String @id
    ├─ 33-byte hex-encoded compressed public key or 32-byte x-only
    └─ unique identifier for the account

  username: String
    └─ user-chosen display name

  createdAt: DateTime @default(now())
    └─ account creation timestamp

  isArbiter: Boolean @default(false)
    └─ whether account is registered as an arbiter for dispute resolution

  # Relationships
  listings: Listing[]
    └─ listings created by this seller

  buyerChats: Chat[] @relation("ChatBuyer")
    └─ chats where this account is the buyer

  arbiterChats: Chat[] @relation("ChatArbiter")
    └─ chats where this account is the arbiter

  messages: Message[]
    └─ messages sent by this account

  buyerEscrows: Escrow[] @relation("EscrowBuyer")
    └─ escrows where this account is the buyer

  sellerEscrows: Escrow[] @relation("EscrowSeller")
    └─ escrows where this account is the seller

  arbiterEscrows: Escrow[] @relation("EscrowArbiter")
    └─ escrows where this account is the arbiter

  reviewsReceived: Review[] @relation("ReviewReceived")
    └─ reviews given to this account

  reviewsGiven: Review[] @relation("ReviewGiven")
    └─ reviews given by this account
}
```

---

### Challenge

Temporary challenge records used in the Schnorr signature login flow.

```
Challenge {
  nonce: String @id
    ├─ 32-byte random value (hex-encoded)
    └─ issued by /api/auth/challenge

  pubkey: String @unique
    ├─ public key requesting the challenge
    └─ used to link challenge to account

  expiry: DateTime
    └─ when the challenge expires (30 seconds from creation)
    └─ expired challenges are deleted on next POST /api/auth/challenge
}
```

**Lifecycle:**
1. Client requests challenge via POST `/api/auth/challenge` with pubkey
2. Server creates nonce and Challenge record with 30-second expiry
3. Client signs nonce and sends to POST `/api/auth/login`
4. Server deletes Challenge record (nonce is now used)
5. If not used within 30 seconds, Challenge is cleaned up

---

### Listing

Products for sale on the marketplace.

```
Listing {
  id: Int @id @default(autoincrement())
    └─ unique listing identifier

  sellerPubkey: String
    ├─ public key of the seller
    └─ references Account.pubkey

  seller: Account @relation(fields: [sellerPubkey], references: [pubkey])
    └─ populated when querying listings with include

  signature: String
    ├─ Schnorr signature by seller over request body
    └─ proves seller approved listing creation

  name: String
    └─ product name/title

  price: Int
    ├─ price in satoshi (1 BTC = 100,000,000 sat)
    └─ must exceed Ark provider dust fee

  createdAt: DateTime @default(now())
    └─ listing creation time

  # Relationships
  categories: ListingCategory[]
    └─ categories assigned to this listing

  chats: Chat[]
    └─ all chats initiated for this listing
}
```

---

### ListingCategory

Join table linking listings to categories (hierarchical categorization).

```
ListingCategory {
  listingId: Int
    └─ foreign key to Listing

  listing: Listing @relation(fields: [listingId], references: [id])
    └─ the listing

  categoryId: Int
    └─ foreign key to Category

  category: Category @relation(fields: [categoryId], references: [id])
    └─ the category

  @@id([listingId, categoryId])
    └─ composite primary key (listing can only be in category once)
}
```

---

### Category

Hierarchical product categories.

```
Category {
  id: Int @id @default(autoincrement())

  name: String
    └─ category name (e.g., "Electronics", "Books")

  childrenOf: Int?
    ├─ parent category ID (null = root category)
    └─ enables category hierarchies

  parent: Category? @relation("CategoryTree", fields: [childrenOf], references: [id])
    └─ the parent category

  children: Category[] @relation("CategoryTree")
    └─ subcategories

  # Relationships
  listings: ListingCategory[]
    └─ listings in this category
}
```

---

### Chat

Negotiation conversation between buyer and seller for a specific listing.

```
Chat {
  id: Int @id @default(autoincrement())

  listingId: Int
    └─ the listing being discussed

  listing: Listing @relation(fields: [listingId], references: [id])
    └─ populated when querying chats

  buyerPubkey: String
    ├─ buyer's public key
    └─ references Account.pubkey

  buyer: Account @relation("ChatBuyer", fields: [buyerPubkey], references: [pubkey])
    └─ populated when querying chats

  arbiterPubkey: String?
    ├─ optional arbiter pubkey (for dispute resolution)
    └─ references Account.pubkey

  arbiter: Account? @relation("ChatArbiter", fields: [arbiterPubkey], references: [pubkey])
    └─ populated when querying chats

  signature: String
    ├─ Schnorr signature by buyer over empty/chat request
    └─ proves buyer initiated the chat

  status: ChatStatus @default(open)
    ├─ values: "open" | "closed"
    ├─ open: chat is active, negotiations ongoing
    └─ closed: escrow completed or refunded

  createdAt: DateTime @default(now())

  # Relationships
  messages: Message[]
    └─ all messages in this chat

  escrow: Escrow?
    └─ escrow created for this chat (if any)
    └─ one-to-one relationship via Escrow.chatId @unique
}
```

**Uniqueness constraint:** Each buyer can have at most one chat per listing (enforced at application level in POST `/api/chats/:listingId`).

---

### Message

Text messages and offer containers within chats.

```
Message {
  id: Int @id @default(autoincrement())

  chatId: Int
    └─ the chat this message belongs to

  chat: Chat @relation(fields: [chatId], references: [id])

  message: String?
    ├─ text content (optional)
    └─ null if message is only used to contain an offer

  senderPubkey: String?
    ├─ public key of the message sender
    └─ null for system messages

  sender: Account? @relation(fields: [senderPubkey], references: [pubkey])
    └─ populated when querying messages

  signature: String?
    ├─ Schnorr signature over message body
    └─ null for system messages

  isSystem: Boolean @default(false)
    ├─ true for server-generated messages
    └─ false for user messages

  sentAt: DateTime @default(now())

  # Relationships
  offer: Offer?
    └─ if this message contains an offer (one-to-one via Offer.messageId @unique)
}
```

---

### Offer

Price proposals from buyer to seller.

```
Offer {
  id: Int @id @default(autoincrement())

  messageId: Int @unique
    ├─ the message containing this offer
    └─ ensures one offer per message

  message: Message @relation(fields: [messageId], references: [id])

  price: Int
    ├─ proposed price in satoshi
    └─ may differ from listing price

  valid: Boolean @default(true)
    ├─ true if this is the current active offer
    └─ false if superseded by a newer offer

  createdAt: DateTime @default(now())

  # Relationships
  acceptance: OfferAcceptance? @relation("OfferToAcceptance")
    └─ if seller has accepted/rejected this offer (one-to-one)

  escrow: Escrow?
    └─ if escrow was created for this offer
}
```

**Offer Lifecycle:**
1. Buyer posts message with `offeredPrice` → new Offer created, `valid=true`
2. Seller can accept/reject this offer → OfferAcceptance created
3. Buyer posts another message with `offeredPrice` → previous Offer marked `valid=false`, new Offer created
4. Final accepted offer is linked to Escrow when buyer creates it

---

### OfferAcceptance

Seller's response to an offer.

```
OfferAcceptance {
  id: Int @id @default(autoincrement())

  offerId: Int @unique
    └─ the offer being responded to

  offer: Offer @relation("OfferToAcceptance", fields: [offerId], references: [id])

  signature: String
    ├─ Schnorr signature by seller over {accepted: boolean}
    └─ proves seller's intent

  accepted: Boolean
    ├─ true if seller accepts
    └─ false if seller rejects

  createdAt: DateTime @default(now())
}
```

---

### Escrow

Bitcoin escrow contract holding funds during purchase. Each escrow represents one transaction between buyer and seller.

```
Escrow {
  address: String @id
    ├─ Ark address of the escrow (deterministic)
    └─ derived from buyer/seller/timelock

  buyerPubkey: String
    ├─ buyer's public key
    └─ references Account.pubkey

  buyer: Account @relation("EscrowBuyer", fields: [buyerPubkey], references: [pubkey])

  sellerPubkey: String
    ├─ seller's public key
    └─ references Account.pubkey

  seller: Account @relation("EscrowSeller", fields: [sellerPubkey], references: [pubkey])

  serverPubkey: String
    ├─ Ark server's public key (hex-encoded)
    └─ required for multisig tapscripts

  arbiterPubkey: String?
    ├─ optional arbiter for disputes
    └─ references Account.pubkey

  arbiter: Account? @relation("EscrowArbiter", fields: [arbiterPubkey], references: [pubkey])

  price: Int
    ├─ final transaction price in satoshi
    ├─ from accepted offer, or listing price if no offer

  timelockExpiry: Int
    ├─ Unix timestamp (seconds) when refund becomes available
    └─ defines the refund timelock window

  chatId: Int @unique
    ├─ the chat this escrow belongs to
    └─ one escrow per chat

  chat: Chat @relation(fields: [chatId], references: [id])

  offerId: Int? @unique
    ├─ optional reference to the accepted offer
    └─ null if listing price used

  offer: Offer? @relation(fields: [offerId], references: [id])

  status: EscrowStatus @default(awaitingFunds)
    ├─ values: see "Escrow Status" section below
    └─ tracks progress through negotiation and settlement

  sellerSignedCollabPsbt: String?
    ├─ seller's signed PSBT (collaborative path)
    └─ null until seller signs

  collabArkTxid: String?
    ├─ Ark transaction ID (collaborative path)
    └─ null until buyer submits signed PSBT

  serverSignedCheckpoints: String?
    ├─ JSON-stringified array of server-signed checkpoint txs
    └─ set by arkProvider.submitTx()

  buyerSignedCheckpoints: String?
    ├─ JSON-stringified array of buyer-signed checkpoint txs
    └─ set by buyer signing checkpoints

  createdAt: DateTime @default(now())

  fundedAt: DateTime?
    └─ (not currently used; reserved for future funding tracking)

  releasedAt: DateTime?
    ├─ when escrow was completed or refunded
    └─ set when status → completed or refunded

  # Relationships
  reviews: Review[]
    └─ reviews posted for this escrow
}
```

### Escrow Status

```
enum EscrowStatus {
  awaitingFunds
    ├─ escrow created, waiting for buyer to send funds to address
    └─ buyer should monitor address for funding

  partiallyFunded
    ├─ escrow received some funds but below target price
    └─ buyer should send more funds or refund

  fundLocked
    ├─ escrow fully funded (funds >= price)
    ├─ seller can start collaborative flow (seller-psbt)
    └─ buyer can start refund flow after timelock

  sellerReady
    ├─ seller has signed collaborative PSBT
    └─ buyer can get PSBT and submit

  buyerSubmitted
    ├─ buyer submitted fully-signed PSBT to Ark network
    ├─ server returned checkpoint txs
    └─ buyer must sign checkpoints

  buyerCheckpointsSigned
    ├─ buyer signed checkpoint txs
    └─ seller can retrieve and finalize

  completed
    ├─ seller finalized, funds released to seller
    ├─ chat closed
    └─ can post reviews

  refunded
    ├─ buyer initiated refund after timelock
    ├─ funds sent back to buyer's recipient address
    ├─ chat closed
    └─ can post reviews
}
```

---

### Review

Post-transaction feedback and ratings.

```
Review {
  id: Int @id @default(autoincrement())

  reviewedPubkey: String
    ├─ public key of the reviewed account
    └─ references Account.pubkey

  reviewed: Account @relation("ReviewReceived", fields: [reviewedPubkey], references: [pubkey])

  reviewerPubkey: String
    ├─ public key of the reviewer
    └─ references Account.pubkey

  reviewer: Account @relation("ReviewGiven", fields: [reviewerPubkey], references: [pubkey])

  signature: String
    ├─ Schnorr signature by reviewer
    └─ proves review authenticity

  rating: Int
    ├─ rating value (typically 1-5)
    └─ schema does not enforce range

  message: String
    └─ review text

  escrowAddress: String
    ├─ the escrow this review is for
    └─ references Escrow.address

  escrow: Escrow @relation(fields: [escrowAddress], references: [address])

  @@unique([escrowAddress, reviewerPubkey])
    └─ one review per reviewer per escrow
}
```

---

## Relationships Overview

```
Account
  ├─→ Listing (1:many) seller
  ├─→ Chat (1:many) buyer
  ├─→ Chat (1:many) arbiter
  ├─→ Message (1:many) sender
  ├─→ Escrow (1:many) buyer
  ├─→ Escrow (1:many) seller
  ├─→ Escrow (1:many) arbiter
  ├─→ Review (1:many) received
  └─→ Review (1:many) given

Listing
  ├─→ ListingCategory (1:many)
  └─→ Chat (1:many)

Category
  ├─→ ListingCategory (1:many)
  └─→ Category (0:many) parent/children

Chat
  ├─→ Listing (many:1)
  ├─→ Account (many:1) buyer
  ├─→ Account (0:many:1) arbiter
  ├─→ Message (1:many)
  └─→ Escrow (1:0..1)

Message
  ├─→ Chat (many:1)
  ├─→ Account (0:many:1) sender
  └─→ Offer (1:0..1)

Offer
  ├─→ Message (many:1)
  ├─→ OfferAcceptance (1:0..1)
  └─→ Escrow (0:many:1)

OfferAcceptance
  └─→ Offer (many:1)

Escrow
  ├─→ Account (many:1) buyer
  ├─→ Account (many:1) seller
  ├─→ Account (0:many:1) arbiter
  ├─→ Chat (many:1)
  ├─→ Offer (0:many:1)
  └─→ Review (1:many)

Review
  ├─→ Account (many:1) reviewed
  ├─→ Account (many:1) reviewer
  └─→ Escrow (many:1)
```

---

## Key Constraints

- **Account.pubkey**: Primary key, globally unique
- **Listing.id**: Auto-incrementing primary key
- **Chat.id**: Auto-incrementing primary key, unique (buyer, listing) at application level
- **Message.id**: Auto-incrementing primary key
- **Offer.messageId**: Unique (one offer per message)
- **Offer.offerId** in OfferAcceptance: Unique (one acceptance per offer)
- **Escrow.address**: Primary key, deterministic from buyer/seller/timelock
- **Escrow.chatId**: Unique (one escrow per chat)
- **Review**: Unique (escrow, reviewer pubkey) composite

---

## Notes

- All timestamps use `DateTime` and default to `now()`
- Public keys are stored as hex-encoded strings (no length constraint at DB level, but must be valid secp256k1 keys at application level)
- Signatures are stored as hex-encoded strings
- JSON data (checkpoints) is stringified for storage; parsed when needed
- The database schema is generated from Prisma via `npx prisma generate`
- No hard deletes; chats and listings remain in database for audit trail
- Relationships use implicit foreign keys (via Prisma relations)
