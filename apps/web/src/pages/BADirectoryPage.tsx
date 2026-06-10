import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarDays, Plus, UserPlus } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { apiFetch, type BAProfile, type SkillTag } from '@/lib/api';
import { BookingModal } from '@/components/BookingModal';
import {
  BAIdentity,
  CapacityBadge,
  CreateBAModal,
  DataToolbar,
  EmptyState,
  ErrorState,
  FilterCard,
  FlagBadge,
  LoadingScreen,
  PageHeader,
  QuickTabs,
  StatCard,
  type QuickTab,
  StatusBadge
} from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const LEVELS = ['JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD'] as const;

export function BADirectoryPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role = user?.role ?? 'BA';
  const isManagerView = role === 'BA_MANAGER' || role === 'ADMIN';
  const canManageBa = role === 'BA_MANAGER';

  // Filter state — kept local; pages of the same shape (Reports, Bookings) reuse this pattern.
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState('');
  const [tag, setTag] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [requestBaId, setRequestBaId] = useState('');

  const visibleStatuses = useMemo(
    () => (isManagerView ? ['ACTIVE', 'ON_LEAVE', 'RESIGNED'] : ['ACTIVE']),
    [isManagerView]
  );
  const safeStatus = status && visibleStatuses.includes(status) ? status : '';

  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (level) query.set('level', level);
  if (safeStatus) query.set('status', safeStatus);
  if (tag) query.set('tags', tag);

  const bas = useQuery({
    queryKey: ['ba-directory', role, search, level, safeStatus, tag],
    queryFn: () => apiFetch<BAProfile[]>(`/api/ba?${query.toString()}`)
  });
  // Unfiltered list — used ONLY to compute stat-card / quick-tab counts so
  // they stay stable while the user types in the search box.
  const allBas = useQuery({
    queryKey: ['ba-directory-all', role],
    queryFn: () => apiFetch<BAProfile[]>('/api/ba'),
    enabled: isManagerView
  });
  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: () => apiFetch<SkillTag[]>('/api/tags')
  });

  const rows = bas.data ?? [];
  const allRows = allBas.data ?? [];
  // Counts use the unfiltered set so they don't drop to 0 as the user types.
  const countSource = isManagerView && allRows.length > 0 ? allRows : rows;
  const total = rows.length;
  const activeFilters = [level, safeStatus, tag].filter(Boolean).length;

  // Quick-tab counts (live, not from API) so the strip always reflects the
  // current result set.
  const counts = useMemo(() => {
    const acc = { ACTIVE: 0, ON_LEAVE: 0, RESIGNED: 0, bench: 0, overbooked: 0 };
    for (const ba of countSource) {
      if (ba.status === 'ACTIVE') acc.ACTIVE += 1;
      else if (ba.status === 'ON_LEAVE') acc.ON_LEAVE += 1;
      else if (ba.status === 'RESIGNED') acc.RESIGNED += 1;
      if ((ba.utilization_percent ?? 0) <= 0) acc.bench += 1;
      if ((ba.risk_capacity ?? 0) > 100) acc.overbooked += 1;
    }
    return acc;
  }, [countSource]);

  const statusTabs: Array<QuickTab<string>> = isManagerView
    ? [
        { value: '', label: 'All', count: countSource.length },
        { value: 'ACTIVE', label: 'Active', count: counts.ACTIVE, tone: 'success' },
        { value: 'ON_LEAVE', label: 'On leave', count: counts.ON_LEAVE, tone: 'warning' },
        { value: 'RESIGNED', label: 'Resigned', count: counts.RESIGNED, tone: 'danger' }
      ]
    : [{ value: '', label: 'All', count: countSource.length }];

  return (
    <div className="grid gap-5">
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
          isManagerView ? (
            <QuickTabs
              tabs={statusTabs}
              value={status}
              onChange={(value) => setStatus(value)}
              trailing={
                <button
                  type="button"
                  onClick={() => {
                    setStatus('');
                    setLevel('');
                    setTag('');
                    setSearch('');
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                >
                  Reset filters
                </button>
              }
            />
          ) : null
        }
      />

      {/* Stat strip — 4 quick KPIs. Hidden for BA role (less useful). */}
      {isManagerView ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total BAs"
            value={String(countSource.length)}
            icon={UserPlus}
            tone="info"
            active={!status}
            onClick={() => setStatus('')}
          />
          <StatCard
            label="Active"
            value={String(counts.ACTIVE)}
            tone="success"
            active={status === 'ACTIVE'}
            onClick={() => setStatus('ACTIVE')}
          />
          <StatCard
            label="On bench"
            value={String(counts.bench)}
            tone="warning"
            hint="Utilization ≤ 0%"
          />
          <StatCard
            label="Overbooked"
            value={String(counts.overbooked)}
            tone="danger"
            hint="Risk capacity > 100%"
          />
        </div>
      ) : null}

      <FilterCard>
        <DataToolbar
          searchPlaceholder="Search BA by name or email"
          searchValue={search}
          onSearchChange={setSearch}
          activeFilterCount={activeFilters}
          actions={
            <span className="text-xs text-slate-500">
              {total} result{total === 1 ? '' : 's'}
            </span>
          }
        />
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="grid gap-1">
            <label className="text-xs font-medium text-slate-600">Level</label>
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
            >
              <option value="">All levels</option>
              {LEVELS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          {isManagerView ? (
            <div className="grid gap-1">
              <label className="text-xs font-medium text-slate-600">Status</label>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
              >
                <option value="">All status</option>
                {visibleStatuses.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="grid gap-1">
            <label className="text-xs font-medium text-slate-600">Tag</label>
            <select
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
            >
              <option value="">All tags</option>
              {(tags.data ?? []).map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </FilterCard>

      {bas.isLoading ? <LoadingScreen message="Loading BA directory" /> : null}
      {bas.error ? (
        <ErrorState
          title="Could not load BA directory"
          description="Check the API connection and retry. The data on this page is not saved."
          onRetry={() => void bas.refetch()}
        />
      ) : null}

      {!bas.isLoading && !bas.error && rows.length === 0 ? (
        <EmptyState
          title="No BAs match your filters"
          description={
            activeFilters > 0 || search
              ? 'Try removing a filter or clearing the search.'
              : canManageBa
                ? 'Create the first BA account to get started.'
                : 'No BAs are currently available for booking.'
          }
          action={
            activeFilters > 0 || search
              ? {
                  label: 'Reset filters',
                  onClick: () => {
                    setStatus('');
                    setLevel('');
                    setTag('');
                    setSearch('');
                  }
                }
              : canManageBa
                ? { label: 'Create BA', onClick: () => setShowCreate(true) }
                : undefined
          }
        />
      ) : null}

      {!bas.isLoading && !bas.error && rows.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((ba) => (
            <BAAvailabilityCard
              key={ba.id}
              ba={ba}
              role={role}
              onRequestBa={() => setRequestBaId(ba.id)}
            />
          ))}
        </div>
      ) : null}

      <CreateBAModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ['ba-directory'] });
        }}
      />

      <BookingModal
        open={Boolean(requestBaId)}
        onClose={() => setRequestBaId('')}
        onSuccess={() => {
          setRequestBaId('');
          void queryClient.invalidateQueries();
        }}
        initialBaId={requestBaId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card — extracted so the BA directory refactor stays readable.
// ---------------------------------------------------------------------------

function BAAvailabilityCard({
  ba,
  role,
  onRequestBa
}: {
  ba: BAProfile;
  role: string;
  onRequestBa: () => void;
}) {
  const isManagerView = role === 'BA_MANAGER' || role === 'ADMIN';
  const isPmpo = role === 'PM_PO';
  const canRequest = ba.status === 'ACTIVE';

  const capacityPercent = ba.risk_capacity ?? ba.utilization_percent ?? 0;
  const utilizationPercent = ba.utilization_percent ?? 0;
  const projects = ba.current_projects ?? [];

  const visibleTags = (ba.skill_tags ?? []).slice(0, 5).map((item) => {
    const tag = 'tag' in item ? item.tag : item;
    return {
      id: tag?.id ?? ('id' in item ? String(item.id) : Math.random().toString(36)),
      name: tag?.name ?? 'Unknown tag'
    };
  });

  // Bar color follows the same thresholds as the badge.
  const barColor = capacityToneColor(capacityPercent);

  return (
    <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="grid gap-4 p-5">
        <header className="flex items-start justify-between gap-3">
          <BAIdentity ba={ba} />
          <div className="flex flex-col items-end gap-2">
            <StatusBadge status={ba.status} />
            <CapacityBadge percent={capacityPercent} />
          </div>
        </header>

        <section className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500">Current capacity</span>
            <span className="font-bold text-slate-950">{capacityPercent}%</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-white"
            role="progressbar"
            aria-valuenow={Math.min(100, capacityPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Current capacity"
          >
            <div
              className={cn('h-full', barColor)}
              style={{ width: `${Math.min(100, capacityPercent)}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-slate-600">
            <span>
              Utilization: <strong>{utilizationPercent}%</strong>
            </span>
            <span>
              Man-days: <strong>{ba.booked_man_days ?? 0}</strong>
            </span>
          </div>
        </section>

        <section className="grid gap-2">
          <p className="text-xs font-semibold uppercase text-slate-500">Current projects</p>
          {projects.length > 0 ? (
            <div className="grid gap-2">
              {projects.slice(0, 3).map((project) => (
                <div
                  key={project.project_id}
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate font-medium text-slate-800">
                    {project.project_name}
                  </span>
                  <span className="shrink-0 text-slate-600">{project.capacity_percent}%</span>
                </div>
              ))}
            </div>
          ) : (
            <FlagBadge
              label="Bench for the selected period"
              tone="neutral"
              className="self-start"
            />
          )}
        </section>

        {visibleTags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {visibleTags.map((tag) => (
              <Badge key={tag.id} tone="info">
                {tag.name}
              </Badge>
            ))}
          </div>
        ) : null}

        {ba.status !== 'ACTIVE' ? (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ba.status === 'ON_LEAVE' ? 'On Leave' : 'Resigned'}
            {ba.status_reason ? `: ${ba.status_reason}` : ''}
          </div>
        ) : null}

        <footer className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
          {isPmpo ? (
            <Button type="button" size="sm" onClick={onRequestBa} disabled={!canRequest}>
              Request BA
            </Button>
          ) : null}
          {isManagerView ? (
            <>
              <Button size="sm" variant="secondary" asChild>
                <Link to="/manager/action-center?type=OPEN_REQUEST">Assign</Link>
              </Button>
              <Button size="sm" variant="secondary" asChild>
                <Link to={`/timeline?baId=${ba.id}`}>
                  <CalendarDays className="h-4 w-4" /> Timeline
                </Link>
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="ghost" asChild>
            <Link to={`/crm/ba/${ba.id}`}>View Profile</Link>
          </Button>
        </footer>
      </CardContent>
    </Card>
  );
}

// Inline so we don't touch the format module just for this.
function capacityToneColor(percent: number): string {
  if (percent > 100) return 'bg-rose-600';
  if (percent === 100) return 'bg-indigo-600';
  if (percent >= 75) return 'bg-amber-500';
  if (percent >= 50) return 'bg-emerald-500';
  if (percent > 0) return 'bg-sky-500';
  return 'bg-slate-300';
}
