import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, type BAProfile, type Booking, type UserRole } from '@/lib/api';

export type SearchResultItem = {
  id: string;
  kind: 'recent' | 'suggestion' | 'booking' | 'ba' | 'project' | 'page' | 'action';
  label: string;
  meta?: string;
  tag?: string;
  to?: string;
  action?: () => void;
  icon: string;
};

type PageItem = {
  to: string;
  label: string;
  meta?: string;
};

type GlobalSearchModalProps = {
  open: boolean;
  onClose: () => void;
  role?: UserRole;
  pageItems: PageItem[];
  recentSearches: string[];
  onCommitRecent: (term: string) => void;
  onClearRecent: () => void;
  onTriggerCreateBooking: () => void;
};

const SEARCH_DEBOUNCE_MS = 220;
const MAX_RESULTS = 16;
const RECENT_LIMIT = 5;
const RECENT_STORAGE_KEY = 'ba-bazaar:global-search-recent';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveRecent(values: string[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(values.slice(0, RECENT_LIMIT)));
}

/**
 * Lightweight debounce hook that returns a stable callback whose return value
 * updates after `delay` ms of input stability. Used to throttle expensive
 * filtering work while the user is still typing.
 */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

type HighlightProps = {
  text: string;
  pattern: RegExp | null;
};

/**
 * Highlights matches of `pattern` in `text` using the supplied regex.
 * The caller is responsible for compiling the pattern once (see below) so we
 * do not re-parse or mutate lastIndex on every render.
 */
function Highlight({ text, pattern }: HighlightProps) {
  if (!pattern) {
    return <>{text}</>;
  }

  // String.split with a capturing regex yields alternating non-match / match
  // segments. We rebuild the regex without the /g flag for a stateless test.
  const tester = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) =>
        tester.test(part) ? (
          <mark
            key={`${index}-${part}`}
            className="rounded bg-violet-100 px-0.5 text-violet-700"
          >
            {part}
          </mark>
        ) : (
          <span key={`${index}-${part}`}>{part}</span>
        )
      )}
    </>
  );
}

export function GlobalSearchModal({
  open,
  onClose,
  role,
  pageItems,
  recentSearches,
  onCommitRecent,
  onClearRecent,
  onTriggerCreateBooking
}: GlobalSearchModalProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const trimmed = debouncedQuery.trim();
  const trimmedLive = query.trim();
  const hasQuery = trimmed.length > 0;

  // Reset transient state every time the modal is (re)opened so previous
  // sessions don't bleed in.
  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    const handle = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(handle);
  }, [open]);

  // Keep the active item in view as the user arrows through results.
  useEffect(() => {
    if (!open || !bodyRef.current) return;
    const node = bodyRef.current.querySelector<HTMLElement>(
      `[data-search-index="${activeIndex}"]`
    );
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  // Compile a single highlight regex per query. This is the hot path during
  // typing: previously we recompiled a new RegExp for every result row and
  // mutated lastIndex because of pattern.test() on a /g regex.
  const highlightPattern = useMemo<RegExp | null>(() => {
    if (!hasQuery) return null;
    return new RegExp(`(${escapeRegExp(trimmed)})`, 'ig');
  }, [hasQuery, trimmed]);

  // Build the suggestion list (used when the input is empty). These are pure
  // local computations keyed on role, so memoize to avoid rebuilding on
  // unrelated state changes.
  const suggestionItems = useMemo<SearchResultItem[]>(() => {
    const items: SearchResultItem[] = [];
    if (role === 'BA_MANAGER' || role === 'ADMIN') {
      items.push(
        {
          id: 'suggest-urgent',
          kind: 'suggestion',
          label: 'Urgent requests waiting for action',
          meta: 'Open Action Center with urgent filter',
          tag: 'Filter',
          to: '/manager/action-center?priority=URGENT',
          icon: '🔥'
        },
        {
          id: 'suggest-available',
          kind: 'suggestion',
          label: 'BA available this week',
          meta: 'Browse active BA directory',
          tag: 'BA',
          to: '/crm/ba?status=ACTIVE',
          icon: '🟢'
        }
      );
    }
    items.push({
      id: 'action-create-booking',
      kind: 'action',
      label: 'Create booking request',
      meta: 'Quick action',
      tag: 'Action',
      action: onTriggerCreateBooking,
      icon: '＋'
    });
    return items;
  }, [role, onTriggerCreateBooking]);

  // Memoize the page list once per role/items change so we don't allocate a
  // fresh array on every keystroke.
  const pageResultItems = useMemo<SearchResultItem[]>(
    () =>
      pageItems.map((item) => ({
        id: `page-${item.to}`,
        kind: 'page',
        label: item.label,
        meta: item.meta,
        tag: 'Page',
        to: item.to,
        icon: '📄'
      })),
    [pageItems]
  );

  // Server-side BA search: pushes the filter to Postgres/Prisma instead of
  // downloading the full BA roster. We keep `staleTime` high so reopening the
  // modal doesn't refetch identical data.
  const basQuery = useQuery({
    queryKey: ['global-search-bas', role, trimmed],
    enabled: open && hasQuery,
    staleTime: 60_000,
    queryFn: () =>
      apiFetch<BAProfile[]>(`/api/ba?search=${encodeURIComponent(trimmed)}`)
  });

  // Bookings and projects endpoints don't support a search param yet, so we
  // fetch once on open and filter in-memory. We cap each list at 6 to bound
  // the work done per keystroke.
  const bookingsQuery = useQuery({
    queryKey: ['global-search-bookings', role],
    enabled: open && hasQuery,
    staleTime: 60_000,
    queryFn: () => apiFetch<Booking[]>('/api/bookings')
  });
  const projectsQuery = useQuery({
    queryKey: ['global-search-projects'],
    enabled: open && hasQuery,
    staleTime: 5 * 60_000,
    queryFn: () =>
      apiFetch<Array<{ id: string; name: string; color: string }>>('/api/projects')
  });

  const resultItems = useMemo<SearchResultItem[]>(() => {
    if (!hasQuery) return [];

    const q = trimmed.toLowerCase();
    const bookingItems = (bookingsQuery.data ?? [])
      .filter((booking) =>
        [
          booking.title,
          booking.description,
          booking.project?.name,
          booking.requester?.full_name,
          booking.ba?.full_name
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 6)
      .map<SearchResultItem>((booking) => ({
        id: `booking-${booking.id}`,
        kind: 'booking',
        label: booking.title,
        meta: `${booking.project?.name ?? 'Unknown project'} · ${
          booking.requester?.full_name ?? 'Unknown requester'
        } · ${booking.status}`,
        tag: 'Request',
        to:
          role === 'BA_MANAGER' || role === 'ADMIN'
            ? `/manager/action-center?bookingId=${booking.id}`
            : role === 'PM_PO'
              ? `/my-requests?bookingId=${booking.id}`
              : `/my-schedule?bookingId=${booking.id}`,
        icon: '📄'
      }));

    const baItems = (basQuery.data ?? [])
      .slice(0, 6)
      .map<SearchResultItem>((ba) => ({
        id: `ba-${ba.id}`,
        kind: 'ba',
        label: ba.full_name,
        meta: `${ba.level} · ${ba.status}`,
        tag: 'BA',
        to: `/crm/ba/${ba.id}`,
        icon: '👤'
      }));

    const projectItems = (projectsQuery.data ?? [])
      .filter((project) => project.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map<SearchResultItem>((project) => ({
        id: `project-${project.id}`,
        kind: 'project',
        label: project.name,
        meta: 'Project',
        tag: 'Project',
        to: '/timeline',
        icon: '📁'
      }));

    const pageMatches = pageResultItems.filter((item) =>
      [item.label, item.meta].filter(Boolean).join(' ').toLowerCase().includes(q)
    );

    return [...bookingItems, ...baItems, ...projectItems, ...pageMatches].slice(0, MAX_RESULTS);
  }, [basQuery.data, bookingsQuery.data, hasQuery, pageResultItems, projectsQuery.data, role, trimmed]);

  // Combined list used for keyboard navigation. Recent + suggestion are shown
  // when the input is empty; live (un-debounced) results while typing.
  type CombinedItem =
    | { id: string; kind: 'recent'; label: string; icon: string }
    | SearchResultItem;

  const liveItems = useMemo<CombinedItem[]>(() => {
    if (hasQuery) {
      return resultItems;
    }
    const recents: CombinedItem[] = recentSearches.map((value, index) => ({
      id: `recent-${index}`,
      kind: 'recent',
      label: value,
      icon: '🕐'
    }));
    return [...recents, ...suggestionItems];
  }, [hasQuery, recentSearches, resultItems, suggestionItems]);

  // Reset the active index whenever the underlying list changes length/identity.
  useEffect(() => {
    setActiveIndex((current) => {
      if (liveItems.length === 0) return 0;
      return Math.min(current, liveItems.length - 1);
    });
  }, [liveItems]);

  const runItem = useCallback(
    (item: CombinedItem) => {
      if (item.kind === 'recent') {
        // Replaying a recent search just re-populates the input.
        setQuery(item.label);
        return;
      }
      if (trimmedLive) {
        onCommitRecent(trimmedLive);
      }
      onClose();
      setQuery('');
      if (item.action) {
        item.action();
        return;
      }
      if (item.to) {
        navigate(item.to);
      }
    },
    [navigate, onClose, onCommitRecent, trimmedLive]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => {
          if (liveItems.length === 0) return 0;
          return Math.min(current + 1, liveItems.length - 1);
        });
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => Math.max(current - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = liveItems[activeIndex];
        if (item) runItem(item);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    },
    [activeIndex, liveItems, onClose, runItem]
  );

  // Render is only mounted while open=true, so we can early-return the
  // lightweight "closed" state without paying the cost of mounting the modal.
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/45 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="mx-auto mt-8 w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search requests, BA, projects..."
            className="h-10 flex-1 border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            aria-label="Search requests, BA, projects"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Clear search input"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-400">
            Esc
          </span>
        </div>
        <div ref={bodyRef} className="max-h-[28rem] overflow-y-auto">
          {!hasQuery ? (
            <EmptyState
              recentSearches={recentSearches}
              suggestionItems={suggestionItems}
              activeIndex={activeIndex}
              highlightPattern={highlightPattern}
              onSelect={runItem}
              onClearRecent={onClearRecent}
            />
          ) : resultItems.length > 0 ? (
            <ResultList
              items={resultItems}
              activeIndex={activeIndex}
              highlightPattern={highlightPattern}
              onSelect={(item) => runItem(item)}
            />
          ) : (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              No results for{' '}
              <span className="font-semibold text-slate-900">“{query.trim()}”</span>.
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-4 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <span>↑ ↓ move</span>
          <span>Enter open</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}

type EmptyStateProps = {
  recentSearches: string[];
  suggestionItems: SearchResultItem[];
  activeIndex: number;
  highlightPattern: RegExp | null;
  onSelect: (item: SearchResultItem | { id: string; kind: 'recent'; label: string; icon: string }) => void;
  onClearRecent: () => void;
};

function EmptyState({
  recentSearches,
  suggestionItems,
  activeIndex,
  highlightPattern,
  onSelect,
  onClearRecent
}: EmptyStateProps) {
  return (
    <>
      <div className="border-b border-slate-100 px-2 py-2">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Recent
          </span>
          {recentSearches.length > 0 ? (
            <button
              type="button"
              onClick={onClearRecent}
              className="text-[11px] font-semibold text-slate-500 hover:text-slate-900"
            >
              Clear
            </button>
          ) : null}
        </div>
        {recentSearches.length > 0 ? (
          recentSearches.map((value, index) => (
            <button
              key={value}
              type="button"
              data-search-index={index}
              onClick={() => onSelect({ id: `recent-${index}`, kind: 'recent', label: value, icon: '🕐' })}
              className={[
                'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50',
                activeIndex === index ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
              ].join(' ')}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm">
                🕐
              </span>
              <span className="flex-1 truncate">
                <Highlight text={value} pattern={highlightPattern} />
              </span>
            </button>
          ))
        ) : (
          <div className="px-4 py-5 text-sm text-slate-500">No recent searches yet.</div>
        )}
      </div>
      <div className="px-2 py-2">
        <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Suggestions
        </div>
        {suggestionItems.map((item, index) => {
          const absoluteIndex = recentSearches.length + index;
          return (
            <button
              key={item.id}
              type="button"
              data-search-index={absoluteIndex}
              onClick={() => onSelect(item)}
              className={[
                'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50',
                activeIndex === absoluteIndex ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
              ].join(' ')}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  <Highlight text={item.label} pattern={highlightPattern} />
                </span>
                {item.meta ? (
                  <span className="block truncate text-xs text-slate-500">
                    <Highlight text={item.meta} pattern={highlightPattern} />
                  </span>
                ) : null}
              </span>
              {item.tag ? (
                <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                  {item.tag}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

type ResultListProps = {
  items: SearchResultItem[];
  activeIndex: number;
  highlightPattern: RegExp | null;
  onSelect: (item: SearchResultItem) => void;
};

function ResultList({ items, activeIndex, highlightPattern, onSelect }: ResultListProps) {
  return (
    <div className="px-2 py-2">
      <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Results
      </div>
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          data-search-index={index}
          onClick={() => onSelect(item)}
          className={[
            'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50',
            activeIndex === index ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
          ].join(' ')}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm">
            {item.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              <Highlight text={item.label} pattern={highlightPattern} />
            </span>
            {item.meta ? (
              <span className="block truncate text-xs text-slate-500">
                <Highlight text={item.meta} pattern={highlightPattern} />
              </span>
            ) : null}
          </span>
          {item.tag ? (
            <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
              {item.tag}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

// Re-export the recent-searches persistence helpers so the parent can drive
// the modal from a single source of truth without duplicating the localStorage
// key.
export const globalSearchStorage = {
  load: loadRecent,
  save: saveRecent,
  key: RECENT_STORAGE_KEY,
  limit: RECENT_LIMIT
};

export type { PageItem };
export type CombinedItem = ReactNode;
