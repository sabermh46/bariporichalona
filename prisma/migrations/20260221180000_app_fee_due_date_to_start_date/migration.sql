-- Rename app_fee_payment.due_date to start_date
ALTER TABLE `app_fee_payment` CHANGE COLUMN `due_date` `start_date` DATE NOT NULL;
