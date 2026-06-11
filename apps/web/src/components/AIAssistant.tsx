// AIAssistant — the floating chat bubble + slide-up panel that gives
// every authenticated user access to the Ba-Bazaar AI Assistant v2.
//
// The component owns:
//   - The bubble toggle (fixed bottom-right, hidden on small screens
//     while the user is mid-typing elsewhere to avoid focus theft).
//   - The chat panel: message list, composer, send button.
//   - The optimistic local message model: the user's text shows up
//     immediately, then a typing indicator runs while the agent works.
//   - Rendering of tool-call steps as small "thinking" pills so the
//     user sees the agent's reasoning, not just the final answer.
//   - The 3-tier autonomy contract: when a `pending_action` arrives
//     in the response, a confirmation card appears with Confirm / Undo
//     buttons. The card auto-cancels when its undo window expires.
//
// It does NOT own:
//   - Conversation history list (a future ConversationListDrawer can
//     read the same api client).
//   - Routing (the bubble stays mounted across pages).

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  Check,
  Loader2,
  Send,
  Sparkles,
  Undo2,
  Wrench,
  X
} from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { cn } from '@/lib/utils';
import {
  streamAgentChat,
  getAgentMessages,
  getAgentConversations,
  getAgentPending,
  postAgentConfirm,
  postAgentUndo,
  type AgentMessage as ApiMessage,
  type AgentPendingAction,
  type AgentPendingItem,
  type AgentStep
} from '@/lib/ai';

// ----------------------------------------------------------------------
// Local message model
// ----------------------------------------------------------------------

// Role covers user, assistant text, and the synthetic "thinking" pill
// we render for tool calls. We keep the source-of-truth message in
// `api` so the renderer can fall back to it during reloads.
type LocalRole = 'user' | 'assistant' | 'tool' | 'thinking';

interface LocalMessage {
  id: string;
  role: LocalRole;
  content: string;
  // For 'thinking' messages, the underlying step.
  step?: AgentStep;
  // The staged action if this message is a pending-action card.
  pending?: AgentPendingAction;
  // Auto-dismiss countdown for undo windows.
  expiresAt?: number;
  // If the server returned an error, show it.
  error?: string;
  createdAt: number;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ----------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------

interface AIAssistantProps {
  /**
   * If false, the bubble is not rendered. Use to gate the assistant
   * behind a feature flag or role check.
   */
  enabled?: boolean;
}

export function AIAssistant({ enabled = true }: AIAssistantProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [hasSavedConversations, setHasSavedConversations] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  // Focus composer when the panel opens.
  useEffect(() => {
    if (open) {
      // Defer to next tick so the slide-in animation doesn't fight us.
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  // Restore conversation id, transcript, and any still-live pending
  // action cards after a page refresh — a staged draft survives in the
  // database, so it must survive in the UI too.
  useEffect(() => {
    const saved = window.localStorage.getItem('ba-bazaar-ai-conversation-id');
    getAgentConversations()
      .then((conversations) => setHasSavedConversations(conversations.length > 0))
      .catch(() => setHasSavedConversations(false));
    if (!saved) return;
    setConversationId(saved);
    Promise.all([
      getAgentMessages(saved),
      getAgentPending(saved).catch(() => [] as AgentPendingItem[])
    ])
      .then(([history, pendingItems]) => {
        const restored = history
          // Tool-call-only assistant turns have empty content; nothing
          // to render for those.
          .filter((m) => !(m.role === 'assistant' && !m.content.trim()))
          .map(apiMessageToLocal);
        const cards = pendingItems.map(pendingItemToLocal);
        setMessages([...restored, ...cards]);
      })
      .catch(() => {
        window.localStorage.removeItem('ba-bazaar-ai-conversation-id');
      });
  }, []);

  // Tick to update undo-window countdowns.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const startNew = useCallback(() => {
    setConversationId(undefined);
    setMessages([]);
    setDraft('');
    setQuickReplies([]);
    window.localStorage.removeItem('ba-bazaar-ai-conversation-id');
  }, []);

  // -------- send --------

  const sendText = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text || sending) return;
    setDraft('');
    setQuickReplies([]);

    // Optimistic user bubble.
    const userMsg: LocalMessage = {
      id: newId(),
      role: 'user',
      content: text,
      createdAt: Date.now()
    };
    setMessages((m) => [...m, userMsg]);
    setSending(true);

    // Add a synthetic "thinking" pill that the response will replace
    // with the real tool-call steps.
    setMessages((m) => [
      ...m,
      {
        id: newId(),
        role: 'thinking',
        content: 'Thinking…',
        createdAt: Date.now()
      }
    ]);

    try {
      await new Promise<void>((resolve, reject) => {
        streamAgentChat(text, conversationId, {
          onStep: (step) => applyStreamStep(step),
          onToken: (token) => appendToken(token),
          onActions: (replies) => setQuickReplies(replies),
          onDone: (done) => {
            setConversationId(done.conversation_id);
            window.localStorage.setItem('ba-bazaar-ai-conversation-id', done.conversation_id);
            // Functional update: the closure's `quickReplies` is stale
            // (captured before the stream started), so deciding on it
            // would overwrite the server-generated replies that arrived
            // via onActions a moment ago.
            setQuickReplies((prev) =>
              prev.length > 0 ? prev : fallbackQuickRepliesFromFinal(done.final)
            );
            resolve();
          },
          onError: reject
        }).catch(reject);
      });
    } catch (err) {
      setMessages((m) => [
        ...m.filter((x) => x.role !== 'thinking'),
        {
          id: newId(),
          role: 'assistant',
          content: '',
          error: err instanceof Error ? err.message : 'Request failed',
          createdAt: Date.now()
        }
      ]);
    } finally {
      setSending(false);
    }
    // Streamed steps arrive incrementally from the SSE endpoint.
  }, [sending, conversationId]);

  const send = useCallback(() => {
    sendText(draft);
  }, [draft, sendText]);

  const appendToken = useCallback((token: string) => {
    setMessages((m) => {
      const next = m.filter((x) => x.role !== 'thinking');
      const last = next[next.length - 1];
      if (last?.role === 'assistant' && last.id === 'streaming-assistant') {
        return next.map((x) =>
          x.id === 'streaming-assistant' ? { ...x, content: x.content + token } : x
        );
      }
      next.push({
        id: 'streaming-assistant',
        role: 'assistant',
        content: token,
        createdAt: Date.now()
      });
      return next;
    });
  }, []);

  const applyStreamStep = useCallback((s: AgentStep) => {
    setMessages((m) => {
      const next = m.filter((x) => x.role !== 'thinking');
      if (s.kind === 'tool_call') {
        next.push({
          id: newId(),
          role: 'tool',
          content: formatToolCall(s),
          step: s,
          createdAt: Date.now()
        });
        return next;
      }
      if (s.kind === 'tool_result') {
        const summary = formatToolResult(s);
        const callId = s.tool_call_id ?? '';
        if (callId) {
          for (let i = next.length - 1; i >= 0; i--) {
            const x = next[i];
            if (
              x.role === 'tool' &&
              x.step?.kind === 'tool_call' &&
              (x.step as AgentStep & { tool_call_id?: string }).tool_call_id === callId
            ) {
              next[i] = {
                ...x,
                step: s,
                content: summary,
                pending: s.pending_action,
                expiresAt: s.pending_action
                  ? Date.now() + s.pending_action.undo_window_seconds * 1000
                  : x.expiresAt,
              };
              return next;
            }
          }
        }
        next.push({
          id: newId(),
          role: 'tool',
          content: summary,
          step: s,
          pending: s.pending_action,
          expiresAt: s.pending_action
            ? Date.now() + s.pending_action.undo_window_seconds * 1000
            : undefined,
          createdAt: Date.now()
        });
        return next;
      }
      // Note: only the live token stream suppresses the final step
      // (it would duplicate the streamed text). An unconfirmed pending
      // card — including one from an earlier turn — must NOT block new
      // answers from rendering.
      if (s.kind === 'final' && s.content && !next.some((x) => x.id === 'streaming-assistant')) {
        next.push({
          id: newId(),
          role: 'assistant',
          content: s.content,
          createdAt: Date.now()
        });
      }
      return next;
    });
  }, []);

  // -------- confirm / undo --------

  const confirm = useCallback(async (pending: AgentPendingAction) => {
    try {
      const r = await postAgentConfirm(pending.id);
      setMessages((m) =>
        m.map((x) =>
          x.pending?.id === pending.id
            ? {
                ...x,
                content: `${x.content} — confirmed (result: ${r.result_id.slice(0, 8)}…)`,
                pending: undefined,
                expiresAt: undefined
              }
            : x
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Confirm failed';
      // Terminal failures (expired / already finalised / gone) can
      // never succeed, so drop the card. Anything else — a network
      // blip, a 500 — keeps the card so the user can simply retry.
      const terminal = /expired|cannot confirm|not found|not permitted/i.test(msg);
      setMessages((m) =>
        m.map((x) =>
          x.pending?.id === pending.id
            ? {
                ...x,
                content: `${x.content}\n❌ ${msg}`,
                pending: terminal ? undefined : x.pending,
                expiresAt: terminal ? undefined : x.expiresAt
              }
            : x
        )
      );
    }
  }, []);

  // "Cancel" discards the staged draft before it executes. (The HTTP
  // route is still named /undo for compatibility.)
  const cancel = useCallback(async (pending: AgentPendingAction) => {
    try {
      await postAgentUndo(pending.id);
    } catch {
      // The server may have already expired it; either way, drop the
      // card from the UI.
    }
    setMessages((m) =>
      m.map((x) =>
        x.pending?.id === pending.id
          ? { ...x, content: `${x.content} — cancelled`, pending: undefined, expiresAt: undefined }
          : x
      )
    );
  }, []);

  // -------- render --------

  if (!enabled) return null;

  return (
    <>
      {/* Bubble — bottom-right, fixed, sits above everything else. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close AI Assistant' : 'Open AI Assistant'}
        className={cn(
          'fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full',
          'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg transition-transform',
          'hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2',
          open && 'scale-95'
        )}
      >
        {open ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>

      {/* Panel — slides up from the bubble. */}
      {open && (
        <div
          role="dialog"
          aria-label="AI Assistant"
          className={cn(
            'fixed bottom-24 right-5 z-50 flex w-[min(420px,calc(100vw-2.5rem))] flex-col',
            'rounded-2xl border border-slate-200 bg-white shadow-2xl',
            'max-h-[min(640px,calc(100vh-8rem))]'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between rounded-t-2xl border-b border-slate-100 bg-gradient-to-br from-blue-50 to-indigo-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-white">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Ba-Bazaar Assistant</div>
                <div className="text-xs text-slate-500">Reads everything, writes only with your say-so</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={startNew}
                disabled={sending || (!conversationId && messages.length === 0 && !hasSavedConversations)}
                className="h-8 px-2 text-xs text-slate-600"
              >
                Start new
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
            data-testid="ai-message-list"
          >
            {messages.length === 0 && !sending && (
              <EmptyState onPick={sendText} />
            )}

            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onConfirm={confirm}
                onCancel={cancel}
              />
            ))}

            {sending && messages[messages.length - 1]?.role !== 'thinking' && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                Working on it…
              </div>
            )}
          </div>

          {quickReplies.length > 0 && !sending && (
            <QuickReplyBar replies={quickReplies} onPick={sendText} />
          )}

          {/* Composer */}
          <div className="border-t border-slate-100 p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="flex items-end gap-2"
            >
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Ask about capacity, find a BA, or draft a booking…"
                rows={1}
                disabled={sending}
                className={cn(
                  'min-h-[40px] max-h-32 flex-1 resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm',
                  'focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400',
                  'disabled:opacity-60'
                )}
              />
              <Button type="submit" size="icon" disabled={!draft.trim() || sending} aria-label="Send">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
            <div className="mt-1 px-1 text-[10px] text-slate-400">
              Press Enter to send, Shift+Enter for newline. Writes require your confirmation.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ----------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------

function apiMessageToLocal(m: ApiMessage): LocalMessage {
  return {
    id: m.id,
    role: m.role === 'tool' ? 'tool' : m.role,
    content: m.role === 'tool' ? formatStoredToolMessage(m) : m.content,
    createdAt: new Date(m.created_at).getTime() || Date.now()
  };
}

// pendingItemToLocal rebuilds a Confirm/Cancel card from the server's
// pending-actions list (used after a page refresh).
function pendingItemToLocal(p: AgentPendingItem): LocalMessage {
  const summary = typeof p.preview?.summary === 'string' ? (p.preview.summary as string) : '';
  return {
    id: `pending-${p.id}`,
    role: 'tool',
    content: summary || humanToolName(p.tool_name),
    pending: {
      id: p.id,
      tool_name: p.tool_name,
      args: p.args,
      preview: p.preview,
      undo_window_seconds: p.undo_window_seconds
    },
    expiresAt: new Date(p.expires_at).getTime() || Date.now(),
    createdAt: Date.now()
  };
}

function formatStoredToolMessage(m: ApiMessage): string {
  if (m.tool_name) {
    return `${humanToolName(m.tool_name)}: ${m.content}`;
  }
  return m.content;
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  const suggestions = [
    'Who is good at payments and has capacity in Q3?',
    "Show me Trung's bookings for this month",
    'Draft a booking for An on Project Falcon for 6 weeks',
    "Why did utilization drop last week?"
  ];
  return (
    <div className="space-y-3 py-4">
      <div className="text-center text-sm text-slate-500">
        Try one of these:
      </div>
      <div className="flex flex-col gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-700 hover:border-blue-300 hover:bg-blue-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function fallbackQuickRepliesFromFinal(final: string): string[] {
  const lower = final.toLowerCase();
  if (lower.includes('draft') || lower.includes('confirm')) {
    return ['Confirm draft', 'Change dates', 'Find another BA', 'Cancel'];
  }
  if (lower.includes('capacity')) {
    return ['Show bookings', 'Find available BA', 'Draft booking'];
  }
  return ['Show details', 'Check capacity', 'Draft booking'];
}

function QuickReplyBar({ replies, onPick }: { replies: string[]; onPick: (prompt: string) => void }) {
  return (
    <div className="border-t border-slate-100 px-3 py-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        Quick replies
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {replies.map((reply) => (
          <button
            key={reply}
            type="button"
            onClick={() => onPick(reply)}
            className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:border-blue-300 hover:bg-blue-50"
          >
            {reply}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onConfirm,
  onCancel
}: {
  message: LocalMessage;
  onConfirm: (p: AgentPendingAction) => void;
  onCancel: (p: AgentPendingAction) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-3 py-2 text-sm text-white">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === 'thinking') {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        {message.content}
      </div>
    );
  }

  if (message.role === 'tool') {
    // "Tool" in our local model is anything the agent did internally:
    // a tool call, a tool result, or a pending action card.
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-2">
          <Wrench className="mt-1 h-3 w-3 flex-shrink-0 text-slate-400" />
          <div className="text-xs text-slate-600">
            <div className="whitespace-pre-wrap">{message.content}</div>
          </div>
        </div>
        {message.pending && message.expiresAt && (
          <PendingActionCard
            pending={message.pending}
            expiresAt={message.expiresAt}
            onConfirm={() => onConfirm(message.pending!)}
            onCancel={() => onCancel(message.pending!)}
          />
        )}
        {message.error && (
          <div className="ml-5 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
            {message.error}
          </div>
        )}
      </div>
    );
  }

  // Assistant text.
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2 text-sm text-slate-900">
        {message.error ? (
          <span className="text-red-700">⚠ {message.error}</span>
        ) : (
          <FormattedAssistantContent content={message.content} />
        )}
      </div>
    </div>
  );
}

function FormattedAssistantContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const tableStart = lines.findIndex((line) => line.trim().startsWith('|'));
  if (tableStart >= 0) {
    const before = lines.slice(0, tableStart).join('\n').trim();
    const tableLines = lines.slice(tableStart).filter((line) => line.trim().startsWith('|'));
    const afterIndex = tableStart + tableLines.length;
    const after = lines.slice(afterIndex).join('\n').trim();
    return (
      <div className="space-y-2">
        {before && <FormattedTextBlock text={before} />}
        <MarkdownTable lines={tableLines} />
        {after && <FormattedTextBlock text={after} />}
      </div>
    );
  }
  return <FormattedTextBlock text={content} />;
}

function FormattedTextBlock({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return (
    <div className="space-y-2">
      {blocks.map((block, idx) => {
        const cleaned = stripMarkdownHeading(block);
        if (/^\d+\.\s/m.test(cleaned)) {
          return <ol key={idx} className="list-decimal space-y-1 pl-5">{cleaned.split('\n').map((line) => <li key={line}>{formatInline(line.replace(/^\d+\.\s*/, ''))}</li>)}</ol>;
        }
        if (/^[-*]\s/m.test(cleaned)) {
          return <ul key={idx} className="list-disc space-y-1 pl-5">{cleaned.split('\n').map((line) => <li key={line}>{formatInline(line.replace(/^[-*]\s*/, ''))}</li>)}</ul>;
        }
        return <p key={idx} className="leading-relaxed">{formatInline(cleaned)}</p>;
      })}
    </div>
  );
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const rows = lines
    .filter((line) => !/^\|?\s*:?-{2,}:?/.test(line.replace(/\|/g, '').trim()))
    .map((line) => line.split('|').map((cell) => cell.trim()).filter(Boolean));
  const [header, ...body] = rows;
  if (!header || body.length === 0) return <FormattedTextBlock text={lines.join('\n')} />;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>{header.map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{formatInline(h)}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {body.map((row, i) => (
            <tr key={i}>{header.map((_, j) => <td key={j} className="px-2 py-1.5 align-top text-slate-800">{formatInline(row[j] ?? '')}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stripMarkdownHeading(text: string) {
  return text.replace(/^#{1,6}\s+/gm, '').replace(/^---+$/gm, '').trim();
}

function formatInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function PendingActionCard({
  pending,
  expiresAt,
  onConfirm,
  onCancel
}: {
  pending: AgentPendingAction;
  expiresAt: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  const expired = remaining <= 0;
  return (
    <Card className="ml-5 border-amber-200 bg-amber-50">
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-amber-900">
            {humanToolName(pending.tool_name)}
          </div>
          <div className="text-[10px] text-amber-700">
            {expired ? 'Draft expired' : `Draft expires in ${remaining}s`}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-3 pt-0">
        <PendingPreview preview={pending.preview} />
        {!expired && (
          <div className="flex gap-2">
            <Button size="sm" onClick={onConfirm} className="flex-1">
              <Check className="mr-1 h-3 w-3" />
              Confirm
            </Button>
            <Button size="sm" variant="secondary" onClick={onCancel} className="flex-1">
              <Undo2 className="mr-1 h-3 w-3" />
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PendingPreview({ preview }: { preview: Record<string, unknown> }) {
  // The backend always returns a `summary` line + a `draft` block.
  // Render both for the user to review.
  const summary = typeof preview.summary === 'string' ? preview.summary : '';
  const draft = preview.draft as Record<string, unknown> | undefined;
  return (
    <div className="space-y-1 text-xs text-amber-900">
      {summary && <div className="font-medium">{summary}</div>}
      {draft && (
        <dl className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 text-[11px]">
          {Object.entries(draft).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-amber-700">{k}:</dt>
              <dd className="truncate">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
// Formatting helpers
// ----------------------------------------------------------------------

function humanToolName(name: string): string {
  switch (name) {
    case 'search_bars':
      return '🔍 Searched BAs';
    case 'get_capacity':
      return '📊 Checked capacity';
    case 'list_bookings':
      return '📋 Listed bookings';
    case 'get_ba':
      return '👤 Got BA profile';
    case 'draft_booking':
      return '✏️ Drafted booking';
    case 'draft_create_project':
      return '🏗️ Drafted project';
    case 'draft_reject_booking':
      return '✏️ Drafted rejection';
    default:
      return `🛠 ${name}`;
  }
}

function formatToolCall(step: AgentStep): string {
  const args = step.args ?? {};
  if (step.tool_name === 'search_bars') {
    return `Search BAs: "${args.query ?? ''}"`;
  }
  if (step.tool_name === 'get_capacity') {
    return `Check capacity: BA ${shortId(args.ba_id)}`;
  }
  if (step.tool_name === 'list_bookings') {
    return `List bookings${args.status ? ` (${args.status})` : ''}`;
  }
  if (step.tool_name === 'get_ba') {
    return `Get BA ${shortId(args.ba_id)}`;
  }
  if (step.tool_name === 'search_projects') {
  return `Search projects: "${args.query ?? ''}"`;
  }
  if (step.tool_name === 'draft_booking') {
    return `Draft booking for BA ${shortId(args.ba_id)}`;
  }
  if (step.tool_name === 'draft_create_project') {
    return `Draft create project "${args.name ?? ''}"`;
  }
  if (step.tool_name === 'draft_reject_booking') {
    return `Draft rejection for booking ${shortId(args.booking_id)}`;
  }
  return `Called ${step.tool_name}`;
}

function formatToolResult(step: AgentStep): string {
  const r = step.result;
  if (!r || typeof r !== 'object') return 'No data';
  const obj = r as Record<string, unknown>;
  // The tool's preview.summary is the cleanest human line.
  if (typeof obj.summary === 'string') return obj.summary;
  if (typeof obj.count === 'number') {
    return `${obj.count} result${obj.count === 1 ? '' : 's'}`;
  }
  if (step.tool_name === 'get_capacity') {
    if (typeof obj.free_percent === 'number') {
      return `Free: ${Math.round(obj.free_percent)}%`;
    }
    if (typeof obj.used_percent === 'number') {
      return `Used: ${Math.round(obj.used_percent)}%`;
    }
  }
  if (obj.error) return `Error: ${String(obj.error)}`;
  return 'Done';
}

function shortId(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  if (s.length <= 8) return s;
  return s.slice(0, 8) + '…';
}

// `ApiMessage` is re-exported so other surfaces (e.g. a future
// ConversationListDrawer) can share the same shape.
export type { ApiMessage };
