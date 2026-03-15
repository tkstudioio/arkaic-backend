-- CreateTable
CREATE TABLE "Account" (
    "pubkey" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isArbiter" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Challenge" (
    "nonce" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "expiry" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Review" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reviewedPubkey" TEXT NOT NULL,
    "reviewerPubkey" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "escrowAddress" TEXT NOT NULL,
    CONSTRAINT "Review_reviewedPubkey_fkey" FOREIGN KEY ("reviewedPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Review_reviewerPubkey_fkey" FOREIGN KEY ("reviewerPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Review_escrowAddress_fkey" FOREIGN KEY ("escrowAddress") REFERENCES "Escrow" ("address") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sellerPubkey" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Listing_sellerPubkey_fkey" FOREIGN KEY ("sellerPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListingCategory" (
    "listingId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,

    PRIMARY KEY ("listingId", "categoryId"),
    CONSTRAINT "ListingCategory_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ListingCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "listingId" INTEGER NOT NULL,
    "buyerPubkey" TEXT NOT NULL,
    "arbiterPubkey" TEXT,
    "signature" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escrowAddress" TEXT,
    CONSTRAINT "Chat_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Chat_buyerPubkey_fkey" FOREIGN KEY ("buyerPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Chat_arbiterPubkey_fkey" FOREIGN KEY ("arbiterPubkey") REFERENCES "Account" ("pubkey") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" INTEGER NOT NULL,
    "message" TEXT,
    "senderPubkey" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Message_senderPubkey_fkey" FOREIGN KEY ("senderPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "messageId" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Offer_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OfferAcceptance" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "offerId" INTEGER NOT NULL,
    "signature" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfferAcceptance_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "childrenOf" INTEGER,
    CONSTRAINT "Category_childrenOf_fkey" FOREIGN KEY ("childrenOf") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Escrow" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "buyerPubkey" TEXT NOT NULL,
    "sellerPubkey" TEXT NOT NULL,
    "serverPubkey" TEXT NOT NULL,
    "arbiterPubkey" TEXT,
    "price" INTEGER NOT NULL,
    "timelockExpiry" INTEGER NOT NULL,
    "chatId" INTEGER NOT NULL,
    "offerId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'awaitingFunds',
    "sellerSignedCollabPsbt" TEXT,
    "collabArkTxid" TEXT,
    "serverSignedCheckpoints" TEXT,
    "buyerSignedCheckpoints" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fundedAt" DATETIME,
    "releasedAt" DATETIME,
    CONSTRAINT "Escrow_buyerPubkey_fkey" FOREIGN KEY ("buyerPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Escrow_sellerPubkey_fkey" FOREIGN KEY ("sellerPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Escrow_arbiterPubkey_fkey" FOREIGN KEY ("arbiterPubkey") REFERENCES "Account" ("pubkey") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Escrow_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Escrow_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_pubkey_key" ON "Challenge"("pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "Review_escrowAddress_reviewerPubkey_key" ON "Review"("escrowAddress", "reviewerPubkey");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_messageId_key" ON "Offer"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferAcceptance_offerId_key" ON "OfferAcceptance"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "Escrow_chatId_key" ON "Escrow"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "Escrow_offerId_key" ON "Escrow"("offerId");
