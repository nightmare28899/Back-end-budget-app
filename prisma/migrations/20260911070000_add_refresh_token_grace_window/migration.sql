-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN "previous_refresh_token_id" TEXT,
ADD COLUMN "previous_refresh_token_expires_at" TIMESTAMP(3);
