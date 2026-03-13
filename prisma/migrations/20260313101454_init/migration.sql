-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Chat" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "listingId" INTEGER NOT NULL,
    "buyerPubkey" TEXT NOT NULL,
    "arbiterPubkey" TEXT,
    "signature" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Chat_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Chat_buyerPubkey_fkey" FOREIGN KEY ("buyerPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Chat_arbiterPubkey_fkey" FOREIGN KEY ("arbiterPubkey") REFERENCES "Account" ("pubkey") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Chat" ("arbiterPubkey", "buyerPubkey", "createdAt", "id", "listingId", "signature", "status") SELECT "arbiterPubkey", "buyerPubkey", "createdAt", "id", "listingId", "signature", "status" FROM "Chat";
DROP TABLE "Chat";
ALTER TABLE "new_Chat" RENAME TO "Chat";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
