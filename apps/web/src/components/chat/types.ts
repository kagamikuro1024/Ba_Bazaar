import { type ActionButton } from '@/lib/chatStream';

// Shared types for the chat FAB + panel.

export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  pending?: boolean;
  intent?: string | null;
  analyzeTarget?: string | null;
  actionButtons?: ActionButton[];
  actionField?: string;
};

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
