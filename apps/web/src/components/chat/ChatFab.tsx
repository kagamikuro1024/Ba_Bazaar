import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChatPanel } from './ChatPanel';

// ---------------------------------------------------------------------------
// ChatFab — fixed-position FAB that toggles the chat panel.
//
// Designed to coexist with the bottom nav and booking FAB:
//   * On mobile/tablet, chat sits beside the pill nav at bottom-right.
//   * Booking FAB stays above the nav.
//   * On desktop, it returns to the standard bottom-right corner.
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
          'fixed z-50 flex h-[4.125rem] w-[4.125rem] items-center justify-center rounded-full text-white shadow-lg shadow-blue-600/40 transition-transform active:scale-95',
          'bottom-4 right-4 lg:bottom-6 lg:right-6',
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
