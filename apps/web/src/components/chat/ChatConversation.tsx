import { useEffect, useRef } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatBubble } from './ChatBubble';
import { ChatComposer } from './ChatComposer';
import { useChatSession } from './useChatSession';

// ---------------------------------------------------------------------------
// ChatConversation — the chat body (messages + composer), without any modal /
// positioning shell. Designed to be embedded inside the ⌘K command palette
// ("Ask AI" mode). The AI logic lives entirely in `useChatSession`; this is
// pure presentation, so it reuses the exact same streaming/SSE pipeline.
// ---------------------------------------------------------------------------

export function ChatConversation({
  accessToken,
  userRole,
  userId
}: {
  accessToken: string | null;
  userRole?: string;
  userId?: string;
}) {
  const session = useChatSession({ accessToken, userRole, userId });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const suggestedPrompts = getSuggestedPrompts(userRole);
  const emptyStateCopy = getEmptyStateCopy(userRole);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session.messages.length, session.messages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-gradient-to-r from-blue-50/70 to-white px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <p className="text-[11px] text-slate-500">
            Grounded in your live workspace · never guessed
          </p>
        </div>
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
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-slate-50 py-3">
        {session.messages.length === 0 ? (
          <EmptyState
            copy={emptyStateCopy}
            prompts={suggestedPrompts}
            onPick={(prompt) => session.send(prompt)}
          />
        ) : (
          <div className="grid gap-3">
            {session.messages.map((msg) => (
              <ChatBubble
                key={msg.id}
                message={msg}
                disabled={session.isStreaming}
                onActionPick={(value) => {
                  if (value === '__custom__') return;
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

function EmptyState({
  copy,
  prompts,
  onPick
}: {
  copy: string;
  prompts: string[];
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="grid gap-3 px-3 text-sm text-slate-600">
      <p>{copy}</p>
      <div className="grid gap-2">
        {prompts.map((prompt) => (
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

function getSuggestedPrompts(userRole?: string) {
  if (userRole === 'BA') {
    return [
      'Show my schedule for today',
      'What work do I have this week?',
      'Summarize my upcoming assignments'
    ];
  }

  if (userRole === 'PM_PO') {
    return [
      'Show my pending requests',
      'What requests were approved or rejected this month?',
      'Summarize my current booking requests'
    ];
  }

  return [
    'Show me the manager dashboard',
    "What's pending in the action center?",
    'Summarize this month’s utilization report'
  ];
}

function getEmptyStateCopy(userRole?: string) {
  if (userRole === 'BA') {
    return 'Ask about your schedule, current assignments, or upcoming work. Replies are grounded in live data — never guessed.';
  }

  if (userRole === 'PM_PO') {
    return 'Ask about your booking requests, approval status, or recent request activity. Replies are grounded in live data — never guessed.';
  }

  return "Ask about the dashboard, the action center, your team's schedule, or this month's reports. Replies are grounded in live data — never guessed.";
}
