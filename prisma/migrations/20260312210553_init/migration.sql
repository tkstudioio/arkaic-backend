-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Challenge" (
    "nonce" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "expiry" DATETIME NOT NULL
);
INSERT INTO "new_Challenge" ("expiry", "nonce", "pubkey") SELECT "expiry", "nonce", "pubkey" FROM "Challenge";
DROP TABLE "Challenge";
ALTER TABLE "new_Challenge" RENAME TO "Challenge";
CREATE UNIQUE INDEX "Challenge_pubkey_key" ON "Challenge"("pubkey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
