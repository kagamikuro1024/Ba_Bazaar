import { useEffect, useRef } from 'react';
import { X, Sparkles, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChatBubble } from './ChatBubble';
import { ChatComposer } from './ChatComposer';
import { useChatSession } from './useChatSession';

// ---------------------------------------------------------------------------
// ChatPanel — slide-over panel anchored to the bottom-right FAB.
//
// Talks to the ba-chat SSE service (apps/ai). Forwards the current user's
// access token and role so the chat agent can call the Go API on their behalf.
// ---------------------------------------------------------------------------

const SUGGESTED_PROMPTS = [
  'Show me the manager dashboard',
  "What's pending in the action center?",
  'Summarize this month’s utilization report'
];

export function ChatPanel({
  open,
  onClose,
  accessToken,
  userRole,
  userId
}: {
  open: boolean;
  onClose: () => void;
  accessToken: string | null;
  userRole?: string;
  userId?: string;
}) {
  const session = useChatSession({ accessToken, userRole, userId });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session.messages.length, session.messages]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      role="dialog"
      aria-label="Chat with Ba_Bazaar assistant"
      className={cn(
        'fixed bottom-24 right-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-150',
        'sm:bottom-6 sm:right-6',
        open
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-4 opacity-0'
      )}
      style={{ maxHeight: 'min(640px, calc(100vh - 6rem))' }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-gradient-to-r from-blue-50/80 to-white px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-950">Ba_Bazaar Assistant</p>
            <p className="text-[11px] text-slate-500">
              Read-only · grounded in your live workspace
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Reset conversation"
            disabled={session.messages.length === 0 && !session.isStreaming}
            onClick={session.reset}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-slate-50 py-3">
        {session.messages.length === 0 ? (
          <EmptyState onPick={(prompt) => session.send(prompt)} />
        ) : (
          <div className="grid gap-3">
            {session.messages.map((msg) => (
              <ChatBubble
                key={msg.id}
                message={msg}
                disabled={session.isStreaming}
                onActionPick={(value) => {
                  if (value === '__custom__') return; // let user type freely
                  session.send(value);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {session.error ? (
        <div className="border-t border-rose-100 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700">
          {session.error}
        </div>
      ) : null}

      <ChatComposer
        onSend={session.send}
        onCancel={session.cancel}
        isStreaming={session.isStreaming}
        disabled={session.isStreaming}
      />
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="grid gap-3 px-3 text-sm text-slate-600">
      <p>
        Ask about the dashboard, the action center, your schedule, or this month's reports.
        Replies are grounded in live data — never guessed.
      </p>
      <div className="grid gap-2">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
