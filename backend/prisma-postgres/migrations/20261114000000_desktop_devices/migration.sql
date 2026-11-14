-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "client" VARCHAR(16) NOT NULL DEFAULT 'web';

-- CreateTable
CREATE TABLE "desktop_devices" (
    "id" CHAR(36) NOT NULL,
    "user_id" CHAR(36) NOT NULL,
    "session_id" CHAR(36) NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "platform" VARCHAR(32) NOT NULL DEFAULT 'windows',
    "app_version" VARCHAR(32) NOT NULL,
    "backup_enabled" BOOLEAN NOT NULL DEFAULT false,
    "runtime_status" VARCHAR(32) NOT NULL DEFAULT 'idle',
    "source_names" JSONB NOT NULL,
    "uploaded_files" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_backup_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desktop_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "desktop_devices_session_id_key" ON "desktop_devices"("session_id");

-- CreateIndex
CREATE INDEX "desktop_devices_user_id_revoked_at_created_at_idx" ON "desktop_devices"("user_id", "revoked_at", "created_at");

-- AddForeignKey
ALTER TABLE "desktop_devices" ADD CONSTRAINT "desktop_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desktop_devices" ADD CONSTRAINT "desktop_devices_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "user_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
