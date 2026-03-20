-- CreateTable
CREATE TABLE "Favorite" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "accountPubkey" TEXT NOT NULL,
    "listingId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favorite_accountPubkey_fkey" FOREIGN KEY ("accountPubkey") REFERENCES "Account" ("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Favorite_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Favorite_accountPubkey_idx" ON "Favorite"("accountPubkey");

-- CreateIndex
CREATE INDEX "Favorite_listingId_idx" ON "Favorite"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_accountPubkey_listingId_key" ON "Favorite"("accountPubkey", "listingId");
