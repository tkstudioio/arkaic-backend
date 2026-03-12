/*
  Warnings:

  - You are about to drop the `ChatMessage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProductChat` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProductEvent` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Products` table. If the table is not empty, all the data it contains will be lost.
  - The primary key for the `Account` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `accountName` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `id` on the `Account` table. All the data in the column will be lost.
  - The primary key for the `Escrow` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `buyerId` on the `Escrow` table. All the data in the column will be lost.
  - You are about to drop the column `buyerSignedCheckpoints` on the `Escrow` table. All the data in the column will be lost.
  - You are about to drop the column `collabArkTxid` on the `Escrow` table. All the data in the column will be lost.
  - You are about to drop the column `id` on the `Escrow` table. All the data in the column will be lost.
  - You are about to drop the column `sellerId` on the `Escrow` table. All the data in the column will be lost.
  - You are about to drop the column `sellerSignedCollabPsbt` on the `Escrow` table. All the data in the column will be lost.
  - You are about to drop the column `serverSignedCheckpoints` on the `Escrow` table. All the data in the column will be lost.
  - You are about to drop the column `timelockExpiry` on the `Escrow` table. All the data in the column will be lost.
  - You are about to drop the column `value` on the `Escrow` table. All the data in the column will be lost.
  - Added the required column `username` to the `Account` table without a default value. This is not possible if the table is not empty.
  - Added the required column `address` to the `Escrow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `arbiterPubkey` to the `Escrow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `buyerPubkey` to the `Escrow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `offerId` to the `Escrow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `price` to the `Escrow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sellerPubkey` to the `Escrow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `serverPubkey` to the `Escrow` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "ProductChat_productId_buyerId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ChatMessage";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ProductChat";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ProductEvent";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Products";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Nonce" (
    "nonce" TEXT NOT NULL PRIMARY KEY,
    "expiry" DATETIME NOT NULL,
    "used" BOOLEAN NOT NULL
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
    "arbiterPubkey" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Chat_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Chat_buyerPubkey_fkey" FOREIGN KEY ("buyerPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Chat_arbiterPubkey_fkey" FOREIGN KEY ("arbiterPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "pubkey" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isArbiter" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Account" ("createdAt", "pubkey") SELECT "createdAt", "pubkey" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE TABLE "new_Escrow" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "buyerPubkey" TEXT NOT NULL,
    "sellerPubkey" TEXT NOT NULL,
    "serverPubkey" TEXT NOT NULL,
    "arbiterPubkey" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "chatId" INTEGER NOT NULL,
    "offerId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fundedAt" DATETIME,
    "releasedAt" DATETIME,
    CONSTRAINT "Escrow_buyerPubkey_fkey" FOREIGN KEY ("buyerPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Escrow_sellerPubkey_fkey" FOREIGN KEY ("sellerPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Escrow_serverPubkey_fkey" FOREIGN KEY ("serverPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Escrow_arbiterPubkey_fkey" FOREIGN KEY ("arbiterPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Escrow_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Escrow_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Escrow" ("chatId", "createdAt", "status") SELECT "chatId", "createdAt", "status" FROM "Escrow";
DROP TABLE "Escrow";
ALTER TABLE "new_Escrow" RENAME TO "Escrow";
CREATE UNIQUE INDEX "Escrow_offerId_key" ON "Escrow"("offerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Review_escrowAddress_reviewerPubkey_key" ON "Review"("escrowAddress", "reviewerPubkey");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_messageId_key" ON "Offer"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferAcceptance_offerId_key" ON "OfferAcceptance"("offerId");
