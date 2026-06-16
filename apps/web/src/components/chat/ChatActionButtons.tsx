import { type ActionButton } from '@/lib/chatStream';

// Renders clickable chip buttons below a bot message.
// When a button is clicked, its `value` is sent as the user's next message.
// "__custom__" opens the composer for free-text input (handled by the parent).

export function ChatActionButtons({
  buttons,
  onPick,
  disabled
}: {
  buttons: ActionButton[];
  onPick: (value: string) => void;
  disabled?: boolean;
}) {
  if (!buttons.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {buttons.map((btn) => (
        <button
          key={btn.value}
          type="button"
          disabled={disabled}
          onClick={() => onPick(btn.value)}
          className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}
