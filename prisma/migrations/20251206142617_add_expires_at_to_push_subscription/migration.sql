-- DropForeignKey
ALTER TABLE `pushsubscription` DROP FOREIGN KEY `PushSubscription_userId_fkey`;

-- DropIndex
DROP INDEX `PushSubscription_userId_endpoint_key` ON `pushsubscription`;

-- AddForeignKey
ALTER TABLE `Notice` ADD CONSTRAINT `Notice_flatId_fkey` FOREIGN KEY (`flatId`) REFERENCES `Flat`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
