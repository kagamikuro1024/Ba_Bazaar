import { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { chatStream, type ChatStreamEvent } from '@/lib/chatStream';
import { type ChatMessage, createId } from './types';

// ---------------------------------------------------------------------------
// useChatSession — manages messages + streaming for a single thread.
//
// Owns:
//   * the message log
//   * the current thread id (returned by ba-chat on first turn)
//   * an AbortController so the panel can cancel an in-flight stream
// ---------------------------------------------------------------------------

type Options = {
  accessToken: string | null;
  userRole?: string;
  userId?: string;
};

export function useChatSession(options: Options) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setThreadId(null);
    setIsStreaming(false);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userMessage: ChatMessage = {
        id: createId('u'),
        role: 'user',
        content: trimmed
      };
      const assistantId = createId('a');
      const placeholder: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        pending: true
      };
      setMessages((prev) => [...prev, userMessage, placeholder]);
      setError(null);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const stream = chatStream({
          message: trimmed,
          threadId,
          accessToken: options.accessToken,
          userRole: options.userRole,
          userId: options.userId,
          signal: controller.signal
        });
        for await (const event of stream) {
          applyEvent(event, assistantId, setMessages, setThreadId);
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') {
          finalizePending(assistantId, '_(cancelled)_', setMessages);
        } else {
          const message = err instanceof Error ? err.message : 'chat failed';
          setError(message);
          finalizePending(assistantId, '', setMessages);
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [isStreaming, options.accessToken, options.userId, options.userRole, threadId]
  );

  return { messages, send, cancel, reset, threadId, isStreaming, error };
}

function applyEvent(
  event: ChatStreamEvent,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setThreadId: React.Dispatch<React.SetStateAction<string | null>>
) {
  if (event.type === 'ready' && event.threadId) {
    setThreadId(event.threadId);
    return;
  }
  if (event.type === 'state') {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantId
          ? { ...msg, intent: event.intent, analyzeTarget: event.analyzeTarget }
          : msg
      )
    );
    return;
  }
  if (event.type === 'token') {
    flushSync(() => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId ? { ...msg, content: msg.content + event.text } : msg
        )
      );
    });
    return;
  }
  if (event.type === 'final') {
    if (event.threadId) setThreadId(event.threadId);
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantId
          ? {
              ...msg,
              pending: false,
              content: event.content || msg.content,
              actionButtons: event.actionButtons,
              actionField: event.actionField,
            }
          : msg
      )
    );
    return;
  }
  if (event.type === 'error') {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantId
          ? { ...msg, pending: false, content: msg.content || `_${event.message}_` }
          : msg
      )
    );
  }
}

function finalizePending(
  assistantId: string,
  fallbackText: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
) {
  setMessages((prev) =>
    prev.map((msg) =>
      msg.id === assistantId
        ? { ...msg, pending: false, content: msg.content || fallbackText }
        : msg
    )
  );
}
