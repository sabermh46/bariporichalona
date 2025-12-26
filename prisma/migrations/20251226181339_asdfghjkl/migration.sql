/*
  Warnings:

  - You are about to drop the column `houseId` on the `flat` table. All the data in the column will be lost.
  - You are about to drop the column `renterId` on the `flat` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[renter_id]` on the table `flat` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `house_id` to the `flat` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `flat` DROP FOREIGN KEY `Flat_houseId_fkey`;

-- DropForeignKey
ALTER TABLE `flat` DROP FOREIGN KEY `Flat_renterId_fkey`;

-- DropIndex
DROP INDEX `Flat_houseId_idx` ON `flat`;

-- DropIndex
DROP INDEX `Flat_renterId_idx` ON `flat`;

-- DropIndex
DROP INDEX `Flat_renterId_key` ON `flat`;

-- AlterTable
ALTER TABLE `flat` DROP COLUMN `houseId`,
    DROP COLUMN `renterId`,
    ADD COLUMN `floor` INTEGER NULL DEFAULT 0,
    ADD COLUMN `house_id` BIGINT NOT NULL,
    ADD COLUMN `renter_id` BIGINT NULL;

-- CreateTable
CREATE TABLE `rent_payment` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(36) NULL,
    `flat_id` BIGINT NOT NULL,
    `renter_id` BIGINT NOT NULL,
    `house_id` BIGINT NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `due_date` DATE NOT NULL,
    `paid_date` DATE NULL,
    `paid_amount` DECIMAL(10, 2) NULL,
    `payment_method` ENUM('cash', 'bank', 'mobile_banking', 'other') NULL,
    `transaction_id` VARCHAR(100) NULL,
    `status` ENUM('pending', 'paid', 'overdue', 'partial', 'cancelled') NULL DEFAULT 'pending',
    `late_fee_amount` DECIMAL(10, 2) NULL DEFAULT 0.00,
    `notes` TEXT NULL,
    `created_by` BIGINT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `rent_payment_uuid_key`(`uuid`),
    INDEX `idx_rent_payment_due_date`(`due_date`, `status`),
    INDEX `idx_rent_payment_flat_id`(`flat_id`, `status`),
    INDEX `rent_payment_created_by_fkey`(`created_by`),
    INDEX `rent_payment_house_id_fkey`(`house_id`),
    INDEX `rent_payment_renter_id_fkey`(`renter_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `house_expense` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(36) NULL,
    `house_id` BIGINT NOT NULL,
    `category` ENUM('maintenance', 'utility', 'repair', 'tax', 'salary', 'other') NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `description` TEXT NULL,
    `expense_date` DATE NOT NULL,
    `paid_by` BIGINT NULL,
    `payment_method` ENUM('cash', 'bank', 'mobile_banking', 'other') NULL,
    `receipt_url` VARCHAR(500) NULL,
    `status` ENUM('pending', 'paid', 'approved', 'rejected') NULL DEFAULT 'pending',
    `approved_by` BIGINT NULL,
    `metadata` LONGTEXT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `house_expense_uuid_key`(`uuid`),
    INDEX `idx_house_expense_house_id`(`house_id`, `expense_date`),
    INDEX `house_expense_approved_by_fkey`(`approved_by`),
    INDEX `house_expense_paid_by_fkey`(`paid_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_fee_payment` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(36) NULL,
    `house_owner_id` BIGINT NOT NULL,
    `house_id` BIGINT NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `fee_type` ENUM('monthly_subscription', 'transaction_fee', 'service_charge') NOT NULL,
    `due_date` DATE NOT NULL,
    `paid_date` DATE NULL,
    `payment_method` ENUM('cash', 'bank', 'mobile_banking', 'other') NULL,
    `transaction_id` VARCHAR(100) NULL,
    `status` ENUM('pending', 'paid', 'overdue') NULL DEFAULT 'pending',
    `invoice_url` VARCHAR(500) NULL,
    `metadata` LONGTEXT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `app_fee_payment_uuid_key`(`uuid`),
    INDEX `app_fee_payment_house_id_fkey`(`house_id`),
    INDEX `app_fee_payment_house_owner_id_fkey`(`house_owner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `financial_report` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `house_id` BIGINT NOT NULL,
    `month` VARCHAR(7) NULL,
    `total_rent_due` DECIMAL(10, 2) NULL,
    `total_rent_collected` DECIMAL(10, 2) NULL,
    `total_expenses` DECIMAL(10, 2) NULL,
    `net_income` DECIMAL(10, 2) NULL,
    `pending_payments` INTEGER NULL,
    `overdue_payments` INTEGER NULL,
    `generated_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `financial_report_house_id_fkey`(`house_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `flat_renter_id_key` ON `flat`(`renter_id`);

-- CreateIndex
CREATE INDEX `idx_flat_house_id` ON `flat`(`house_id`);

-- CreateIndex
CREATE INDEX `idx_flat_renter_id` ON `flat`(`renter_id`);

-- AddForeignKey
ALTER TABLE `rent_payment` ADD CONSTRAINT `rent_payment_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rent_payment` ADD CONSTRAINT `rent_payment_flat_id_fkey` FOREIGN KEY (`flat_id`) REFERENCES `flat`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rent_payment` ADD CONSTRAINT `rent_payment_house_id_fkey` FOREIGN KEY (`house_id`) REFERENCES `house`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rent_payment` ADD CONSTRAINT `rent_payment_renter_id_fkey` FOREIGN KEY (`renter_id`) REFERENCES `renter`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `house_expense` ADD CONSTRAINT `house_expense_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `house_expense` ADD CONSTRAINT `house_expense_house_id_fkey` FOREIGN KEY (`house_id`) REFERENCES `house`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `house_expense` ADD CONSTRAINT `house_expense_paid_by_fkey` FOREIGN KEY (`paid_by`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_fee_payment` ADD CONSTRAINT `app_fee_payment_house_id_fkey` FOREIGN KEY (`house_id`) REFERENCES `house`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_fee_payment` ADD CONSTRAINT `app_fee_payment_house_owner_id_fkey` FOREIGN KEY (`house_owner_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `financial_report` ADD CONSTRAINT `financial_report_house_id_fkey` FOREIGN KEY (`house_id`) REFERENCES `house`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flat` ADD CONSTRAINT `flat_house_id_fkey` FOREIGN KEY (`house_id`) REFERENCES `house`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flat` ADD CONSTRAINT `flat_renter_id_fkey` FOREIGN KEY (`renter_id`) REFERENCES `renter`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
