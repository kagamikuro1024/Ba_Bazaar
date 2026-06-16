-- CreateTable
CREATE TABLE "ai_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "user_role" TEXT NOT NULL,
    "feature_name" TEXT NOT NULL,
    "entry_point" TEXT,
    "status" TEXT NOT NULL,
    "model_name" TEXT,
    "prompt_version" TEXT,
    "created_request_id" UUID,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "token_input" INTEGER,
    "token_output" INTEGER,
    "estimated_cost" DECIMAL(10,4),

    CONSTRAINT "ai_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "sender" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sanitized_content" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_extractions" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "extraction_type" TEXT NOT NULL,
    "raw_input" TEXT NOT NULL,
    "extracted_json" JSONB NOT NULL,
    "missing_fields" JSONB,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tool_calls" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "tool_name" TEXT NOT NULL,
    "feature_name" TEXT,
    "input_json" JSONB NOT NULL,
    "output_json" JSONB,
    "status" TEXT NOT NULL,
    "latency_ms" INTEGER,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "model_name" TEXT,
    "prompt_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_errors" (
    "id" UUID NOT NULL,
    "session_id" UUID,
    "feature_name" TEXT NOT NULL,
    "error_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack_trace" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feedback" (
    "id" UUID NOT NULL,
    "session_id" UUID,
    "user_id" UUID,
    "feature_name" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "category" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feature_flags" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "environment" TEXT NOT NULL DEFAULT 'all',
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_sessions_feature_name_idx" ON "ai_sessions"("feature_name");

-- CreateIndex
CREATE INDEX "ai_sessions_status_idx" ON "ai_sessions"("status");

-- CreateIndex
CREATE INDEX "ai_sessions_started_at_idx" ON "ai_sessions"("started_at");

-- CreateIndex
CREATE INDEX "ai_sessions_user_id_idx" ON "ai_sessions"("user_id");

-- CreateIndex
CREATE INDEX "ai_messages_session_id_idx" ON "ai_messages"("session_id");

-- CreateIndex
CREATE INDEX "ai_extractions_session_id_idx" ON "ai_extractions"("session_id");

-- CreateIndex
CREATE INDEX "ai_tool_calls_session_id_idx" ON "ai_tool_calls"("session_id");

-- CreateIndex
CREATE INDEX "ai_tool_calls_tool_name_idx" ON "ai_tool_calls"("tool_name");

-- CreateIndex
CREATE INDEX "ai_tool_calls_status_idx" ON "ai_tool_calls"("status");

-- CreateIndex
CREATE INDEX "ai_errors_feature_name_idx" ON "ai_errors"("feature_name");

-- CreateIndex
CREATE INDEX "ai_errors_severity_idx" ON "ai_errors"("severity");

-- CreateIndex
CREATE INDEX "ai_errors_status_idx" ON "ai_errors"("status");

-- CreateIndex
CREATE INDEX "ai_feedback_feature_name_idx" ON "ai_feedback"("feature_name");

-- CreateIndex
CREATE INDEX "ai_feedback_rating_idx" ON "ai_feedback"("rating");

-- CreateIndex
CREATE UNIQUE INDEX "ai_feature_flags_key_key" ON "ai_feature_flags"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_settings_key_key" ON "ai_settings"("key");

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tool_calls" ADD CONSTRAINT "ai_tool_calls_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_errors" ADD CONSTRAINT "ai_errors_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
