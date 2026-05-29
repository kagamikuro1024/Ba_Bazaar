-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('BA_MANAGER', 'PM_PO', 'BA', 'ADMIN');

-- CreateEnum
CREATE TYPE "BALevel" AS ENUM ('JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD');

-- CreateEnum
CREATE TYPE "BAStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'RESIGNED');

-- CreateEnum
CREATE TYPE "SkillTagGroup" AS ENUM ('DOMAIN', 'ANALYSIS_SKILL');

-- CreateEnum
CREATE TYPE "SkillTagStatus" AS ENUM ('ACTIVE', 'RETIRED', 'PENDING_APPROVAL');

-- CreateEnum
CREATE TYPE "BookingPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrivateNoteVisibility" AS ENUM ('MANAGER_ONLY');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "level" "BALevel" NOT NULL,
    "joined_date" DATE NOT NULL,
    "avatar_url" TEXT,
    "status" "BAStatus" NOT NULL DEFAULT 'ACTIVE',
    "status_reason" TEXT,
    "status_changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ba_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_tags" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "group" "SkillTagGroup" NOT NULL,
    "status" "SkillTagStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_skill_tags" (
    "id" UUID NOT NULL,
    "ba_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "assigned_by" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ba_skill_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "ba_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "manager_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "capacity_percent" INTEGER NOT NULL,
    "priority" "BookingPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "reject_reason" TEXT,
    "cancel_reason" TEXT,
    "manager_comment" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "private_notes" (
    "id" UUID NOT NULL,
    "ba_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visibility" "PrivateNoteVisibility" NOT NULL DEFAULT 'MANAGER_ONLY',
    "masked_at" TIMESTAMP(3),
    "masked_by" UUID,
    "mask_reason" TEXT,

    CONSTRAINT "private_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "related_entity_type" TEXT,
    "related_entity_id" UUID,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "result" "AuditResult" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ba_profiles_user_id_key" ON "ba_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ba_profiles_email_key" ON "ba_profiles"("email");

-- CreateIndex
CREATE INDEX "ba_profiles_status_idx" ON "ba_profiles"("status");

-- CreateIndex
CREATE INDEX "ba_profiles_level_idx" ON "ba_profiles"("level");

-- CreateIndex
CREATE INDEX "skill_tags_group_status_idx" ON "skill_tags"("group", "status");

-- CreateIndex
CREATE UNIQUE INDEX "skill_tags_name_group_key" ON "skill_tags"("name", "group");

-- CreateIndex
CREATE INDEX "ba_skill_tags_ba_id_idx" ON "ba_skill_tags"("ba_id");

-- CreateIndex
CREATE INDEX "ba_skill_tags_tag_id_idx" ON "ba_skill_tags"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "ba_skill_tags_ba_id_tag_id_key" ON "ba_skill_tags"("ba_id", "tag_id");

-- CreateIndex
CREATE INDEX "projects_name_idx" ON "projects"("name");

-- CreateIndex
CREATE INDEX "bookings_ba_id_idx" ON "bookings"("ba_id");

-- CreateIndex
CREATE INDEX "bookings_project_id_idx" ON "bookings"("project_id");

-- CreateIndex
CREATE INDEX "bookings_requester_id_idx" ON "bookings"("requester_id");

-- CreateIndex
CREATE INDEX "bookings_manager_id_idx" ON "bookings"("manager_id");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "bookings_start_date_end_date_idx" ON "bookings"("start_date", "end_date");

-- CreateIndex
CREATE INDEX "bookings_ba_id_start_date_end_date_idx" ON "bookings"("ba_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "private_notes_ba_id_idx" ON "private_notes"("ba_id");

-- CreateIndex
CREATE INDEX "private_notes_created_by_idx" ON "private_notes"("created_by");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_idx" ON "notifications"("recipient_id");

-- CreateIndex
CREATE INDEX "notifications_read_at_idx" ON "notifications"("read_at");

-- CreateIndex
CREATE INDEX "notifications_related_entity_type_related_entity_id_idx" ON "notifications"("related_entity_type", "related_entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_result_idx" ON "audit_logs"("result");

-- AddForeignKey
ALTER TABLE "ba_profiles" ADD CONSTRAINT "ba_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_skill_tags" ADD CONSTRAINT "ba_skill_tags_ba_id_fkey" FOREIGN KEY ("ba_id") REFERENCES "ba_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_skill_tags" ADD CONSTRAINT "ba_skill_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "skill_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_skill_tags" ADD CONSTRAINT "ba_skill_tags_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_ba_id_fkey" FOREIGN KEY ("ba_id") REFERENCES "ba_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_notes" ADD CONSTRAINT "private_notes_ba_id_fkey" FOREIGN KEY ("ba_id") REFERENCES "ba_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_notes" ADD CONSTRAINT "private_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_notes" ADD CONSTRAINT "private_notes_masked_by_fkey" FOREIGN KEY ("masked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
