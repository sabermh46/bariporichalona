/*
  Warnings:

  - You are about to drop the column `read` on the `pushnotificationlog` table. All the data in the column will be lost.
  - You are about to drop the column `readAt` on the `pushnotificationlog` table. All the data in the column will be lost.
  - You are about to drop the column `roleFilter` on the `pushnotificationlog` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[uuid]` on the table `Notification` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,endpoint]` on the table `PushSubscription` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `uuid` to the `Notification` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX `Notification_createdAt_idx` ON `notification`;

-- AlterTable
ALTER TABLE `notification` ADD COLUMN `expiresAt` DATETIME(3) NULL,
    ADD COLUMN `pushError` VARCHAR(191) NULL,
    ADD COLUMN `pushSent` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `uuid` VARCHAR(36) NOT NULL;

-- AlterTable
ALTER TABLE `pushnotificationlog` DROP COLUMN `read`,
    DROP COLUMN `readAt`,
    DROP COLUMN `roleFilter`,
    ADD COLUMN `delivered` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `deliveredAt` DATETIME(3) NULL,
    ADD COLUMN `error` VARCHAR(191) NULL,
    ADD COLUMN `notificationId` BIGINT NULL,
    ADD COLUMN `opened` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `openedAt` DATETIME(3) NULL,
    ADD COLUMN `subscriptionId` BIGINT NULL;

-- AlterTable
ALTER TABLE `pushsubscription` ADD COLUMN `clientType` VARCHAR(191) NULL,
    ADD COLUMN `expiresAt` DATETIME(3) NULL,
    ADD COLUMN `lastUsed` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX `Notification_uuid_key` ON `Notification`(`uuid`);

-- CreateIndex
CREATE INDEX `Notification_userId_createdAt_idx` ON `Notification`(`userId`, `createdAt`);

-- CreateIndex
CREATE INDEX `Notification_type_idx` ON `Notification`(`type`);

-- CreateIndex
CREATE INDEX `Notification_pushSent_idx` ON `Notification`(`pushSent`);

-- CreateIndex
CREATE INDEX `PushNotificationLog_delivered_idx` ON `PushNotificationLog`(`delivered`);

-- CreateIndex
CREATE INDEX `PushSubscription_userId_clientType_idx` ON `PushSubscription`(`userId`, `clientType`);

-- CreateIndex
CREATE UNIQUE INDEX `PushSubscription_userId_endpoint_key` ON `PushSubscription`(`userId`, `endpoint`);

-- AddForeignKey
ALTER TABLE `PushNotificationLog` ADD CONSTRAINT `PushNotificationLog_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `PushSubscription`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushNotificationLog` ADD CONSTRAINT `PushNotificationLog_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `Notification`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
