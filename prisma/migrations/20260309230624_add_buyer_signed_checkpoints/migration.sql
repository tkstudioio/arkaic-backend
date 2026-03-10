/*
  Warnings:

  - You are about to drop the column `sellerSignedCheckpoints` on the `Products` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Products" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "prezzo" REAL NOT NULL,
    "sellerPubkey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "buyerPubkey" TEXT,
    "timelockExpiry" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'awaitingFunds',
    "sellerSignedCollabPsbt" TEXT,
    "collabArkTxid" TEXT,
    "serverSignedCheckpoints" TEXT,
    "buyerSignedCheckpoints" TEXT
);
INSERT INTO "new_Products" ("buyerPubkey", "collabArkTxid", "createdAt", "id", "nome", "prezzo", "sellerPubkey", "sellerSignedCollabPsbt", "status", "timelockExpiry") SELECT "buyerPubkey", "collabArkTxid", "createdAt", "id", "nome", "prezzo", "sellerPubkey", "sellerSignedCollabPsbt", "status", "timelockExpiry" FROM "Products";
DROP TABLE "Products";
ALTER TABLE "new_Products" RENAME TO "Products";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
