import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { apiFetch, getMockRole, type BAProfile, type Booking, type SkillTag } from '@/lib/api';
import { BAIdentity, Field, StatusBadge } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format';

export function BAProfilePage() {
  const { id = '' } = useParams();
  const role = getMockRole();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [tagId, setTagId] = useState('');

  const ba = useQuery({
    queryKey: ['ba-profile', id, role],
    queryFn: () => apiFetch<BAProfile>(`/api/ba/${id}`),
    enabled: Boolean(id)
  });
  const history = useQuery({
    queryKey: ['ba-history', id, role],
    queryFn: () => apiFetch<Booking[]>(`/api/ba/${id}/booking-history`),
    enabled: Boolean(id)
  });
  const utilization = useQuery({
    queryKey: ['ba-utilization', id, role],
    queryFn: () =>
      apiFetch<{ utilization_percent: number; booked_days: number; working_days: number }>(
        `/api/ba/${id}/utilization?month=2026-06`
      ),
    enabled: Boolean(id)
  });
  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: () => apiFetch<SkillTag[]>('/api/tags')
  });
  const notes = useQuery({
    queryKey: ['ba-notes', id, role],
    queryFn: () => apiFetch<Array<{ id: string; content: string; created_at: string; creator: { full_name: string } }>>(`/api/ba/${id}/notes`),
    enabled: role === 'BA_MANAGER' && Boolean(id)
  });
  const appendNote = useMutation({
    mutationFn: () =>
      apiFetch(`/api/ba/${id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content: note })
      }),
    onSuccess: () => {
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['ba-notes', id] });
    }
  });
  const addTag = useMutation({
    mutationFn: () =>
      apiFetch(`/api/ba/${id}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tag_id: tagId })
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ba-profile', id] })
  });
  const changeStatus = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/api/ba/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ba-profile', id] })
  });

  if (ba.isLoading) return <Card><CardContent className="p-6">Loading profile...</CardContent></Card>;
  if (!ba.data) return <Card><CardContent className="p-6">Profile not found.</CardContent></Card>;

  return (
    <div className="grid gap-5">
      <Card>
        <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
          <BAIdentity ba={ba.data} />
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={ba.data.status} />
            {role === 'BA_MANAGER' ? (
              <select
                value={ba.data.status}
                onChange={(event) => changeStatus.mutate(event.target.value)}
                className="h-9 rounded-md border px-2 text-sm"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="ON_LEAVE">ON_LEAVE</option>
                <option value="RESIGNED">RESIGNED</option>
              </select>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="grid gap-5">
          <Card>
            <CardHeader><CardTitle>Basic Info</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm text-slate-600 md:grid-cols-2">
              <p>Email: {role === 'BA_MANAGER' ? ba.data.email : 'Hidden by policy'}</p>
              <p>Phone: {role === 'BA_MANAGER' ? ba.data.phone : 'Hidden by policy'}</p>
              <p>Level: {ba.data.level}</p>
              <p>Joined: {formatDate(ba.data.joined_date)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Booking History</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {(history.data ?? []).map((booking) => (
                <div key={booking.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <strong>{booking.project.name}</strong>
                    <StatusBadge status={booking.status} />
                  </div>
                  <p className="mt-1 text-slate-600">
                    {formatDate(booking.start_date)} - {formatDate(booking.end_date)} · {booking.capacity_percent}%
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <aside className="grid gap-5">
          <Card>
            <CardHeader><CardTitle>Utilization</CardTitle></CardHeader>
            <CardContent>
              <p className="text-4xl font-bold text-blue-700">{utilization.data?.utilization_percent ?? 0}%</p>
              <p className="mt-1 text-sm text-slate-600">
                {utilization.data?.booked_days ?? 0}/{utilization.data?.working_days ?? 0} working days in Jun 2026
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Skill / Domain Tags</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                {ba.data.skill_tags.map((item) => <Badge key={item.tag.id} tone="info">{item.tag.name}</Badge>)}
              </div>
              {role === 'BA_MANAGER' ? (
                <div className="flex gap-2">
                  <select value={tagId} onChange={(event) => setTagId(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border px-2 text-sm">
                    <option value="">Add tag</option>
                    {(tags.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <Button variant="secondary" onClick={() => addTag.mutate()} disabled={!tagId}>Add</Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {role === 'BA_MANAGER' ? (
            <Card>
              <CardHeader><CardTitle>Private Notes</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <Field label="Append note">
                  <textarea value={note} onChange={(event) => setNote(event.target.value)} className="min-h-24 rounded-md border p-3" maxLength={5000} />
                </Field>
                <Button onClick={() => appendNote.mutate()} disabled={!note}>Append Note</Button>
                {(notes.data ?? []).map((item) => (
                  <div key={item.id} className="rounded-md border bg-slate-50 p-3 text-sm">
                    <p>{item.content}</p>
                    <p className="mt-2 text-xs text-slate-500">{item.creator.full_name} · {formatDate(item.created_at)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
