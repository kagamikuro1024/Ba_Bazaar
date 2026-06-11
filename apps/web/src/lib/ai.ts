// Typed client for the AI Assistant v2 + Brief Composer + Triage
// HTTP surface. The backend lives in apps/api/cmd/api/ai_handlers.go;
// this file mirrors those shapes so the frontend type-checks against
// real responses (and breaks loudly if the backend drifts).
//
// We deliberately do NOT use react-query for the chat stream — chat
// has its own loading/error UX (typing indicator, optimistic local
// messages) that doesn't fit the query-cache model. We do use it
// for the conversation list (history) and any read-only AI surfaces.

import { getStoredSession } from '@/auth/storage';
import { API_BASE_URL, apiFetch } from './api';

// ---------- Chat ----------

export type StepKind = 'tool_call' | 'tool_result' | 'final';

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentStep {
  kind: StepKind;
  tool_name?: string;
  tool_call_id?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  content?: string;
  pending_action?: AgentPendingAction;
}

export interface AgentPendingAction {
  id: string;
  tool_name: string;
  args: Record<string, unknown>;
  preview: Record<string, unknown>;
  undo_window_seconds: number;
}

export interface AgentChatResponse {
  conversation_id: string;
  final: string;
  steps: AgentStep[];
  pending_actions: AgentPendingAction[];
  quick_replies?: string[];
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string | null;
  tool_call_id?: string | null;
  created_at: string;
}

export interface AgentConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export async function postAgentChat(
  message: string,
  conversationId?: string
): Promise<AgentChatResponse> {
  return apiFetch<AgentChatResponse>('/api/ai/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      conversation_id: conversationId ?? ''
    })
  });
}

export function streamAgentChat(
  message: string,
  conversationId: string | undefined,
  handlers: {
    onStep: (step: AgentStep) => void;
    onToken?: (text: string) => void;
    onActions?: (quickReplies: string[]) => void;
    onDone: (done: { conversation_id: string; final: string }) => void;
    onError: (error: Error) => void;
  }
): EventSource {
  const session = getStoredSession();
  const params = new URLSearchParams({ message });
  if (conversationId) {
    params.set('conversation_id', conversationId);
  }
  if (session?.accessToken) {
    params.set('token', session.accessToken);
  }

  const source = new EventSource(`${API_BASE_URL}/api/ai/agent/chat/stream?${params.toString()}`);
  source.addEventListener('step', (event) => {
    handlers.onStep(JSON.parse((event as MessageEvent).data) as AgentStep);
  });
  source.addEventListener('token', (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as { text?: string };
    if (payload.text) {
      handlers.onToken?.(payload.text);
    }
  });
  source.addEventListener('actions', (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as { quick_replies?: string[] };
    handlers.onActions?.(payload.quick_replies ?? []);
  });
  source.addEventListener('done', (event) => {
    handlers.onDone(JSON.parse((event as MessageEvent).data) as { conversation_id: string; final: string });
    source.close();
  });
  source.addEventListener('error', (event) => {
    const data = (event as MessageEvent).data;
    if (data) {
      const payload = JSON.parse(data) as { message?: string };
      handlers.onError(new Error(payload.message ?? 'Stream failed'));
    } else {
      handlers.onError(new Error('Stream failed'));
    }
    source.close();
  });
  source.onerror = () => {
    handlers.onError(new Error('Stream connection failed'));
    source.close();
  };
  return source;
}

export async function postAgentConfirm(pendingActionId: string): Promise<{ status: string; result_id: string }> {
  return apiFetch<{ status: string; result_id: string }>('/api/ai/agent/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pending_action_id: pendingActionId })
  });
}

export async function postAgentUndo(pendingActionId: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>('/api/ai/agent/undo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pending_action_id: pendingActionId })
  });
}

export async function getAgentConversations(): Promise<AgentConversation[]> {
  return apiFetch<AgentConversation[]>('/api/ai/agent/conversations');
}

export async function getAgentMessages(conversationId: string): Promise<AgentMessage[]> {
  return apiFetch<AgentMessage[]>(`/api/ai/agent/conversations/${conversationId}/messages`);
}

// ---------- Brief Composer ----------

export interface BriefParseResponse {
  title: string;
  required_skills: string[];
  level: 'JUNIOR' | 'MIDDLE' | 'SENIOR' | 'LEAD';
  duration_weeks: number;
  capacity_percent: number;
  domain: string;
  reasoning: string;
}

export interface BriefCandidate {
  id: string;
  full_name: string;
  level: string;
  status: string;
  tags: string[];
  match_score: number;
  why: string;
}

export interface BriefMatchResponse {
  brief: BriefParseResponse;
  candidates: BriefCandidate[];
}

export async function postBriefParse(text: string): Promise<BriefParseResponse> {
  return apiFetch<BriefParseResponse>('/api/ai/brief/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
}

export async function postBriefMatch(brief: BriefParseResponse, limit = 5): Promise<BriefMatchResponse> {
  return apiFetch<BriefMatchResponse>('/api/ai/brief/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brief, limit })
  });
}

// ---------- Manager Triage ----------

export type TriageLane = 'auto_approve' | 'needs_judgment' | 'likely_no_fit';

export interface TriageResponse {
  booking_id: string;
  lane: TriageLane;
  confidence: number;
  reasoning: string;
  suggested_action: string;
}

export async function postTriageRun(bookingId: string): Promise<TriageResponse> {
  return apiFetch<TriageResponse>('/api/ai/triage/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ booking_id: bookingId })
  });
}
