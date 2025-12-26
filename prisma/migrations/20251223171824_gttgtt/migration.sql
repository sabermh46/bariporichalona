-- AlterTable
ALTER TABLE `flat` ADD COLUMN `last_rent_paid_date` DATETIME(3) NULL,
    ADD COLUMN `late_fee_percentage` DECIMAL(5, 2) NULL DEFAULT 5.00,
    ADD COLUMN `rent_amount` DECIMAL(10, 2) NULL,
    ADD COLUMN `rent_due_date` DATETIME(3) NULL,
    ADD COLUMN `should_pay_rent_day` INTEGER NOT NULL DEFAULT 10;
