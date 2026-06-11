import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, Plus, Search } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import {
  apiFetch,
  type BAProfile,
  type BALevel,
  type BAStatus,
  type PaginatedResponse,
  type SkillTag
} from '@/lib/api';
import {
  capacityBadgeTone,
  capacityLabelText,
  classifyCapacityLabel
} from '@/lib/format';
import { BAIdentity, Field, StatusBadge } from '@/components/common';
import { BookingModal } from '@/components/BookingModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { Modal } from '@/components/ui/modal';

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
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const [showCreate, setShowCreate] = useState(false);
  const [requestBaId, setRequestBaId] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
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
  query.set('page', String(page));
  query.set('page_size', String(pageSize));

  const bas = useQuery({
    queryKey: ['ba-directory', role, search, level, safeStatus, tag, page, pageSize],
    queryFn: () => apiFetch<PaginatedResponse<BAProfile>>(`/api/ba?${query.toString()}`),
    placeholderData: (previous) => previous
  });
  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: () => apiFetch<SkillTag[]>('/api/tags')
  });
  const baItems: BAProfile[] = bas.data?.items ?? [];
  const totalPages = bas.data?.total_pages ?? 1;
  const totalItems = bas.data?.total ?? 0;
  const firstItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, totalItems);

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-end">
        {canManageBa ? (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Create BA
          </Button>
        ) : null}
      </div>

      {successMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
          {successMessage}
        </div>
      ) : null}

      <Card>
        <CardContent className="grid gap-3 p-3 sm:p-4 md:grid-cols-[1fr_160px_160px_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search BA"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            />
          </div>
          <select
            value={level}
            onChange={(event) => {
              setLevel(event.target.value);
              setPage(1);
            }}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
          >
            <option value="">All levels</option>
            {['JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD'].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
          >
            <option value="">All status</option>
            {visibleStatuses.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            value={tag}
            onChange={(event) => {
              setTag(event.target.value);
              setPage(1);
            }}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
          >
            <option value="">All tags</option>
            {(tags.data ?? []).map((item) => (
              <option key={item.id} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <CreateBAModal
        open={showCreate}
        tags={tags.data ?? []}
        onClose={() => setShowCreate(false)}
        onDone={() => {
          setShowCreate(false);
          setSuccessMessage('BA account created.');
          void queryClient.invalidateQueries({ queryKey: ['ba-directory'] });
        }}
      />

      {bas.isLoading ? <LoadingScreen message="Loading BA directory" /> : null}
      {bas.error ? (
        <Card>
          <CardContent className="p-5 text-sm text-rose-700">
            Could not load BA directory. Check API connection and retry.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {baItems.map((ba) => (
          <BAAvailabilityCard
            key={ba.id}
            ba={ba}
            role={role}
            onRequestBa={() => setRequestBaId(ba.id)}
          />
        ))}
        {baItems.length === 0 && !bas.isLoading ? (
          <Card>
            <CardContent className="p-5 text-sm text-slate-600">
              No BA profiles match the current filters.
            </CardContent>
          </Card>
        ) : null}
      </div>

      {totalItems > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Showing {firstItem}-{lastItem} of {totalItems} BA profiles
            </span>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button
                variant="secondary"
                disabled={page <= 1 || bas.isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={page >= totalPages || bas.isFetching}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
            <span>
              Utilization: <strong>{ba.utilization_percent ?? 0}%</strong>
            </span>
            <span>
              Man-days: <strong>{ba.booked_man_days ?? 0}</strong>
            </span>
          </div>
        </div>

        <div className="grid gap-2">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Current projects
          </p>
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
                  <span className="shrink-0 text-slate-600">
                    {project.capacity_percent}%
                  </span>
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
            <Badge key={tag.id} tone="info">
              {tag.name}
            </Badge>
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
                <Link to="/manager/action-center?type=OPEN_REQUEST">
                  Assign to Request
                </Link>
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

function CreateBAModal({
  open,
  tags,
  onClose,
  onDone
}: {
  open: boolean;
  tags: SkillTag[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    avatar_url: '',
    level: 'MIDDLE' as BALevel,
    status: 'ACTIVE' as BAStatus,
    joined_date: '',
    tag_ids: [] as string[]
  });
  const [localError, setLocalError] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const created = await apiFetch<BAProfile>('/api/ba', {
        method: 'POST',
        body: JSON.stringify({
          full_name: form.full_name,
          email: form.email,
          password: form.password,
          phone: form.phone,
          avatar_url: form.avatar_url,
          level: form.level,
          status: form.status,
          joined_date: form.joined_date || undefined
        })
      });

      for (const tagId of form.tag_ids) {
        await apiFetch(`/api/ba/${created.id}/tags`, {
          method: 'POST',
          body: JSON.stringify({ tag_id: tagId })
        });
      }

      return created;
    },
    onSuccess: () => {
      setForm({
        full_name: '',
        email: '',
        password: '',
        confirmPassword: '',
        phone: '',
        avatar_url: '',
        level: 'MIDDLE',
        status: 'ACTIVE',
        joined_date: '',
        tag_ids: []
      });
      setLocalError('');
      onDone();
    }
  });

  return (
    <Modal
      title="Create BA Account"
      open={open}
      onClose={() => {
        if (!create.isPending) onClose();
      }}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.full_name.trim()) {
            setLocalError('Full name is required.');
            return;
          }

          if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
            setLocalError('Email format is invalid.');
            return;
          }

          if (form.password !== form.confirmPassword) {
            setLocalError('Password confirmation does not match.');
            return;
          }

          setLocalError('');
          create.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <input
              className="h-10 rounded-md border px-3"
              value={form.full_name}
              onChange={(event) => setForm({ ...form, full_name: event.target.value })}
              required
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              className="h-10 rounded-md border px-3"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              required
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Initial password">
            <input
              type="password"
              className="h-10 rounded-md border px-3"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              minLength={8}
              required
            />
          </Field>
          <Field label="Confirm password">
            <input
              type="password"
              className="h-10 rounded-md border px-3"
              value={form.confirmPassword}
              onChange={(event) =>
                setForm({ ...form, confirmPassword: event.target.value })
              }
              minLength={8}
              required
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Level">
            <select
              className="h-10 rounded-md border px-3"
              value={form.level}
              onChange={(event) =>
                setForm({ ...form, level: event.target.value as BALevel })
              }
            >
              <option value="JUNIOR">JUNIOR</option>
              <option value="MIDDLE">MIDDLE</option>
              <option value="SENIOR">SENIOR</option>
              <option value="LEAD">LEAD</option>
            </select>
          </Field>
          <Field label="Status">
            <select
              className="h-10 rounded-md border px-3"
              value={form.status}
              onChange={(event) =>
                setForm({ ...form, status: event.target.value as BAStatus })
              }
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="ON_LEAVE">ON_LEAVE</option>
              <option value="RESIGNED">RESIGNED</option>
            </select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone optional">
            <input
              className="h-10 rounded-md border px-3"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          </Field>
          <Field label="Joined date optional">
            <input
              type="date"
              className="h-10 rounded-md border px-3"
              value={form.joined_date}
              onChange={(event) => setForm({ ...form, joined_date: event.target.value })}
            />
          </Field>
        </div>

        <Field label="Avatar optional">
          <input
            className="h-10 rounded-md border px-3"
            value={form.avatar_url}
            onChange={(event) => setForm({ ...form, avatar_url: event.target.value })}
            placeholder="https://..."
          />
        </Field>

        <div className="grid gap-2">
          <p className="text-sm font-semibold text-slate-700">Skill / domain tags</p>
          <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 p-2">
            {tags.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {tags.map((tag) => {
                  const selected = form.tag_ids.includes(tag.id);
                  return (
                    <label
                      key={tag.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setForm({
                            ...form,
                            tag_ids: checked
                              ? [...form.tag_ids, tag.id]
                              : form.tag_ids.filter((id) => id !== tag.id)
                          });
                        }}
                      />
                      <span className="min-w-0 truncate">{tag.name}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No active tags available.</p>
            )}
          </div>
        </div>

        {localError ? <p className="text-sm text-rose-600">{localError}</p> : null}
        {create.error ? (
          <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
            {create.error.message}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating...' : 'Create BA'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
