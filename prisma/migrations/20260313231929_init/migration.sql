-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Escrow" (
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
INSERT INTO "new_Escrow" ("address", "arbiterPubkey", "buyerPubkey", "buyerSignedCheckpoints", "chatId", "collabArkTxid", "createdAt", "fundedAt", "offerId", "price", "releasedAt", "sellerPubkey", "sellerSignedCollabPsbt", "serverPubkey", "serverSignedCheckpoints", "status", "timelockExpiry") SELECT "address", "arbiterPubkey", "buyerPubkey", "buyerSignedCheckpoints", "chatId", "collabArkTxid", "createdAt", "fundedAt", "offerId", "price", "releasedAt", "sellerPubkey", "sellerSignedCollabPsbt", "serverPubkey", "serverSignedCheckpoints", "status", "timelockExpiry" FROM "Escrow";
DROP TABLE "Escrow";
ALTER TABLE "new_Escrow" RENAME TO "Escrow";
CREATE UNIQUE INDEX "Escrow_chatId_key" ON "Escrow"("chatId");
CREATE UNIQUE INDEX "Escrow_offerId_key" ON "Escrow"("offerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
