-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Listing" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "prezzo" REAL NOT NULL,
    "sellerPubkey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escrowAddress" TEXT,
    "status" TEXT NOT NULL DEFAULT 'awaitingFunds'
);
INSERT INTO "new_Listing" ("createdAt", "escrowAddress", "id", "nome", "prezzo", "sellerPubkey") SELECT "createdAt", "escrowAddress", "id", "nome", "prezzo", "sellerPubkey" FROM "Listing";
DROP TABLE "Listing";
ALTER TABLE "new_Listing" RENAME TO "Listing";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
