-- CreateTable
CREATE TABLE `backup_roots` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `root_key` VARCHAR(64) NOT NULL,
    `metadata` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `backup_roots_user_id_created_at_idx`(`user_id`, `created_at`),
    UNIQUE INDEX `backup_roots_user_id_device_id_root_key_key`(`user_id`, `device_id`, `root_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `backup_entries` (
    `id` CHAR(36) NOT NULL,
    `root_id` CHAR(36) NOT NULL,
    `path_key` VARCHAR(64) NOT NULL,
    `metadata` TEXT NOT NULL,
    `file_id` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `backup_entries_root_id_path_key_key`(`root_id`, `path_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `backup_roots` ADD CONSTRAINT `backup_roots_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `backup_entries` ADD CONSTRAINT `backup_entries_root_id_fkey` FOREIGN KEY (`root_id`) REFERENCES `backup_roots`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
