import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  Tooltip,
  type TooltipItem
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { apiFetch, type BAProfile, type Booking, type SkillTag } from '@/lib/api';
import { BAIdentity, Field, StatusBadge } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { formatDate } from '@/lib/format';

const historyChartHeight = 280;
const defaultHistoryMonth = new Date().toISOString().slice(0, 7);

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend, Filler);

export function BAProfilePage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const role = user?.role ?? 'BA';
  const isManagerView = role === 'BA_MANAGER' || role === 'ADMIN';
  const canManageBa = role === 'BA_MANAGER';
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [tagId, setTagId] = useState('');
  const [historyMonth, setHistoryMonth] = useState(defaultHistoryMonth);

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
    queryFn: () =>
      apiFetch<Array<{ id: string; content: string; created_at: string; creator: { full_name: string } }>>(
        `/api/ba/${id}/notes`
      ),
    enabled: isManagerView && Boolean(id)
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

  const historyBookings = useMemo(
    () =>
      [...(history.data ?? [])].sort(
        (left, right) => new Date(right.start_date).getTime() - new Date(left.start_date).getTime()
      ),
    [history.data]
  );
  const completedHistoryBookings = useMemo(
    () => historyBookings.filter((booking) => booking.status === 'COMPLETED'),
    [historyBookings]
  );
  const filteredCompletedHistoryBookings = useMemo(
    () =>
      completedHistoryBookings.filter(
        (booking) => booking.start_date.slice(0, 7) === historyMonth || booking.end_date.slice(0, 7) === historyMonth
      ),
    [completedHistoryBookings, historyMonth]
  );

  const historyChartData = useMemo(
    () => ({
      labels: filteredCompletedHistoryBookings.map((booking) => booking.project.name),
      datasets: [
        {
          label: 'Effort taken (capacity %)',
          data: filteredCompletedHistoryBookings.map((booking) => booking.capacity_percent),
          backgroundColor: 'rgba(37, 99, 235, 0.72)',
          borderColor: '#2563eb',
          borderRadius: 10,
          borderSkipped: false,
          borderWidth: 1,
          hoverBackgroundColor: 'rgba(29, 78, 216, 0.9)',
          hoverBorderColor: '#1d4ed8'
        }
      ]
    }),
    [filteredCompletedHistoryBookings]
  );

  const historyChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'nearest' as const,
        intersect: false
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.96)',
          padding: 12,
          displayColors: false,
          cornerRadius: 10,
          callbacks: {
            title: (items: TooltipItem<'bar'>[]) => items[0]?.label ?? '',
            label: (item: TooltipItem<'bar'>) => {
              const booking = filteredCompletedHistoryBookings[item.dataIndex];
              return booking ? `Capacity: ${booking.capacity_percent}%` : '';
            },
            afterLabel: (item: TooltipItem<'bar'>) => {
              const booking = filteredCompletedHistoryBookings[item.dataIndex];
              if (!booking) return [];

              return [
                `Title: ${booking.title}`,
                `Dates: ${formatDate(booking.start_date)} - ${formatDate(booking.end_date)}`,
                `Priority: ${booking.priority}`,
                `Status: ${booking.status}`
              ];
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: (value: string | number) => `${value}%`
          },
          grid: {
            color: 'rgba(148, 163, 184, 0.25)'
          },
          title: {
            display: true,
            text: 'Capacity %'
          }
        },
        x: {
          grid: {
            display: false
          },
          ticks: {
            maxRotation: 0,
            minRotation: 0
          }
        }
      }
    }),
    [filteredCompletedHistoryBookings]
  );

  if (ba.isLoading) return <LoadingScreen message="Loading profile" />;
  if (!ba.data) return <Card><CardContent className="p-6">Profile not found.</CardContent></Card>;

  return (
    <div className="grid gap-5">
      <Card>
        <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
          <BAIdentity ba={ba.data} />
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={ba.data.status} />
            {canManageBa ? (
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
              <p>Email: {isManagerView ? ba.data.email : 'Hidden by policy'}</p>
              <p>Phone: {isManagerView ? ba.data.phone : 'Hidden by policy'}</p>
              <p>Level: {ba.data.level}</p>
              {ba.data.joined_date ? <p>Joined: {formatDate(ba.data.joined_date)}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Booking History</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              {historyBookings.length > 0 ? (
                <>
                  {completedHistoryBookings.length > 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 via-white to-blue-50/40 p-4">
                      <div className="mb-3 grid gap-3 md:flex md:items-start md:justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-900">Completed booking capacity trend</p>
                          <p className="text-xs text-slate-500">Hover a point to see completed booking details only.</p>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[auto_auto] sm:items-center">
                          <input
                            type="month"
                            value={historyMonth}
                            onChange={(event) => setHistoryMonth(event.target.value)}
                            className="h-10 min-w-0 rounded-md border px-3 text-sm"
                            aria-label="Filter completed booking chart by month"
                          />
                          <div className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-200">
                            {filteredCompletedHistoryBookings.length} completed booking{filteredCompletedHistoryBookings.length === 1 ? '' : 's'}
                          </div>
                        </div>
                      </div>
                      {filteredCompletedHistoryBookings.length > 0 ? (
                        <div style={{ height: `${historyChartHeight}px` }}>
                          <Bar data={historyChartData} options={historyChartOptions} />
                        </div>
                      ) : (
                        <div className="rounded-md border border-dashed p-6 text-sm text-slate-500">
                          No completed bookings found in {historyMonth}.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-6 text-sm text-slate-500">
                      No completed bookings available for the chart yet.
                    </div>
                  )}

                  <div className="grid gap-3">
                    {historyBookings.map((booking) => (
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
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-dashed p-6 text-sm text-slate-500">
                  No booking history available yet.
                </div>
              )}
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
                {ba.data.skill_tags.map((item) => {
                  const tag = 'tag' in item ? item.tag : item;
                  return <Badge key={tag.id} tone="info">{tag.name}</Badge>;
                })}
              </div>
              {canManageBa ? (
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

          {isManagerView ? (
            <Card>
              <CardHeader><CardTitle>Private Notes</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                {canManageBa ? (
                  <>
                    <Field label="Append note">
                      <textarea value={note} onChange={(event) => setNote(event.target.value)} className="min-h-24 rounded-md border p-3" maxLength={5000} />
                    </Field>
                    <Button onClick={() => appendNote.mutate()} disabled={!note}>Append Note</Button>
                  </>
                ) : null}
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
