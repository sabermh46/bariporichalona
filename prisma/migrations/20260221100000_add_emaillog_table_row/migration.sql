-- Add table_name and row_id to emaillog for tracking which record the email relates to
ALTER TABLE `emaillog`
ADD COLUMN `table_name` VARCHAR(100) NULL AFTER `metadata`,
ADD COLUMN `row_id` BIGINT NULL AFTER `table_name`;

CREATE INDEX `EmailLog_table_row_idx` ON `emaillog`(`table_name`, `row_id`);
