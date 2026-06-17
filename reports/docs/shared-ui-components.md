# Ba_Bazaar — Shared UI Component Library

This is the canonical reference for the shared component library that lives
under `apps/web/src/components/`. Every page in the app should compose from
these primitives — please don't roll your own button/badge/table/header
in a page file.

**Import path:** `import { ... } from '@/components'`

Source: [`apps/web/src/components/index.ts`](../../apps/web/src/components/index.ts)

---

## Table of contents

- [Page chrome](#page-chrome)
  - [`PageHeader`](#pageheader)
  - [`StatCard`](#statcard)
- [Filters & search](#filters--search)
  - [`DataToolbar`](#datatoolbar)
  - [`FilterCard`](#filtercard)
  - [`QuickTabs`](#quicktabs)
  - [`TableSearch`](#tablesearch)
  - [`FilterButton` + `AdvancedFilterPopover`](#filterbutton--advancedfilterpopover)
  - [`ActiveFilterChips`](#activefilterchips)
- [Tables & pagination](#tables--pagination)
  - [`DataTable`](#datatable)
  - [`Pagination`](#pagination)
- [States](#states)
  - [`EmptyState`](#emptystate)
  - [`ErrorState`](#errorstate)
  - [`LoadingScreen`](#loadingscreen)
- [Badges](#badges)
  - [`PriorityBadge`](#prioritybadge)
  - [`StatusBadge`](#statusbadge)
  - [`CapacityBadge`](#capacitybadge)
  - [`FlagBadge`](#flagbadge)
- [Domain components](#domain-components)
  - [`Avatar` / `BAIdentity`](#avatar--baidentity)
  - [`CreateBAModal`](#createbamodal)

---

## Page chrome

### `PageHeader`

The canonical top of every primary page. Composes an eyebrow, title,
description, an actions slot (typically page-level buttons), and a meta row
for tabs/breadcrumbs.

Source: `apps/web/src/components/PageHeader.tsx`

```ts
import { PageHeader } from '@/components';

type PageHeaderProps = {
  eyebrow?: string;        // small uppercase label above the title
  title: string;           // bold page title
  description?: string;    // one-liner under the title
  actions?: ReactNode;     // right-aligned (buttons, page-level filters)
  meta?: ReactNode;        // secondary row (tabs, breadcrumbs)
  className?: string;
};
```

**Example**

```tsx
<PageHeader
  eyebrow="Directory"
  title="BA Directory"
  description="Browse active BAs, check capacity, and request or assign people to upcoming work."
  actions={
    canManageBa ? (
      <Button onClick={() => setShowCreate(true)}>
        <Plus className="h-4 w-4" /> Create BA
      </Button>
    ) : null
  }
  meta={
    <QuickTabs
      tabs={statusTabs}
      value={status}
      onChange={setStatus}
    />
  }
/>
```

**LayoutShell interaction**

If you provide your own `<PageHeader>`, set `suppressPageHeader` on
`<LayoutShell>` to avoid a duplicate title:

```tsx
<LayoutShell suppressPageHeader>
  <BADirectoryPage />
</LayoutShell>
```

### `StatCard`

A small KPI tile. Becomes a button when `onClick` is provided — used to
make a row of stat tiles act as quick filters.

Source: `apps/web/src/components/StatCard.tsx`

```ts
import type { LucideIcon } from 'lucide-react';
import { StatCard } from '@/components';

type StatCardProps = {
  label: string;                         // small uppercase label
  value: string;                         // big number (e.g. "12", "86%", "$1.2k")
  hint?: string;                         // one-line note under the value
  icon?: LucideIcon;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  onClick?: () => void;                  // when set, renders as a button
  active?: boolean;                      // "selected" state for filter tiles
  trailing?: ReactNode;                  // small badge to the right
  className?: string;
};
```

**Example — KPI strip with active filter tiles**

```tsx
<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
  <StatCard label="Total BAs" value="15" icon={UserPlus} tone="info"
             active={!status} onClick={() => setStatus('')} />
  <StatCard label="Active" value="12" tone="success"
             active={status === 'ACTIVE'} onClick={() => setStatus('ACTIVE')} />
  <StatCard label="On bench" value="6" tone="warning" hint="Utilization ≤ 0%" />
  <StatCard label="Overbooked" value="3" tone="danger" hint="Risk capacity > 100%" />
</div>
```

---

## Filters & search

### `DataToolbar`

The search + filter button + actions strip at the top of a list page.
Pairs with [`FilterCard`](#filtercard) or sits on its own.

Source: `apps/web/src/components/DataToolbar.tsx`

```ts
type DataToolbarProps = {
  searchPlaceholder?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  activeFilterCount?: number;        // drives the count badge on the filter button
  onFiltersToggle?: () => void;
  filtersOpen?: boolean;             // controlled state if you use the popover
  actions?: ReactNode;               // right-side buttons (e.g. "Create", "Export")
  className?: string;
};
```

**Example**

```tsx
<DataToolbar
  searchPlaceholder="Search BA by name or email"
  searchValue={search}
  onSearchChange={setSearch}
  activeFilterCount={[level, status, tag].filter(Boolean).length}
  actions={
    canManageBa
      ? <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Create BA</Button>
      : null
  }
/>
```

**Debouncing**

The toolbar does not debounce internally — debounce `onSearchChange` in
the page so the API isn't called on every keystroke:

```tsx
const [search, setSearch] = useState('');
const debounced = useDebouncedValue(search, 250);
// use `debounced` in the queryKey, not `search`.
```

### `FilterCard`

A thin `Card` wrapper that gives toolbars/filters consistent padding.
Use it as the host for `DataToolbar` + any inline filter selects.

```tsx
import { FilterCard, DataToolbar } from '@/components';

<FilterCard>
  <DataToolbar
    searchValue={search}
    onSearchChange={setSearch}
  />
  <div className="mt-3 grid gap-3 md:grid-cols-3">
    <div className="grid gap-1">
      <label className="text-xs font-medium text-slate-600">Level</label>
      <select className="h-10 rounded-md border px-3" />
    </div>
    {/* more filters */}
  </div>
</FilterCard>
```

### `QuickTabs`

Pill-style segmented control for quick filtering. Single-select by default;
set `multi` for multi-select.

Source: `apps/web/src/components/QuickTabs.tsx`

```ts
import type { LucideIcon } from 'lucide-react';
import { QuickTabs, type QuickTab } from '@/components';

type QuickTab<T extends string = string> = {
  value: T;
  label: string;
  count?: number;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  icon?: ReactNode;
};

type QuickTabsProps<T extends string> = {
  tabs: Array<QuickTab<T>>;
  value: T;                          // single: the active tab; multi: comma-joined string
  onChange: (value: T) => void;
  trailing?: ReactNode;              // right-side content (e.g. "Reset filters" link)
  multi?: boolean;                   // default false
  className?: string;
};
```

**Example — single-select status strip**

```tsx
const [status, setStatus] = useState<'' | 'ACTIVE' | 'ON_LEAVE' | 'RESIGNED'>('');

const statusTabs: Array<QuickTab<typeof status>> = [
  { value: '', label: 'All', count: 15 },
  { value: 'ACTIVE', label: 'Active', count: 12, tone: 'success' },
  { value: 'ON_LEAVE', label: 'On leave', count: 2, tone: 'warning' },
  { value: 'RESIGNED', label: 'Resigned', count: 1, tone: 'danger' }
];

<QuickTabs
  tabs={statusTabs}
  value={status}
  onChange={setStatus}
  trailing={
    <button onClick={() => { setStatus(''); setLevel(''); setTag(''); }}>
      Reset filters
    </button>
  }
/>
```

**Example — multi-select (tags)**

```tsx
const [tagFilters, setTagFilters] = useState('');
<QuickTabs
  multi
  tabs={tagTabs}
  value={tagFilters}
  onChange={setTagFilters}
/>
```

### `TableSearch`

Bare-bones search input for table headers. Pairs with [`DataTable`](#datatable).
For the toolbar version (with filter button), use `DataToolbar` instead.

```tsx
import { TableSearch } from '@/components';

<TableSearch
  value={search}
  onChange={setSearch}
  placeholder="Search bookings…"
/>
```

### `FilterButton` + `AdvancedFilterPopover`

When the toolbar needs more than 2-3 inline filters, push them into a
popover attached to a `FilterButton`. The popover closes on outside click.

Source: `apps/web/src/components/AdvancedFilter.tsx`

```ts
type FilterButtonProps = {
  activeCount: number;
  onToggle: () => void;
  open: boolean;
  className?: string;
};

type AdvancedFilterPopoverProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;            // default "Advanced filters"
  width?: number;            // default 360 (px)
  footer?: ReactNode;        // e.g. <><Button variant="ghost" onClick={clearAll}>Clear all</Button><Button onClick={apply}>Apply</Button></>
};
```

**Example**

```tsx
const [filtersOpen, setFiltersOpen] = useState(false);
const [filters, setFilters] = useState({ min: 0, max: 100, status: '' });
const activeCount = (filters.min > 0 ? 1 : 0) + (filters.max < 100 ? 1 : 0) + (filters.status ? 1 : 0);

<>
  <FilterButton
    open={filtersOpen}
    activeCount={activeCount}
    onToggle={() => setFiltersOpen((v) => !v)}
  />
  <AdvancedFilterPopover
    open={filtersOpen}
    onClose={() => setFiltersOpen(false)}
    footer={
      <>
        <Button variant="ghost" onClick={() => { setFilters({ min: 0, max: 100, status: '' }); }}>
          Clear
        </Button>
        <Button onClick={() => setFiltersOpen(false)}>Apply</Button>
      </>
    }
  >
    {/* your filter fields here */}
  </AdvancedFilterPopover>
</>
```

### `ActiveFilterChips`

Renders removable chips for the currently-applied filters, with an optional
"Clear all" link. Returns `null` if the list is empty.

```ts
import { ActiveFilterChips, type ActiveFilter } from '@/components';

type ActiveFilter = {
  id: string;
  label: string;
  onRemove: () => void;
};

type ActiveFilterChipsProps = {
  filters: ActiveFilter[];
  onClearAll?: () => void;
  className?: string;
};
```

**Example**

```tsx
<ActiveFilterChips
  filters={[
    { id: 'level', label: `Level: ${level}`, onRemove: () => setLevel('') },
    { id: 'tag',   label: `Tag: ${tag}`,     onRemove: () => setTag('') }
  ]}
  onClearAll={() => { setLevel(''); setStatus(''); setTag(''); setSearch(''); }}
/>
```

---

## Tables & pagination

### `DataTable`

Generic table over your row type. Supports built-in search, custom empty
and loading states, and a toolbar slot (great place to put
`ActiveFilterChips`).

Source: `apps/web/src/components/DataTable.tsx`

```ts
type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
};

type DataTableProps<T> = {
  rows: T[];
  columns: Array<Column<T>>;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  emptyState?: ReactNode;
  loadingState?: ReactNode;
  isLoading?: boolean;
  toolbar?: ReactNode;          // right side of the table header
  className?: string;
};
```

**Example — BA list table**

```tsx
import { DataTable, StatusBadge, CapacityBadge, ActiveFilterChips } from '@/components';

const columns: Array<Column<BAProfile>> = [
  { id: 'name', header: 'Name', cell: (ba) => <BAIdentity ba={ba} /> },
  { id: 'level', header: 'Level', cell: (ba) => ba.level },
  { id: 'status', header: 'Status', cell: (ba) => <StatusBadge status={ba.status} /> },
  { id: 'capacity', header: 'Capacity', cell: (ba) => <CapacityBadge percent={ba.risk_capacity ?? 0} /> },
  { id: 'actions', header: '', cell: (ba) => (
    <Button asChild><Link to={`/crm/ba/${ba.id}`}>View</Link></Button>
  )}
];

<DataTable<BAProfile>
  rows={bas.data ?? []}
  columns={columns}
  rowKey={(ba) => ba.id}
  onRowClick={(ba) => navigate(`/crm/ba/${ba.id}`)}
  search={{ value: search, onChange: setSearch, placeholder: 'Search BA' }}
  isLoading={bas.isLoading}
  toolbar={<ActiveFilterChips filters={chips} onClearAll={reset} />}
/>
```

### `Pagination`

Page-numbered navigation. Computes a window of page numbers around the
current page with ellipses. Returns `null` when there is only one page.

```ts
import { Pagination } from '@/components';

type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  maxButtons?: number;          // default 5
  className?: string;
};
```

**Example — pair with a `useState` page**

```tsx
const [page, setPage] = useState(1);
const PAGE_SIZE = 20;

const total = bas.data?.length ?? 0;
const pageRows = (bas.data ?? []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

<DataTable rows={pageRows} columns={columns} rowKey={(r) => r.id} />
<Pagination
  page={page}
  pageSize={PAGE_SIZE}
  total={total}
  onPageChange={setPage}
/>
```

---

## States

### `EmptyState`

The standard "no data" affordance. Use for empty lists, empty search
results, and zero-state pages.

Source: `apps/web/src/components/States.tsx`

```ts
import { EmptyState } from '@/components';

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;                    // default Inbox
  action?: { label: string; onClick: () => void };
  className?: string;
};
```

**Example — BA directory empty with a "Reset" CTA**

```tsx
{rows.length === 0 ? (
  <EmptyState
    title="No BAs match your filters"
    description="Try removing a filter or clearing the search."
    action={activeFilters > 0
      ? { label: 'Reset filters', onClick: reset }
      : undefined
    }
  />
) : (
  <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />
)}
```

### `ErrorState`

The standard "something went wrong" affordance.

```ts
type ErrorStateProps = {
  title?: string;                       // default "Something went wrong"
  description?: string;
  onRetry?: () => void;                 // show "Try again" button
  error?: unknown;                      // raw error displayed (dev-friendly)
  className?: string;
};
```

**Example**

```tsx
{bas.error ? (
  <ErrorState
    title="Could not load BA directory"
    description="Check the API connection and retry. The data on this page is not saved."
    onRetry={() => bas.refetch()}
    error={bas.error}
  />
) : null}
```

### `LoadingScreen`

A centered spinner + message. Use while a primary query is loading. For
inline row/table loading, prefer `DataTable`'s `isLoading` state.

```ts
type LoadingScreenProps = {
  message?: string;                     // default "Loading..."
};
```

```tsx
{bas.isLoading ? <LoadingScreen message="Loading BA directory" /> : null}
```

---

## Badges

Source: `apps/web/src/components/Badges.tsx`

All four badges accept `className` for layout overrides (e.g. `self-start`).

### `PriorityBadge`

Booking-priority chip with a leading icon.

```ts
type PriorityBadgeProps = {
  priority: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
  className?: string;
};
```

```tsx
<PriorityBadge priority={booking.priority} />
```

Tone mapping (from `lib/format.ts`):
- `URGENT` → danger + AlertTriangle
- `HIGH` → warning + Star
- `MEDIUM` → info + Clock
- `LOW` → neutral + MinusCircle

### `StatusBadge`

Booking or BA status chip. Pass `hideIcon` for a clean text-only chip.

```ts
type StatusBadgeProps = {
  status: BookingStatus | BAStatus | string;   // 'APPROVED' | 'PENDING' | 'ACTIVE' | ...
  hideIcon?: boolean;
  className?: string;
};
```

```tsx
<StatusBadge status={ba.status} />
<StatusBadge status={booking.status} hideIcon />
```

Tone mapping (from `lib/format.ts`):
- Success: `APPROVED`, `IN_PROGRESS`, `ACTIVE`, `COMPLETED`
- Warning: `PENDING`, `ON_LEAVE`
- Danger: `RESIGNED`, `CANCELLED`
- Neutral: `REJECTED`

### `CapacityBadge`

Capacity-classification chip. Pass either a pre-classified `label` or a raw
`percent` (0..200+). The badge will pick the correct tone and show
"· 200%" as a sub-label when you pass `percent`.

```ts
type CapacityBadgeProps = {
  label?: 'BENCH' | 'LOW' | 'AVAILABLE' | 'HIGH' | 'FULL' | 'OVERBOOKED';
  percent?: number;
  className?: string;
};
```

```tsx
<CapacityBadge percent={ba.risk_capacity ?? 0} />
<CapacityBadge label="OVERBOOKED" />
```

Tone mapping:
- `OVERBOOKED` → danger + AlertTriangle
- `FULL` → info
- `HIGH` → warning
- `AVAILABLE` → success
- `LOW` → info
- `BENCH` → neutral

### `FlagBadge`

Generic flagged-item chip. Use for "Needs verification", "Open Request",
"Unassigned", or any custom string flag.

```ts
type FlagBadgeProps = {
  label: string;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  icon?: LucideIcon;
  className?: string;
};
```

```tsx
import { FlagBadge } from '@/components';
import { AlertCircle } from 'lucide-react';

<FlagBadge label="Bench for the selected period" tone="neutral" />
<FlagBadge label="Needs verification" tone="warning" icon={AlertCircle} />
```

---

## Domain components

### `Avatar` / `BAIdentity`

`Avatar` renders a round avatar (image or initials).
`BAIdentity` wraps it with a name + level/sub-label row, and renders a
graceful "Auto assign" placeholder when `ba` is null.

```tsx
import { Avatar, BAIdentity } from '@/components';

<Avatar name="Bui Phuong Thao" url={ba.avatar_url} />
<BAIdentity ba={ba} />           // normal
<BAIdentity ba={null} />         // "Auto assign" placeholder
```

### `CreateBAModal`

Reusable "Create BA account" modal. Extracted from BA Directory so other
surfaces (manager dashboard quick-add, admin tools) can reuse it.

Source: `apps/web/src/components/CreateBAModal.tsx`

```ts
type CreateBAModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;        // called after the BA is successfully created
};
```

**Example — used inside a page**

```tsx
import { CreateBAModal } from '@/components';

const [showCreate, setShowCreate] = useState(false);

<>
  <Button onClick={() => setShowCreate(true)}>
    <Plus className="h-4 w-4" /> Create BA
  </Button>
  <CreateBAModal
    open={showCreate}
    onClose={() => setShowCreate(false)}
    onCreated={() => toast.success('BA created')}
  />
</>
```

**Validation baked in**
- `full_name`, `email`, `password`, `confirm_password` required
- `password.length >= 8` (server-side enforced too)
- `password === confirm_password` client-side check
- `level` defaults to `MIDDLE`
- `joined_date` defaults to today

**On success** the modal:
- Invalidates the `ba-directory` query so any open directory page refetches
- Resets its form and calls `onCreated()` so the host can do extra work
- Closes itself

---

## Patterns & conventions

### Counts that survive search

If you want QuickTab / StatCard counts to stay stable while the user types
in the search box, fetch an unfiltered list in a separate `useQuery` and
use it only for counting. See BA Directory for the pattern:

```tsx
const bas = useQuery({ queryKey: ['ba-directory', filters], queryFn: filtered });
const allBas = useQuery({
  queryKey: ['ba-directory-all'],
  queryFn: () => apiFetch('/api/ba'),
  enabled: isManagerView
});
const countSource = allBas.data ?? bas.data ?? [];
```

### Search debouncing

Search inputs hit react-query on every keystroke by default. Debounce:

```tsx
import { useEffect, useState } from 'react';

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
```

Use `debounced` (not the raw input value) in the query key, so the query
re-fires only after the user pauses typing.

### RBAC-aware actions

Most pages should hide CTAs the current user can't perform. The pattern
from BA Directory:

```tsx
const { user } = useAuth();
const role = user?.role ?? 'BA';
const canManageBa = role === 'BA_MANAGER';
const isPmpo = role === 'PM_PO';

actions={canManageBa ? <Button onClick={...}>Create BA</Button> : null}
```

### Page-level titles and LayoutShell

If a page supplies its own `<PageHeader>`, set `suppressPageHeader` on
`<LayoutShell>` so the title isn't rendered twice. See [LayoutShell interaction](#layoutshell-interaction).

### Where new components go

- **Layout chrome, filters, tables, states, badges** → `apps/web/src/components/*.tsx`, exported from `index.ts`.
- **Domain objects specific to one feature** (e.g. a `BAMatchmakingCard` that only the inbox uses) → `apps/web/src/components/<feature>/<name>.tsx`. Don't pollute the barrel with feature-specific code.
- **Reusable but feature-coupled** (e.g. `CreateBAModal` is currently only used by BA Directory, but is generic enough to live in the top-level) → top-level `components/`.

---

## Migration checklist for existing pages

When you migrate an existing page to this library:

1. Replace ad-hoc title `<h1>` + paragraph with `<PageHeader>`.
2. Replace ad-hoc search/filter rows with `<DataToolbar>` inside a `<FilterCard>`.
3. Wrap your list/grid items in `<DataTable>` or keep the custom layout but use `<StatCard>` for KPI rows and `<QuickTabs>` for filter strips.
4. Replace `<Card>...loading...</Card>` with `<LoadingScreen>` and the error card with `<ErrorState>`.
5. Replace any `<Card>...empty...</Card>` with `<EmptyState>`.
6. Replace `<Badge tone={...}>{status}</Badge>` with the typed badges (`<StatusBadge>`, `<CapacityBadge>`, `<PriorityBadge>`, `<FlagBadge>`).
7. If you add a page-level header, set `suppressPageHeader` on its `<LayoutShell>`.

The BA Directory page is the reference implementation; cross-check against
`apps/web/src/pages/BADirectoryPage.tsx` for a working example of every
component in this library.
