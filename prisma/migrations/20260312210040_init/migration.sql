/*
  Warnings:

  - You are about to drop the `Challenges` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Challenges";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Challenge" (
    "nonce" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "expiry" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_pubkey_key" ON "Challenge"("pubkey");
