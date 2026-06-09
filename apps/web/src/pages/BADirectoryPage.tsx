import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, Plus, Search } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { apiFetch, type BAProfile, type BALevel, type SkillTag } from '@/lib/api';
import {
  capacityBadgeTone,
  capacityLabelText,
  classifyCapacityLabel
} from '@/lib/format';
import { BAIdentity, Field, StatusBadge } from '@/components/common';
import { BookingModal } from '@/components/BookingModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';

export function BADirectoryPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role = user?.role ?? 'BA';
  const isManagerView = role === 'BA_MANAGER' || role === 'ADMIN';
  const canManageBa = role === 'BA_MANAGER';
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
  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: () => apiFetch<SkillTag[]>('/api/tags')
  });

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-end">
        {canManageBa ? (
          <Button onClick={() => setShowCreate((value) => !value)}>
            <Plus className="h-4 w-4" /> Create BA
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_160px_160px_220px]">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search BA"
              className="h-10 w-full rounded-md border pl-9 pr-3 text-sm"
            />
          </div>
          <select value={level} onChange={(event) => setLevel(event.target.value)} className="h-10 rounded-md border px-3 text-sm">
            <option value="">All levels</option>
            {['JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD'].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-md border px-3 text-sm">
            <option value="">All status</option>
            {visibleStatuses.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select value={tag} onChange={(event) => setTag(event.target.value)} className="h-10 rounded-md border px-3 text-sm">
            <option value="">All tags</option>
            {(tags.data ?? []).map((item) => (
              <option key={item.id} value={item.name}>{item.name}</option>
            ))}
          </select>
        </CardContent>
      </Card>

      {showCreate ? <CreateBACard onDone={() => {
        setShowCreate(false);
        void queryClient.invalidateQueries({ queryKey: ['ba-directory'] });
      }} /> : null}

      {bas.isLoading ? (
        <LoadingScreen message="Loading BA directory" />
      ) : null}
      {bas.error ? (
        <Card><CardContent className="p-5 text-sm text-rose-700">Could not load BA directory. Check API connection and retry.</CardContent></Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {(bas.data ?? []).map((ba) => (
          <BAAvailabilityCard
            key={ba.id}
            ba={ba}
            role={role}
            onRequestBa={() => setRequestBaId(ba.id)}
          />
        ))}
        {bas.data?.length === 0 ? (
          <Card><CardContent className="p-5 text-sm text-slate-600">No BA profiles match the current filters.</CardContent></Card>
        ) : null}
      </div>

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
  const capacityLabel = ba.capacity_label ?? classifyCapacityLabel(capacityPercent);
  const projects = ba.current_projects ?? [];
  const visibleTags = (ba.skill_tags ?? []).slice(0, 5).map((item) => {
  	const tag = 'tag' in item ? item.tag : item;
  	return {
  		id: tag?.id ?? ('id' in item ? item.id : Math.random().toString(36)),
  		name: tag?.name ?? 'Unknown tag'
  	};
  });

  return (
<Card className="h-full transition hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <BAIdentity ba={ba} />
          <div className="flex flex-col items-end gap-2">
            <StatusBadge status={ba.status} />
            <Badge tone={capacityBadgeTone(capacityLabel)}>
              {capacityLabel === 'OVERBOOKED' ? (
                <AlertTriangle className="mr-1 h-3 w-3" />
              ) : null}
              {capacityLabelText(capacityLabel)}
            </Badge>
          </div>
        </div>

        <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500">Current capacity</span>
            <span className="font-bold text-slate-950">{capacityPercent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white">
            <div
              className={
                capacityPercent > 100
                  ? 'h-full bg-rose-600'
                  : capacityPercent === 100
                    ? 'h-full bg-indigo-600'
                    : capacityPercent >= 75
                      ? 'h-full bg-amber-500'
                      : capacityPercent >= 50
                        ? 'h-full bg-emerald-500'
                        : capacityPercent > 0
                          ? 'h-full bg-sky-500'
                          : 'h-full bg-slate-300'
              }
              style={{ width: `${Math.min(100, capacityPercent)}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-slate-600">
            <span>Utilization: <strong>{ba.utilization_percent ?? 0}%</strong></span>
            <span>Man-days: <strong>{ba.booked_man_days ?? 0}</strong></span>
          </div>
        </div>

        <div className="grid gap-2">
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
            <p className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-500">
              Bench for the selected period
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {visibleTags.map((tag) => (
            <Badge key={tag.id} tone="info">{tag.name}</Badge>
          ))}
        </div>

        {ba.status !== 'ACTIVE' ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ba.status === 'ON_LEAVE' ? 'On Leave' : 'Resigned'}
            {ba.status_reason ? `: ${ba.status_reason}` : ''}
          </p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {isPmpo ? (
            <Button type="button" onClick={onRequestBa} disabled={!canRequest}>
              Request BA
            </Button>
          ) : null}
          {isManagerView ? (
            <>
              <Button variant="secondary" asChild>
                <Link to="/manager/action-center?type=OPEN_REQUEST">Assign to Request</Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link to={`/timeline?baId=${ba.id}`}>
                  <CalendarDays className="h-4 w-4" /> Timeline
                </Link>
              </Button>
            </>
          ) : null}
          <Button variant="secondary" asChild>
            <Link to={`/crm/ba/${ba.id}`}>View Profile</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateBACard({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    level: 'MIDDLE' as BALevel,
    joined_date: '2026-06-01'
  });
  const [localError, setLocalError] = useState('');
  const create = useMutation({
    mutationFn: () =>
      apiFetch('/api/ba', {
        method: 'POST',
        body: JSON.stringify({
          full_name: form.full_name,
          email: form.email,
          password: form.password,
          phone: form.phone,
          level: form.level,
          joined_date: form.joined_date
        })
      }),
    onSuccess: onDone
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create BA Account</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 md:grid-cols-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (form.password !== form.confirmPassword) {
              setLocalError('Password confirmation does not match.');
              return;
            }

            setLocalError('');
            create.mutate();
          }}
        >
          <Field label="Name">
            <input className="h-10 rounded-md border px-3" value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} required />
          </Field>
          <Field label="Email">
            <input type="email" className="h-10 rounded-md border px-3" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          </Field>
          <Field label="Initial password">
            <input type="password" className="h-10 rounded-md border px-3" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={8} required />
          </Field>
          <Field label="Confirm password">
            <input type="password" className="h-10 rounded-md border px-3" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} minLength={8} required />
          </Field>
          <Field label="Phone">
            <input className="h-10 rounded-md border px-3" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </Field>
          <Field label="Level">
            <select className="h-10 rounded-md border px-3" value={form.level} onChange={(event) => setForm({ ...form, level: event.target.value as BALevel })}>
              <option value="JUNIOR">JUNIOR</option>
              <option value="MIDDLE">MIDDLE</option>
              <option value="SENIOR">SENIOR</option>
              <option value="LEAD">LEAD</option>
            </select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" className="w-full">{create.isPending ? 'Creating...' : 'Create'}</Button>
          </div>
        </form>
        {localError ? <p className="mt-3 text-sm text-rose-600">{localError}</p> : null}
        {create.error ? <p className="mt-3 text-sm text-rose-600">{create.error.message}</p> : null}
      </CardContent>
    </Card>
  );
}

