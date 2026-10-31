CREATE TABLE "security_rate_limits" (
  "id" VARCHAR(96) NOT NULL PRIMARY KEY,
  "hits" INTEGER NOT NULL DEFAULT 1,
  "expires_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "security_rate_limits_expires_at_idx" ON "security_rate_limits"("expires_at");
ALTER TABLE "users" ADD COLUMN "google_subject" VARCHAR(191),
  ADD COLUMN "email_verified_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "users_google_subject_key" ON "users"("google_subject");
DELETE FROM "oauth_states";
DELETE FROM "auth_handoffs";
ALTER TABLE "oauth_states" ADD COLUMN "code_challenge" VARCHAR(43) NOT NULL,
  ADD COLUMN "access_mode" VARCHAR(16) NOT NULL DEFAULT 'essential',
  ADD COLUMN "session_id" CHAR(36);
UPDATE "users" SET "status" = 'security_review_required'
WHERE "status" = 'active' AND "id" IN
  (SELECT "user_id" FROM "connected_accounts" WHERE "provider" = 'google_drive' AND "status" = 'connected');
UPDATE "user_sessions" SET "revoked_at" = CURRENT_TIMESTAMP WHERE "revoked_at" IS NULL;
UPDATE "api_keys" SET "status" = 'revoked', "revoked_at" = CURRENT_TIMESTAMP WHERE "revoked_at" IS NULL;
UPDATE "file_shares" SET "enabled" = false;
DELETE FROM "file_preview_tokens";
UPDATE "connected_accounts" SET "status" = 'security_review_required' WHERE "status" = 'connected';
