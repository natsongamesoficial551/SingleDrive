ALTER TABLE "desktop_devices"
  ADD COLUMN "remote_disk_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "remote_disk_account_id" CHAR(36),
  ADD COLUMN "remote_disk_root_id" VARCHAR(255),
  ADD COLUMN "remote_disk_key_hash" VARCHAR(64),
  ADD COLUMN "remote_disk_mounted" BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX "desktop_devices_remote_disk_key_hash_key" ON "desktop_devices" ("remote_disk_key_hash");
