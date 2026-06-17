import { useState, useEffect, useRef } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGlobalFab, type FabAction } from '@/context/GlobalFabContext';

interface GlobalActionDialProps {
  canCreateBooking: boolean;
  onTriggerCreateBooking: () => void;
  defaultPrimaryLabel?: string;
}

export function GlobalActionDial({
  canCreateBooking,
  onTriggerCreateBooking,
  defaultPrimaryLabel = 'Create booking'
}: GlobalActionDialProps) {
  const { primaryAction, visible, setChatOpen } = useGlobalFab();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Auto-close on scroll
  useEffect(() => {
    if (!open) return;

    function handleScroll() {
      setOpen(false);
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Click outside to close (scrim click)
  const handleScrimClick = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // Keyboard navigation & Focus Trap within the speed dial
  const handleContainerKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return;

    const focusableElements = containerRef.current?.querySelectorAll(
      'button:not([disabled])'
    );
    if (!focusableElements || focusableElements.length === 0) return;

    const firstEl = focusableElements[0] as HTMLElement;
    const lastEl = focusableElements[focusableElements.length - 1] as HTMLElement;

    if (event.key === 'Tab') {
      if (event.shiftKey) {
        // Shift + Tab -> Wrap from first to last
        if (document.activeElement === firstEl) {
          event.preventDefault();
          lastEl.focus();
        }
      } else {
        // Tab -> Wrap from last to first
        if (document.activeElement === lastEl) {
          event.preventDefault();
          firstEl.focus();
        }
      }
    }
  };

  // Focus the first action element when expanded
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        const focusableElements = containerRef.current?.querySelectorAll(
          'button:not([disabled])'
        );
        if (focusableElements && focusableElements.length > 1) {
          // The first action element is at index 0 (Ask AI) or index 1 (Primary Action)
          // Let's focus the Ask AI button first, which is the first child in layout order
          (focusableElements[0] as HTMLElement).focus();
        }
      }, 50);
    }
  }, [open]);

  if (!visible) return null;

  // Resolve the active primary action:
  // 1. If the current page registered a custom action, use it.
  // 2. Otherwise, if the user has booking creation rights, fall back to "Create booking".
  // 3. Otherwise, no primary action is available.
  const resolvedPrimary: FabAction | null = primaryAction
    ? primaryAction
    : canCreateBooking
      ? {
          label: defaultPrimaryLabel,
          icon: <Plus className="h-5 w-5" />,
          onPress: onTriggerCreateBooking
        }
      : null;

  const handleActionClick = (handler: () => void) => {
    handler();
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      ref={containerRef}
      onKeyDown={handleContainerKeyDown}
      className="fixed z-50 bottom-[calc(96px+env(safe-area-inset-bottom,0px))] right-[18px] lg:bottom-6 lg:right-[110px]"
    >
      {/* Scrim / Backdrop */}
      <div
        onClick={handleScrimClick}
        className={cn(
          'fixed inset-0 z-40 bg-black transition-opacity duration-150',
          open
            ? 'pointer-events-auto opacity-[0.42]'
            : 'pointer-events-none opacity-0'
        )}
      />

      {/* Floating Speed Dial Actions */}
      <div
        role="menu"
        aria-label="Speed dial actions"
        className={cn(
          'absolute bottom-0 right-0 z-50 flex flex-col items-end gap-3 pb-[74px] transition-all',
          open
            ? 'pointer-events-auto'
            : 'pointer-events-none'
        )}
      >


        {/* Item 1: Primary Action (per-page, closest to trigger) */}
        {resolvedPrimary && (
          <button
            role="menuitem"
            type="button"
            onClick={() => handleActionClick(resolvedPrimary.onPress)}
            style={{
              boxShadow: '0 8px 24px rgba(47,107,255,.45)'
            }}
            className={cn(
              'flex h-[50px] items-center gap-[9px] rounded-[25px] bg-[#2F6BFF] px-5 text-sm font-semibold text-white transition-all active:scale-[0.94] hover:bg-blue-600',
              'motion-safe:transition-all motion-safe:duration-[220ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]',
              open
                ? 'translate-y-0 scale-100 opacity-100'
                : 'translate-y-4 scale-95 opacity-0 motion-reduce:hidden'
            )}
          >
            {resolvedPrimary.icon}
            <span>{resolvedPrimary.label}</span>
          </button>
        )}
      </div>

      {/* Main Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open actions"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          boxShadow: '0 8px 24px rgba(47,107,255,.45)'
        }}
        className={cn(
          'relative z-50 flex h-15 w-15 items-center justify-center rounded-full bg-[#2F6BFF] text-white hover:bg-blue-600 active:scale-[0.94]',
          'h-[60px] w-[60px]'
        )}
      >
        <Plus
          className={cn(
            'h-6 w-6 transition-transform duration-250 ease-out',
            open && 'rotate-45'
          )}
        />
      </button>
    </div>
  );
}
