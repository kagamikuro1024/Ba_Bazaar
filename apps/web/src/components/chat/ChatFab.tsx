import { Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChatPanel } from './ChatPanel';
import { useGlobalFab } from '@/context/GlobalFabContext';

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
  const { chatOpen: open, setChatOpen: setOpen, visible } = useGlobalFab();

  if (!visible) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
        className={cn(
          'fixed z-50 flex h-[4.125rem] w-[4.125rem] items-center justify-center overflow-hidden rounded-full text-white shadow-lg transition-transform active:scale-95',
          'bottom-4 right-4 lg:bottom-6 lg:right-6',
          open
            ? 'bg-slate-900 shadow-slate-900/30 hover:bg-slate-800'
            : 'bg-blue-600 shadow-blue-600/40 hover:bg-blue-700'
        )}
      >
        {!open ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -left-2.5 -top-2.5 h-8 w-8 rounded-full bg-pink-400/70 blur-md"
          />
        ) : null}
        {!open ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0.5 left-[-48%] w-[52%] rounded-full bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.14)_20%,rgba(255,255,255,0.82)_50%,rgba(255,255,255,0.14)_80%,transparent_100%)] blur-sm mix-blend-screen animate-[chatfab-shimmer_3.6s_ease-in-out_infinite]"
          />
        ) : null}
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
