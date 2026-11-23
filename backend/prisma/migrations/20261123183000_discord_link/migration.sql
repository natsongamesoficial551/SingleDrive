-- CreateTable
CREATE TABLE `discord_links` (
    `user_id` CHAR(36) NOT NULL,
    `discord_user_id` VARCHAR(20) NOT NULL,
    `verified_at` DATETIME(3) NULL,

    UNIQUE INDEX `discord_links_discord_user_id_key`(`discord_user_id`),
    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `discord_link_states` (
    `state_hash` CHAR(64) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `discord_link_states_session_id_idx`(`session_id`),
    INDEX `discord_link_states_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`state_hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `discord_links` ADD CONSTRAINT `discord_links_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `discord_link_states` ADD CONSTRAINT `discord_link_states_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `user_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
