import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useAuth } from '@/auth/AuthProvider';
import { apiFetch, type BAProfile, type BookingPriority, type Project } from '@/lib/api';
import { CAPACITY_OPTIONS } from '@/lib/capacity';
import { Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

type RangeCheck = {
  has_overbook_risk_after_request: boolean;
};

export function BookingModal({
  open,
  onClose,
  onSuccess,
  initialBaId = '',
  initialProjectId = '',
  initialStartDate = '',
  initialEndDate = ''
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialBaId?: string;
  initialProjectId?: string;
  initialStartDate?: string;
  initialEndDate?: string;
}) {
  const { user } = useAuth();
  const role = user?.role ?? 'BA';
  const isManagerRole = role === 'BA_MANAGER';
  const queryClient = useQueryClient();

  const bas = useQuery({
    queryKey: ['bookable-bas', role],
    queryFn: () => apiFetch<BAProfile[]>('/api/ba?bookable=true'),
    enabled: open
  });

  const allBas = useQuery({
    queryKey: ['ba-directory', role],
    queryFn: () => apiFetch<BAProfile[]>('/api/ba'),
    enabled: Boolean(open && initialBaId)
  });

  const modalBas = useMemo(() => {
    const options = [...(bas.data ?? [])];
    const selectedBa = initialBaId
      ? allBas.data?.find((ba) => ba.id === initialBaId)
      : undefined;

    if (selectedBa && !options.some((ba) => ba.id === selectedBa.id)) {
      options.unshift(selectedBa);
    }

    return options;
  }, [allBas.data, bas.data, initialBaId]);

  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch<Project[]>('/api/projects'),
    enabled: open
  });

  const [form, setForm] = useState({
    ba_id: initialBaId,
    project_id: initialProjectId,
    project_name: '',
    title: '',
    description: '',
    notes: '',
    start_date: initialStartDate || format(new Date(), 'yyyy-MM-dd'),
    end_date: initialEndDate || format(new Date(), 'yyyy-MM-dd'),
    capacity_percent: 50,
    priority: 'MEDIUM' as BookingPriority,
    direct: false,
    auto_assign: !initialBaId
  });
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (open) {
      const autoAssign = !initialBaId;
      const initialProjectName = initialProjectId
        ? projects.data?.find((project) => project.id === initialProjectId)?.name ?? ''
        : '';
      setForm((prev) => ({
        ...prev,
        ba_id: initialBaId,
        project_id: initialProjectId,
        project_name: initialProjectName,
        start_date: initialStartDate || format(new Date(), 'yyyy-MM-dd'),
        end_date: initialEndDate || format(new Date(), 'yyyy-MM-dd'),
        auto_assign: autoAssign
      }));
      setLocalError('');
    }
  }, [open, initialBaId, initialProjectId, initialStartDate, initialEndDate, projects.data]);

  const capacityCheck = useQuery({
    queryKey: [
      'capacity-range-check',
      form.ba_id,
      form.start_date,
      form.end_date,
      form.capacity_percent
    ],
    queryFn: () =>
      apiFetch<RangeCheck>(
        `/api/capacity/range-check?ba_id=${encodeURIComponent(form.ba_id)}&start_date=${form.start_date}&end_date=${form.end_date}&capacity_percent=${form.capacity_percent}`
      ),
    enabled: Boolean(open && form.ba_id && form.start_date && form.end_date)
  });

  const mutation = useMutation({
    mutationFn: () => {
      const { auto_assign, ...payload } = form;
      return apiFetch(form.direct ? '/api/bookings/direct' : '/api/bookings/request', {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          ba_id: auto_assign ? '' : payload.ba_id
        })
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['capacity-summary'] });
      onSuccess?.();
      onClose();
    }
  });

  if (!open) return null;

  return (
    <Modal title="Create Booking Request" open={open} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (form.end_date < form.start_date) {
            setLocalError('End date must be greater than or equal to start date.');
            return;
          }
          setLocalError('');
          mutation.mutate();
        }}
      >
        {bas.isLoading || allBas.isLoading || projects.isLoading ? (
          <div className="p-4 text-center text-sm text-slate-500">Loading data...</div>
        ) : (
          <>
            <Field label="BA">
              <select
                value={form.ba_id}
                onChange={(event) =>
                  setForm({
                    ...form,
                    ba_id: event.target.value,
                    auto_assign: event.target.value === ''
                  })
                }
                className="h-10 rounded-md border px-3"
              >
                <option value="">Auto assign</option>
                {modalBas.map((ba) => (
                  <option key={ba.id} value={ba.id}>
                    {ba.full_name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                Leave unassigned for BA Manager to assign later.
              </p>
            </Field>
            <Field label="Project name">
              <input
                value={form.project_name}
                onChange={(event) =>
                  setForm({ ...form, project_id: '', project_name: event.target.value })
                }
                className="h-10 rounded-md border px-3"
                placeholder="Enter project name"
                list="booking-project-name-options"
                required
              />
              <datalist id="booking-project-name-options">
                {(projects.data ?? []).map((project) => (
                  <option key={project.id} value={project.name} />
                ))}
              </datalist>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date">
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(event) =>
                    setForm({ ...form, start_date: event.target.value })
                  }
                  className="h-10 rounded-md border px-3"
                  required
                />
              </Field>
              <Field label="End date">
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(event) => setForm({ ...form, end_date: event.target.value })}
                  className="h-10 rounded-md border px-3"
                  required
                />
              </Field>
            </div>
            <Field label="Title">
              <input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                className="h-10 rounded-md border px-3"
                required
              />
            </Field>
            <Field label="Description">
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                className="min-h-24 rounded-md border p-3"
                required
              />
            </Field>
            <Field label="Ghi chú thêm / Notes">
              <textarea
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                className="min-h-20 rounded-md border p-3"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Capacity">
                <select
                  value={form.capacity_percent}
                  onChange={(event) =>
                    setForm({ ...form, capacity_percent: Number(event.target.value) })
                  }
                  className="h-10 rounded-md border px-3"
                >
                  {CAPACITY_OPTIONS.map((capacityPercent) => (
                    <option key={capacityPercent} value={capacityPercent}>
                      {capacityPercent}%
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  value={form.priority}
                  onChange={(event) =>
                    setForm({ ...form, priority: event.target.value as BookingPriority })
                  }
                  className="h-10 rounded-md border px-3"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </Field>
            </div>
            {isManagerRole ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.direct}
                  onChange={(event) => setForm({ ...form, direct: event.target.checked })}
                />
                Create direct approved booking
              </label>
            ) : null}
            {capacityCheck.data?.has_overbook_risk_after_request ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Overbook risk: selected range may exceed 100% capacity when pending
                requests are included.
              </div>
            ) : null}
            {localError ? (
              <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
                {localError}
              </div>
            ) : null}
            {mutation.error ? (
              <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
                {mutation.error.message}
              </div>
            ) : null}
            <Button type="submit">
              {mutation.isPending ? 'Submitting...' : 'Submit Request'}
            </Button>
          </>
        )}
      </form>
    </Modal>
  );
}
