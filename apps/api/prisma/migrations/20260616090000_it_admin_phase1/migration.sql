-- Phase 1: IT Admin foundation
-- NOTE: ADD VALUE on an enum is allowed inside a transaction on Postgres 12+
-- as long as the new value is not USED in the same migration (it isn't here).

-- 1. New role IT_ADMIN (kept separate from legacy ADMIN)
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'IT_ADMIN';

-- 2. Audit can record technical failures (plan wants success/failed)
ALTER TYPE "AuditResult" ADD VALUE IF NOT EXISTS 'FAILURE';

-- 3. User enable/disable
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
ALTER TABLE "users" ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- 4. Audit logs: denormalized actor_role + request context, and a flexible
--    target_id (feature-flag keys / route paths are not uuids).
ALTER TABLE "audit_logs" ADD COLUMN "actor_role" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "ip_address" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "user_agent" TEXT;
ALTER TABLE "audit_logs" ALTER COLUMN "target_id" TYPE TEXT USING "target_id"::text;
ALTER TABLE "audit_logs" ALTER COLUMN "target_id" DROP NOT NULL;
