// ---------------------------------------------------------------------------
// Streaming client for the ba-chat SSE endpoint (apps/ai).
//
// The Python service exposes POST /chat that streams Server-Sent Events
// (`ready`, `state`, `token`, `final`, `error`). EventSource only supports
// GET, so we POST manually with fetch and parse the SSE frames ourselves.
//
// Usage:
//   const stream = await chatStream({ message, threadId, signal, accessToken });
//   for await (const event of stream) { ... }
// ---------------------------------------------------------------------------

export type ChatThreadId = string;

export type ActionButton = {
  label: string;
  value: string;
};

export type ChatStreamEvent =
  | { type: 'ready'; threadId: ChatThreadId }
  | { type: 'state'; intent: string | null; analyzeTarget: string | null }
  | { type: 'token'; text: string }
  | { type: 'final'; content: string; threadId: ChatThreadId; actionButtons?: ActionButton[]; actionField?: string }
  | { type: 'error'; message: string };

type ChatStreamRequest = {
  message: string;
  threadId?: ChatThreadId | null;
  accessToken?: string | null;
  userRole?: string;
  userId?: string;
  signal?: AbortSignal;
};

function resolveChatBaseUrl(): string {
  const explicit = import.meta.env.VITE_CHAT_API_BASE_URL?.replace(/\/$/, '');
  if (explicit) return explicit;
  if (typeof window !== 'undefined') {
    if (import.meta.env.PROD) {
      return '';
    }
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${window.location.hostname}:8000`;
  }
  return 'http://localhost:8000';
}

export const CHAT_API_BASE_URL = resolveChatBaseUrl();

export async function* chatStream(req: ChatStreamRequest): AsyncGenerator<ChatStreamEvent> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream'
  };
  // The chat service is read-only against the Go API but it forwards this
  // bearer token so the Go side enforces RBAC for whatever endpoint it hits.
  const authHeader = req.accessToken ? `Bearer ${req.accessToken}` : null;
  const body = JSON.stringify({
    message: req.message,
    thread_id: req.threadId ?? undefined,
    auth_header: authHeader,
    user_role: req.userRole ?? 'BA_MANAGER',
    user_id: req.userId ?? 'web'
  });

  const response = await fetch(`${CHAT_API_BASE_URL}/chat`, {
    method: 'POST',
    headers,
    body,
    signal: req.signal
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `chat request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex !== -1) {
        const frame = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const event = parseSseFrame(frame);
        if (event) yield event;
        separatorIndex = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) {
      const event = parseSseFrame(buffer);
      if (event) yield event;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream is already closed when the consumer breaks early; ignore.
    }
  }
}

function parseSseFrame(rawFrame: string): ChatStreamEvent | null {
  const lines = rawFrame.split(/\r?\n/);
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (event) {
    case 'ready':
      return { type: 'ready', threadId: String(payload.thread_id ?? '') };
    case 'state':
      return {
        type: 'state',
        intent: (payload.intent as string | null) ?? null,
        analyzeTarget: (payload.analyze_target as string | null) ?? null
      };
    case 'token':
      return { type: 'token', text: String(payload.text ?? '') };
    case 'final':
      return {
        type: 'final',
        content: String(payload.content ?? ''),
        threadId: String(payload.thread_id ?? ''),
        actionButtons: Array.isArray(payload.action_buttons)
          ? (payload.action_buttons as ActionButton[])
          : undefined,
        actionField: payload.action_field ? String(payload.action_field) : undefined,
      };
    case 'error':
      return { type: 'error', message: String(payload.message ?? 'chat error') };
    default:
      return null;
  }
}
