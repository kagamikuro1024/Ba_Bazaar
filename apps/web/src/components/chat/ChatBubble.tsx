import { type ChatMessage } from './types';
import { cn } from '@/lib/utils';
import { Sparkles, User } from 'lucide-react';
import { ChatActionButtons } from './ChatActionButtons';

// ---------------------------------------------------------------------------
// ChatBubble — renders a single message in the chat panel.
// ---------------------------------------------------------------------------

export function ChatBubble({
  message,
  onActionPick,
  disabled
}: {
  message: ChatMessage;
  onActionPick?: (value: string) => void;
  disabled?: boolean;
}) {
  const isUser = message.role === 'user';
  const showCursor = message.pending && !message.content;
  return (
    <div
      className={cn(
        'flex w-full items-start gap-2 px-3',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {!isUser ? (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <Sparkles className="h-4 w-4" />
        </div>
      ) : null}
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm',
          isUser
            ? 'rounded-br-sm bg-blue-600 text-white'
            : 'rounded-bl-sm border border-slate-200 bg-white text-slate-800'
        )}
      >
        {message.content ? (
          <MarkdownLite text={message.content} />
        ) : showCursor ? (
          <span className="inline-flex items-center gap-1 text-slate-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
          </span>
        ) : (
          <span className="italic text-slate-400">(no response)</span>
        )}
        {!isUser && message.actionButtons?.length && onActionPick ? (
          <ChatActionButtons
            buttons={message.actionButtons}
            onPick={onActionPick}
            disabled={disabled}
          />
        ) : null}
      </div>
      {isUser ? (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
          <User className="h-4 w-4" />
        </div>
      ) : null}
    </div>
  );
}

// Tiny Markdown-ish renderer: bullets + bold. Keeps the bundle lean.
// If the bot emits anything more elaborate, swap to react-markdown.
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <div className="grid gap-1">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-1" />;
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={idx} className="flex gap-2">
              <span aria-hidden className="text-blue-500">•</span>
              <span>{renderInline(trimmed.slice(2))}</span>
            </div>
          );
        }
        return <div key={idx}>{renderInline(trimmed)}</div>;
      })}
    </div>
  );
}

function renderInline(text: string) {
  // Tokenize **bold** and ==highlight==. Both are leaf tokens (no nesting) so
  // a single split-then-map keeps things deterministic and cheap.
  const parts = text.split(/(\*\*[^*]+\*\*|==[^=]+==)/g);
  return parts.map((part, idx) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold) {
      return <strong key={idx}>{bold[1]}</strong>;
    }
    const mark = /^==([^=]+)==$/.exec(part);
    if (mark) {
      return (
        <mark
          key={idx}
          className="rounded bg-amber-100 px-1 text-amber-900 ring-1 ring-amber-200/70"
        >
          {mark[1]}
        </mark>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}


