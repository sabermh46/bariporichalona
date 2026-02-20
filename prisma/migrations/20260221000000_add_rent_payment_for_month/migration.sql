-- Add for_month column (YYYY-MM) to rent_payment for one-record-per-flat-per-month guarantee
ALTER TABLE `rent_payment` ADD COLUMN `for_month` VARCHAR(7) NULL;

-- Backfill from due_date
UPDATE `rent_payment` SET `for_month` = DATE_FORMAT(`due_date`, '%Y-%m') WHERE `due_date` IS NOT NULL;

-- Resolve duplicates: keep one row per (flat_id, for_month), set for_month = NULL for duplicates
-- (MySQL allows multiple NULLs in UNIQUE index; avoid updating same table in subquery)
CREATE TEMPORARY TABLE _rp_keep AS
  SELECT `flat_id`, `for_month`, MIN(`id`) AS keep_id
  FROM `rent_payment`
  WHERE `for_month` IS NOT NULL
  GROUP BY `flat_id`, `for_month`
  HAVING COUNT(*) > 1;

UPDATE `rent_payment` rp
INNER JOIN _rp_keep dup ON rp.flat_id = dup.flat_id AND rp.for_month = dup.for_month AND rp.id <> dup.keep_id
SET rp.for_month = NULL;

DROP TEMPORARY TABLE _rp_keep;

-- Add unique constraint: one rent_payment per flat per month
CREATE UNIQUE INDEX `idx_rent_payment_flat_for_month` ON `rent_payment`(`flat_id`, `for_month`);
