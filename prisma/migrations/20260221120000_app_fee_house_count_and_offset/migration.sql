-- Add cancelled to fee_status_enum
ALTER TABLE `app_fee_payment` MODIFY COLUMN `status` ENUM('pending', 'paid', 'overdue', 'cancelled') NULL DEFAULT 'pending';

-- Add new columns (house_count, subscription_days, offset_days)
ALTER TABLE `app_fee_payment`
  ADD COLUMN `house_count` INT NOT NULL DEFAULT 1 AFTER `house_owner_id`,
  ADD COLUMN `subscription_days` INT NOT NULL DEFAULT 30 AFTER `paid_date`,
  ADD COLUMN `offset_days` INT NOT NULL DEFAULT 5 AFTER `subscription_days`;

-- Backfill house_count from existing data (each row was per-house, so 1)
UPDATE `app_fee_payment` SET `house_count` = 1 WHERE `house_count` = 0 OR `house_count` IS NULL;

-- Drop FK and column house_id
ALTER TABLE `app_fee_payment` DROP FOREIGN KEY `app_fee_payment_house_id_fkey`;
ALTER TABLE `app_fee_payment` DROP INDEX `app_fee_payment_house_id_fkey`;
ALTER TABLE `app_fee_payment` DROP COLUMN `house_id`;

-- Index for expiry checks (paid_date)
CREATE INDEX `app_fee_payment_paid_date_idx` ON `app_fee_payment`(`paid_date`);
