-- Allow NULL userId for system_common notifications (visible to web_owner/staff)
ALTER TABLE `notification` MODIFY COLUMN `userId` BIGINT NULL;
