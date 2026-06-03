import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { apiFetch, getMockRole, type BAProfile, type BALevel, type SkillTag } from '@/lib/api';
import { BAIdentity, Field, StatusBadge } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';

export function BADirectoryPage() {
  const queryClient = useQueryClient();
  const role = getMockRole();
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState('');
  const [tag, setTag] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const visibleStatuses = useMemo(
    () => (role === 'BA_MANAGER' || role === 'ADMIN' ? ['ACTIVE', 'ON_LEAVE', 'RESIGNED'] : ['ACTIVE']),
    [role]
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
        {role === 'BA_MANAGER' ? (
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
          <Link key={ba.id} to={`/crm/ba/${ba.id}`}>
            <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-md">
              <CardContent className="grid gap-4 p-5">
                <div className="flex items-center justify-between gap-3">
                  <BAIdentity ba={ba} />
                  <StatusBadge status={ba.status} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {ba.skill_tags.slice(0, 4).map((item) => (
                    <Badge key={item.tag.id} tone="info">{item.tag.name}</Badge>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
                  <span>Level: <strong>{ba.level}</strong></span>
                  <span>Bookings: <strong>{ba.bookings?.length ?? 0}</strong></span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {bas.data?.length === 0 ? (
          <Card><CardContent className="p-5 text-sm text-slate-600">No BA profiles match the current filters.</CardContent></Card>
        ) : null}
      </div>
    </div>
  );
}

function CreateBACard({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    level: 'MIDDLE' as BALevel,
    joined_date: '2026-06-01'
  });
  const create = useMutation({
    mutationFn: () =>
      apiFetch('/api/ba', {
        method: 'POST',
        body: JSON.stringify(form)
      }),
    onSuccess: onDone
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create BA Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 md:grid-cols-5"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Name">
            <input className="h-10 rounded-md border px-3" value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} required />
          </Field>
          <Field label="Email">
            <input type="email" className="h-10 rounded-md border px-3" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
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
        {create.error ? <p className="mt-3 text-sm text-rose-600">{create.error.message}</p> : null}
      </CardContent>
    </Card>
  );
}
