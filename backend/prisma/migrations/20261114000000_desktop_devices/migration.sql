-- AlterTable
ALTER TABLE `user_sessions` ADD COLUMN `client` VARCHAR(16) NOT NULL DEFAULT 'web';

-- CreateTable
CREATE TABLE `desktop_devices` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(32) NOT NULL DEFAULT 'windows',
    `app_version` VARCHAR(32) NOT NULL,
    `backup_enabled` BOOLEAN NOT NULL DEFAULT false,
    `runtime_status` VARCHAR(32) NOT NULL DEFAULT 'idle',
    `source_names` JSON NOT NULL,
    `uploaded_files` INTEGER NOT NULL DEFAULT 0,
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_backup_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `desktop_devices_session_id_key`(`session_id`),
    INDEX `desktop_devices_user_id_revoked_at_created_at_idx`(`user_id`, `revoked_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `desktop_devices` ADD CONSTRAINT `desktop_devices_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `desktop_devices` ADD CONSTRAINT `desktop_devices_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `user_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
