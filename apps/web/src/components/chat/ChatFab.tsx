import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChatPanel } from './ChatPanel';

// ---------------------------------------------------------------------------
// ChatFab — fixed-position FAB that toggles the chat panel.
//
// Designed to coexist with the existing booking FAB:
//   * Booking FAB lives at right-4, bottom-24 on small screens (sm:..lg: gap).
//   * This FAB pins to right-6, bottom-6 (one corner closer) so the two never
//     overlap. On mobile it sits below the bottom navigation.
// ---------------------------------------------------------------------------

export function ChatFab({
  accessToken,
  userRole,
  userId
}: {
  accessToken: string | null;
  userRole?: string;
  userId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
        className={cn(
          'fixed z-50 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg shadow-blue-600/40 transition-transform active:scale-95',
          'bottom-24 right-4 sm:bottom-6 sm:right-6',
          open ? 'bg-slate-900 hover:bg-slate-800' : 'bg-blue-600 hover:bg-blue-700'
        )}
      >
        {open ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>
      <ChatPanel
        open={open}
        onClose={() => setOpen(false)}
        accessToken={accessToken}
        userRole={userRole}
        userId={userId}
      />
    </>
  );
}
