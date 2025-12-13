/*
  Warnings:

  - Added the required column `flatCount` to the `House` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `house` ADD COLUMN `flatCount` BIGINT NOT NULL;
