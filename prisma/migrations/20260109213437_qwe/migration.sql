-- CreateTable
CREATE TABLE `caretakerassignment` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(36) NOT NULL,
    `houseId` BIGINT NOT NULL,
    `caretakerId` BIGINT NOT NULL,
    `createdBy` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,

    UNIQUE INDEX `CaretakerAssignment_uuid_key`(`uuid`),
    INDEX `CaretakerAssignment_caretakerId_idx`(`caretakerId`),
    INDEX `CaretakerAssignment_createdBy_fkey`(`createdBy`),
    INDEX `CaretakerAssignment_houseId_idx`(`houseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `caretakerassignmentpermission` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `caretakerAssignmentId` BIGINT NOT NULL,
    `permissionId` BIGINT NOT NULL,
    `grantedBy` BIGINT NOT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `revokedBy` BIGINT NULL,

    INDEX `CaretakerAssignmentPermission_permissionId_fkey`(`permissionId`),
    INDEX `CaretakerAssignmentPermission_grantedBy_fkey`(`grantedBy`),
    INDEX `CaretakerAssignmentPermission_revokedBy_fkey`(`revokedBy`),
    UNIQUE INDEX `CaretakerAssignmentPermission_caretakerAssignmentId_permissi_key`(`caretakerAssignmentId`, `permissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(36) NOT NULL,
    `userId` BIGINT NULL,
    `endpoint` VARCHAR(1024) NOT NULL,
    `p256dh` VARCHAR(512) NOT NULL,
    `auth` VARCHAR(512) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Device_uuid_key`(`uuid`),
    INDEX `Device_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
    `base_amount` DECIMAL(10, 2) NULL,
    `amenities_charge` DECIMAL(10, 2) NULL,
    `metadata` LONGTEXT NULL,
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

-- CreateTable
CREATE TABLE `flat` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(36) NOT NULL,
    `number` VARCHAR(191) NULL,
    `metadata` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `last_rent_paid_date` DATETIME(3) NULL,
    `late_fee_percentage` DECIMAL(5, 2) NULL DEFAULT 5.00,
    `rent_amount` DECIMAL(10, 2) NULL,
    `rent_due_date` DATETIME(3) NULL,
    `should_pay_rent_day` INTEGER NOT NULL DEFAULT 10,
    `house_id` BIGINT NOT NULL,
    `renter_id` BIGINT NULL,
    `floor` INTEGER NULL DEFAULT 0,
    `next_payment_date` DATETIME(3) NULL,

    UNIQUE INDEX `Flat_uuid_key`(`uuid`),
    UNIQUE INDEX `flat_renter_id_key`(`renter_id`),
    INDEX `idx_flat_house_id`(`house_id`),
    INDEX `idx_flat_renter_id`(`renter_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `advance_payment` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(36) NOT NULL,
    `renter_id` BIGINT NOT NULL,
    `flat_id` BIGINT NOT NULL,
    `house_id` BIGINT NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('pending', 'paid', 'partially_used', 'fully_used', 'refunded') NOT NULL DEFAULT 'pending',
    `paid_amount` DECIMAL(10, 2) NOT NULL,
    `remaining_amount` DECIMAL(10, 2) NOT NULL,
    `metadata` LONGTEXT NULL,
    `payment_date` DATE NOT NULL,
    `payment_method` ENUM('cash', 'bank', 'mobile_banking', 'other') NOT NULL,
    `transaction_id` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `AdvancePayment_uuid_key`(`uuid`),
    INDEX `idx_advance_payment_renter`(`renter_id`),
    INDEX `idx_advance_payment_flat`(`flat_id`),
    INDEX `idx_advance_payment_house`(`house_id`),
    INDEX `idx_advance_payment_date`(`payment_date`),
    INDEX `idx_advance_payment_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `house` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(36) NOT NULL,
    `ownerId` BIGINT NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `metadata` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `flatCount` BIGINT NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `name` VARCHAR(255) NOT NULL DEFAULT 'Unnamed House',

    UNIQUE INDEX `House_uuid_key`(`uuid`),
    INDEX `House_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notice` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(36) NOT NULL,
    `houseId` BIGINT NULL,
    `flatId` BIGINT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `locale` VARCHAR(8) NOT NULL,
    `createdBy` BIGINT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Notice_uuid_key`(`uuid`),
    INDEX `Notice_createdBy_fkey`(`createdBy`),
    INDEX `Notice_flatId_idx`(`flatId`),
    INDEX `Notice_houseId_idx`(`houseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(36) NOT NULL,
    `userId` BIGINT NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'info',
    `read` BOOLEAN NOT NULL DEFAULT false,
    `metadata` LONGTEXT NULL,
    `pushSent` BOOLEAN NOT NULL DEFAULT false,
    `pushError` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `readAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,

    UNIQUE INDEX `Notification_uuid_key`(`uuid`),
    INDEX `Notification_pushSent_idx`(`pushSent`),
    INDEX `Notification_type_idx`(`type`),
    INDEX `Notification_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Notification_userId_read_idx`(`userId`, `read`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permission` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Permission_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pushnotificationlog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `data` LONGTEXT NULL,
    `notificationId` BIGINT NULL,
    `subscriptionId` BIGINT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `delivered` BOOLEAN NOT NULL DEFAULT false,
    `deliveredAt` DATETIME(3) NULL,
    `opened` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `openedAt` DATETIME(3) NULL,
    `error` VARCHAR(191) NULL,

    INDEX `PushNotificationLog_delivered_idx`(`delivered`),
    INDEX `PushNotificationLog_notificationId_fkey`(`notificationId`),
    INDEX `PushNotificationLog_subscriptionId_fkey`(`subscriptionId`),
    INDEX `PushNotificationLog_userId_sentAt_idx`(`userId`, `sentAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pushsubscription` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `endpoint` VARCHAR(191) NOT NULL,
    `p256dh` VARCHAR(191) NOT NULL,
    `auth` VARCHAR(191) NOT NULL,
    `userAgent` VARCHAR(191) NULL,
    `clientType` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `lastUsed` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PushSubscription_endpoint_key`(`endpoint`),
    INDEX `PushSubscription_userId_clientType_idx`(`userId`, `clientType`),
    INDEX `PushSubscription_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refreshtoken` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(191) NOT NULL,
    `userId` BIGINT NOT NULL,
    `revoked` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RefreshToken_token_key`(`token`),
    INDEX `RefreshToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `registrationtoken` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(191) NOT NULL,
    `createdBy` BIGINT NOT NULL,
    `email` VARCHAR(191) NULL,
    `roleSlug` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `used` BOOLEAN NOT NULL DEFAULT false,
    `usedAt` DATETIME(3) NULL,
    `usedBy` BIGINT NULL,
    `metadata` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RegistrationToken_token_key`(`token`),
    UNIQUE INDEX `RegistrationToken_usedBy_key`(`usedBy`),
    INDEX `RegistrationToken_createdBy_idx`(`createdBy`),
    INDEX `RegistrationToken_expiresAt_idx`(`expiresAt`),
    INDEX `RegistrationToken_token_idx`(`token`),
    INDEX `RegistrationToken_used_idx`(`used`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `renter` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `alternativePhone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `nid` VARCHAR(191) NULL,
    `nidFrontImageUrl` VARCHAR(191) NULL,
    `nidBackImageUrl` VARCHAR(191) NULL,
    `status` VARCHAR(191) NULL DEFAULT 'active',
    `metadata` LONGTEXT NULL,
    `createdBy` BIGINT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Renter_uuid_key`(`uuid`),
    INDEX `Renter_createdBy_fkey`(`createdBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `rank` INTEGER NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Role_name_key`(`name`),
    UNIQUE INDEX `Role_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rolelimit` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `roleSlug` VARCHAR(191) NOT NULL,
    `maxHouses` INTEGER NOT NULL DEFAULT 1,
    `maxCaretakers` INTEGER NOT NULL DEFAULT 2,
    `maxFlats` INTEGER NOT NULL DEFAULT 10,
    `canLoginAs` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RoleLimit_roleSlug_key`(`roleSlug`),
    INDEX `RoleLimit_roleSlug_idx`(`roleSlug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rolepermission` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `roleId` BIGINT NOT NULL,
    `permissionId` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RolePermission_permissionId_fkey`(`permissionId`),
    UNIQUE INDEX `RolePermission_roleId_permissionId_key`(`roleId`, `permissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staffpermission` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `permissionId` BIGINT NOT NULL,
    `grantedBy` BIGINT NOT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `revokedBy` BIGINT NULL,

    INDEX `StaffPermission_grantedAt_idx`(`grantedAt`),
    INDEX `StaffPermission_grantedBy_fkey`(`grantedBy`),
    INDEX `StaffPermission_permissionId_idx`(`permissionId`),
    INDEX `StaffPermission_revokedBy_fkey`(`revokedBy`),
    INDEX `StaffPermission_userId_idx`(`userId`),
    UNIQUE INDEX `StaffPermission_userId_permissionId_key`(`userId`, `permissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `systemsetting` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `value` LONGTEXT NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'string',
    `category` VARCHAR(191) NOT NULL DEFAULT 'general',
    `isPublic` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SystemSetting_key_key`(`key`),
    INDEX `SystemSetting_category_idx`(`category`),
    INDEX `SystemSetting_key_idx`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `template` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `locale` VARCHAR(8) NOT NULL,
    `subject` VARCHAR(191) NULL,
    `content` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Template_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(36) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `emailVerifiedAt` DATETIME(3) NULL,
    `passwordHash` VARCHAR(255) NULL,
    `salt` VARCHAR(64) NULL,
    `googleId` VARCHAR(255) NULL,
    `locale` VARCHAR(8) NOT NULL DEFAULT 'en',
    `name` VARCHAR(150) NULL,
    `phone` VARCHAR(50) NULL,
    `avatarUrl` VARCHAR(1024) NULL,
    `profileJson` LONGTEXT NULL,
    `roleId` BIGINT NULL,
    `parentId` BIGINT NULL,
    `needsPasswordSetup` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `lastLoginAt` DATETIME(3) NULL,
    `lastLoginIp` VARCHAR(45) NULL,
    `metadata` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `User_uuid_key`(`uuid`),
    UNIQUE INDEX `User_email_key`(`email`),
    UNIQUE INDEX `User_googleId_key`(`googleId`),
    UNIQUE INDEX `User_phone_key`(`phone`),
    INDEX `User_email_idx`(`email`),
    INDEX `User_parentId_fkey`(`parentId`),
    INDEX `User_phone_idx`(`phone`),
    INDEX `User_roleId_fkey`(`roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `userloginas` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `targetUserId` BIGINT NOT NULL,
    `originalRoleId` BIGINT NOT NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `UserLoginAs_expiresAt_idx`(`expiresAt`),
    INDEX `UserLoginAs_originalRoleId_fkey`(`originalRoleId`),
    INDEX `UserLoginAs_targetUserId_idx`(`targetUserId`),
    INDEX `UserLoginAs_userId_idx`(`userId`),
    UNIQUE INDEX `UserLoginAs_userId_targetUserId_key`(`userId`, `targetUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `caretakerassignment` ADD CONSTRAINT `CaretakerAssignment_caretakerId_fkey` FOREIGN KEY (`caretakerId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `caretakerassignment` ADD CONSTRAINT `CaretakerAssignment_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `caretakerassignment` ADD CONSTRAINT `CaretakerAssignment_houseId_fkey` FOREIGN KEY (`houseId`) REFERENCES `house`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `caretakerassignmentpermission` ADD CONSTRAINT `CaretakerAssignmentPermission_caretakerAssignmentId_fkey` FOREIGN KEY (`caretakerAssignmentId`) REFERENCES `caretakerassignment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `caretakerassignmentpermission` ADD CONSTRAINT `CaretakerAssignmentPermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `caretakerassignmentpermission` ADD CONSTRAINT `CaretakerAssignmentPermission_grantedBy_fkey` FOREIGN KEY (`grantedBy`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `caretakerassignmentpermission` ADD CONSTRAINT `CaretakerAssignmentPermission_revokedBy_fkey` FOREIGN KEY (`revokedBy`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device` ADD CONSTRAINT `Device_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE `advance_payment` ADD CONSTRAINT `advance_payment_renter_id_fkey` FOREIGN KEY (`renter_id`) REFERENCES `renter`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `advance_payment` ADD CONSTRAINT `advance_payment_flat_id_fkey` FOREIGN KEY (`flat_id`) REFERENCES `flat`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `advance_payment` ADD CONSTRAINT `advance_payment_house_id_fkey` FOREIGN KEY (`house_id`) REFERENCES `house`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `house` ADD CONSTRAINT `House_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notice` ADD CONSTRAINT `Notice_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notice` ADD CONSTRAINT `Notice_flatId_fkey` FOREIGN KEY (`flatId`) REFERENCES `flat`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notice` ADD CONSTRAINT `Notice_houseId_fkey` FOREIGN KEY (`houseId`) REFERENCES `house`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pushnotificationlog` ADD CONSTRAINT `PushNotificationLog_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `notification`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pushnotificationlog` ADD CONSTRAINT `PushNotificationLog_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `pushsubscription`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pushnotificationlog` ADD CONSTRAINT `PushNotificationLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pushsubscription` ADD CONSTRAINT `PushSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refreshtoken` ADD CONSTRAINT `RefreshToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registrationtoken` ADD CONSTRAINT `RegistrationToken_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registrationtoken` ADD CONSTRAINT `RegistrationToken_usedBy_fkey` FOREIGN KEY (`usedBy`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `renter` ADD CONSTRAINT `Renter_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rolepermission` ADD CONSTRAINT `RolePermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rolepermission` ADD CONSTRAINT `RolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staffpermission` ADD CONSTRAINT `StaffPermission_grantedBy_fkey` FOREIGN KEY (`grantedBy`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staffpermission` ADD CONSTRAINT `StaffPermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staffpermission` ADD CONSTRAINT `StaffPermission_revokedBy_fkey` FOREIGN KEY (`revokedBy`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staffpermission` ADD CONSTRAINT `StaffPermission_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `User_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `User_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `role`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `userloginas` ADD CONSTRAINT `UserLoginAs_originalRoleId_fkey` FOREIGN KEY (`originalRoleId`) REFERENCES `role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `userloginas` ADD CONSTRAINT `UserLoginAs_targetUserId_fkey` FOREIGN KEY (`targetUserId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `userloginas` ADD CONSTRAINT `UserLoginAs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
