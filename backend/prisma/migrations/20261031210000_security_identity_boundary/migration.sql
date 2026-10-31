-- Sessões e vínculos legados não demonstram posse da identidade. Exigir revisão
-- antes de reativar contas existentes; não apagar arquivos nem tokens de auditoria.
CREATE TABLE `security_rate_limits` (
  `id` VARCHAR(96) NOT NULL,
  `hits` INTEGER NOT NULL DEFAULT 1,
  `expires_at` DATETIME(3) NOT NULL,
  INDEX `security_rate_limits_expires_at_idx` (`expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `users` ADD COLUMN `google_subject` VARCHAR(191) NULL,
  ADD COLUMN `email_verified_at` DATETIME(3) NULL;
CREATE UNIQUE INDEX `users_google_subject_key` ON `users` (`google_subject`);
DELETE FROM `oauth_states`;
DELETE FROM `auth_handoffs`;
ALTER TABLE `oauth_states` ADD COLUMN `code_challenge` VARCHAR(43) NOT NULL,
  ADD COLUMN `access_mode` VARCHAR(16) NOT NULL DEFAULT 'essential',
  ADD COLUMN `session_id` CHAR(36) NULL;
UPDATE `users` SET `status` = 'security_review_required'
WHERE `status` = 'active' AND `id` IN
  (SELECT `user_id` FROM `connected_accounts` WHERE `provider` = 'google_drive' AND `status` = 'connected');
UPDATE `user_sessions` SET `revoked_at` = CURRENT_TIMESTAMP(3) WHERE `revoked_at` IS NULL;
UPDATE `api_keys` SET `status` = 'revoked', `revoked_at` = CURRENT_TIMESTAMP(3) WHERE `revoked_at` IS NULL;
UPDATE `file_shares` SET `enabled` = false;
DELETE FROM `file_preview_tokens`;
UPDATE `connected_accounts` SET `status` = 'security_review_required' WHERE `status` = 'connected';
