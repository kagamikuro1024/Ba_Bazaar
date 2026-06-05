/*
  Warnings:

  - The values [FAILED] on the enum `AuditResult` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RejectReason" AS ENUM ('NOT_OFFICIAL', 'TOO_OLD', 'MISSING_DOCS', 'OTHER');

-- AlterEnum
BEGIN;
CREATE TYPE "AuditResult_new" AS ENUM ('SUCCESS', 'DENIED');
ALTER TABLE "audit_logs" ALTER COLUMN "result" TYPE "AuditResult_new" USING ("result"::text::"AuditResult_new");
ALTER TYPE "AuditResult" RENAME TO "AuditResult_old";
ALTER TYPE "AuditResult_new" RENAME TO "AuditResult";
DROP TYPE "public"."AuditResult_old";
COMMIT;

-- CreateTable
CREATE TABLE "vendors" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reject_reason" "RejectReason",
    "reject_note" TEXT,
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);
