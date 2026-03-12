/*
  Warnings:

  - You are about to drop the `Nonce` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Nonce";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Challenges" (
    "nonce" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "expiry" DATETIME NOT NULL
);
