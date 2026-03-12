/*
  Warnings:

  - A unique constraint covering the columns `[pubkey]` on the table `Challenges` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Challenges_pubkey_key" ON "Challenges"("pubkey");
