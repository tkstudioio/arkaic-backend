/*
  Warnings:

  - A unique constraint covering the columns `[chatId]` on the table `Escrow` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Escrow_chatId_key" ON "Escrow"("chatId");
