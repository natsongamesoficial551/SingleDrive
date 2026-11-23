-- CreateTable
CREATE TABLE "discord_links" (
    "user_id" CHAR(36) NOT NULL,
    "discord_user_id" VARCHAR(20) NOT NULL,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "discord_links_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "discord_link_states" (
    "state_hash" CHAR(64) NOT NULL,
    "session_id" CHAR(36) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discord_link_states_pkey" PRIMARY KEY ("state_hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "discord_links_discord_user_id_key" ON "discord_links"("discord_user_id");

-- CreateIndex
CREATE INDEX "discord_link_states_session_id_idx" ON "discord_link_states"("session_id");

-- CreateIndex
CREATE INDEX "discord_link_states_expires_at_idx" ON "discord_link_states"("expires_at");

-- AddForeignKey
ALTER TABLE "discord_links" ADD CONSTRAINT "discord_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discord_link_states" ADD CONSTRAINT "discord_link_states_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "user_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
