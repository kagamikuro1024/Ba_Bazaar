-- AI Assistant v2: tables for the LLM gateway audit trail, the agent's
-- conversation memory, and the 3-tier autonomy / 5-min undo window.
--
-- All tables are append-mostly: the AI never silently mutates its own
-- state. Every decision is recorded so the manager can always answer
-- "why did the AI do that?".

-- ai_decisions: one row per LLM call. The gateway inserts here synchronously
-- before returning the response, so a crash never loses the audit trail.
CREATE TABLE "ai_decisions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "caller" TEXT NOT NULL,                  -- e.g. 'brief_composer', 'agent_loop', 'triage'
  "user_id" UUID,                          -- who triggered the call (nullable for system)
  "provider" TEXT NOT NULL,                -- 'stub' | 'openai' | future
  "model" TEXT NOT NULL,
  "prompt_hash" TEXT NOT NULL,             -- sha256[0:16] of canonical request
  "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_tokens" INTEGER NOT NULL DEFAULT 0,
  "latency_ms" INTEGER NOT NULL DEFAULT 0,
  "success" BOOLEAN NOT NULL DEFAULT TRUE,
  "error_message" TEXT,
  "metadata" JSONB,                        -- free-form (route, tool, etc.)
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "ai_decisions_caller_created_idx" ON "ai_decisions" ("caller", "created_at" DESC);
CREATE INDEX "ai_decisions_user_idx" ON "ai_decisions" ("user_id", "created_at" DESC);

-- ai_conversations: one row per user-side chat session. The frontend
-- generates the session id; the backend never expires them (the user
-- can clear their own history).
CREATE TABLE "ai_conversations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "title" TEXT,                            -- auto-generated from first message
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "ai_conversations_user_idx" ON "ai_conversations" ("user_id", "updated_at" DESC);

-- ai_messages: the full transcript, in order. We keep both user and
-- assistant turns. Tool calls are stored as JSONB so the frontend can
-- render them as cards.
CREATE TABLE "ai_messages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL,                    -- 'user' | 'assistant' | 'tool'
  "content" TEXT NOT NULL,
  "tool_calls" JSONB,
  "tool_call_id" TEXT,
  "tool_name" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "ai_messages_conv_idx" ON "ai_messages" ("conversation_id", "created_at" ASC);

-- ai_pending_actions: the 3-tier autonomy mechanism. A 'tier_3' (act)
-- tool call inserts a row here and returns to the user. The user has
-- `undo_window_seconds` to call /undo, otherwise a sweeper promotes
-- the row to a normal domain record.
--
-- This is the heart of "trust the AI to act, but make it reversible."
CREATE TABLE "ai_pending_actions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "conversation_id" UUID REFERENCES "ai_conversations"("id") ON DELETE SET NULL,
  "message_id" UUID REFERENCES "ai_messages"("id") ON DELETE SET NULL,
  "tool_name" TEXT NOT NULL,               -- 'draft_booking' | 'draft_reject'
  "tool_args" JSONB NOT NULL,
  "preview" JSONB NOT NULL,                -- human-readable summary
  "status" TEXT NOT NULL DEFAULT 'PENDING',-- 'PENDING' | 'CONFIRMED' | 'UNDONE' | 'EXPIRED' | 'EXECUTED'
  "undo_window_seconds" INTEGER NOT NULL DEFAULT 300,  -- 5 minutes
  "expires_at" TIMESTAMPTZ NOT NULL,        -- created_at + window
  "result_id" TEXT,                        -- domain id (booking id) once executed
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "confirmed_at" TIMESTAMPTZ,
  "executed_at" TIMESTAMPTZ
);
CREATE INDEX "ai_pending_actions_status_expiry_idx"
  ON "ai_pending_actions" ("status", "expires_at" ASC)
  WHERE "status" = 'PENDING';
CREATE INDEX "ai_pending_actions_user_idx"
  ON "ai_pending_actions" ("user_id", "created_at" DESC);

-- ai_feedback: thumbs up/down on assistant answers, used to improve
-- prompts over time and pick fine-tuning data later.
CREATE TABLE "ai_feedback" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "message_id" UUID NOT NULL REFERENCES "ai_messages"("id") ON DELETE CASCADE,
  "rating" SMALLINT NOT NULL,              -- +1 / -1
  "comment" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "ai_feedback_message_idx" ON "ai_feedback" ("message_id");
