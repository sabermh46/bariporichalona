-- Track how much advance was applied to each rent_payment
ALTER TABLE `rent_payment`
ADD COLUMN `advance_used` DECIMAL(10, 2) NULL DEFAULT 0.00;

