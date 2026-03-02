-- Add default role to users
ALTER TABLE "users"
ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';
