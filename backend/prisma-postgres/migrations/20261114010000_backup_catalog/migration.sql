-- CreateTable
CREATE TABLE "backup_roots" (
    "id" CHAR(36) NOT NULL,
    "user_id" CHAR(36) NOT NULL,
    "device_id" CHAR(36) NOT NULL,
    "root_key" VARCHAR(64) NOT NULL,
    "metadata" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_roots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_entries" (
    "id" CHAR(36) NOT NULL,
    "root_id" CHAR(36) NOT NULL,
    "path_key" VARCHAR(64) NOT NULL,
    "metadata" TEXT NOT NULL,
    "file_id" CHAR(36),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_roots_user_id_created_at_idx" ON "backup_roots"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "backup_roots_user_id_device_id_root_key_key" ON "backup_roots"("user_id", "device_id", "root_key");

-- CreateIndex
CREATE UNIQUE INDEX "backup_entries_root_id_path_key_key" ON "backup_entries"("root_id", "path_key");

-- AddForeignKey
ALTER TABLE "backup_roots" ADD CONSTRAINT "backup_roots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_entries" ADD CONSTRAINT "backup_entries_root_id_fkey" FOREIGN KEY ("root_id") REFERENCES "backup_roots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
