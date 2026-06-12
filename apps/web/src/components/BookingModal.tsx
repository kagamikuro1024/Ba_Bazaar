import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useAuth } from '@/auth/AuthProvider';
import { apiFetch, type BAProfile, type BookingPriority, type Project, type SkillTag } from '@/lib/api';
import { type RecommendationQuery } from '@/lib/recommendations';
import { RecommendationDropdown } from '@/components/ba/RecommendationDropdown';
import { CAPACITY_OPTIONS } from '@/lib/capacity';
import { Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

type RangeCheck = {
  requested_capacity: number;
  has_overbook_risk_after_request: boolean;
  max_risk_capacity: number;
  max_risk_capacity_after_request: number;
  explanation: {
    risk_level: 'SAFE' | 'NEAR_LIMIT' | 'OVERBOOK_RISK';
    summary: string;
    why_flagged: string[];
    signals_used: string[];
    suggested_actions: string[];
    risk_days: Array<{
      date: string;
      approved_capacity: number;
      pending_capacity: number;
      risk_capacity: number;
      requested_capacity: number;
      risk_after_request: number;
      overflow_capacity: number;
    }>;
  };
};

type SkillExtractionResponse = {
  suggested_tag_ids: string[];
  suggested_level: '' | 'JUNIOR' | 'MIDDLE' | 'SENIOR' | 'LEAD';
  reasoning: string[];
  provider: 'deepseek' | 'heuristic';
};

const RISK_LEVEL_LABELS: Record<RangeCheck['explanation']['risk_level'], string> = {
  SAFE: 'Safe',
  NEAR_LIMIT: 'Near limit',
  OVERBOOK_RISK: 'Overbook risk'
};

const RISK_LEVEL_STYLES: Record<
  RangeCheck['explanation']['risk_level'],
  {
    panel: string;
    badge: string;
    eyebrow: string;
    card: string;
    muted: string;
  }
> = {
  SAFE: {
    panel: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    badge: 'bg-white/90 text-emerald-900 ring-emerald-200',
    eyebrow: 'text-emerald-700',
    card: 'bg-white/80 text-emerald-950',
    muted: 'text-emerald-800'
  },
  NEAR_LIMIT: {
    panel: 'border-sky-200 bg-sky-50 text-sky-950',
    badge: 'bg-white/90 text-sky-900 ring-sky-200',
    eyebrow: 'text-sky-700',
    card: 'bg-white/80 text-sky-950',
    muted: 'text-sky-800'
  },
  OVERBOOK_RISK: {
    panel: 'border-amber-200 bg-amber-50 text-amber-950',
    badge: 'bg-white/80 text-amber-900 ring-amber-200',
    eyebrow: 'text-amber-700',
    card: 'bg-white/80 text-amber-950',
    muted: 'text-amber-800'
  }
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

  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: () => apiFetch<SkillTag[]>('/api/tags'),
    enabled: open
  });

  const [form, setForm] = useState({
    ba_id: initialBaId,
    project_id: initialProjectId,
    project_name: '',
    title: '',
    description: '',
    notes: '',
    required_skill_ids: [] as string[],
    required_level: '' as '' | 'JUNIOR' | 'MIDDLE' | 'SENIOR' | 'LEAD',
    skill_source: 'manual' as 'manual' | 'prd',
    prd_text: '',
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
        auto_assign: autoAssign,
        required_skill_ids: [],
        required_level: '',
        skill_source: 'manual',
        prd_text: ''
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

  const extractSkills = useMutation({
    mutationFn: async () => {
      const prdText = form.prd_text.trim();
      if (!prdText) {
        throw new Error('Paste PRD or requirement text first.');
      }
      return apiFetch<SkillExtractionResponse>('/api/tags/extract', {
        method: 'POST',
        body: JSON.stringify({
          text: prdText,
          project_id: form.project_id || undefined,
          title: form.title || undefined,
          description: form.description || undefined
        })
      });
    },
    onSuccess: (payload) => {
      setForm((prev) => ({
        ...prev,
        required_skill_ids: payload.suggested_tag_ids,
        required_level: payload.suggested_level,
        skill_source: 'prd'
      }));
    }
  });

  const mutation = useMutation({
    mutationFn: () => {
      const { auto_assign, prd_text, skill_source, ...payload } = form;
      return apiFetch(form.direct ? '/api/bookings/direct' : '/api/bookings/request', {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          ba_id: auto_assign ? '' : payload.ba_id,
          required_skill_ids: payload.required_skill_ids,
          notes: [payload.notes, skill_source === 'prd' && prd_text.trim() ? `PRD context:\n${prd_text.trim()}` : '']
            .filter(Boolean)
            .join('\n\n')
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

  const overbookExplanation = capacityCheck.data?.explanation;
  const riskLevel = overbookExplanation?.risk_level ?? 'SAFE';
  const riskStyles = RISK_LEVEL_STYLES[riskLevel];
  const riskDays = overbookExplanation?.risk_days ?? [];
  const primaryRiskDay = riskDays[0];
  const shouldShowCapacityExplain = Boolean(
    form.ba_id &&
      form.start_date &&
      form.end_date &&
      !capacityCheck.isLoading &&
      !capacityCheck.isError &&
      overbookExplanation
  );

  const suggestionQuery = useMemo<RecommendationQuery | null>(() => {
    if (!form.start_date || !form.end_date || form.end_date < form.start_date) {
      return null;
    }

    return {
      start_date: form.start_date,
      end_date: form.end_date,
      capacity_percent: form.capacity_percent,
      required_skill_ids: form.required_skill_ids.length ? form.required_skill_ids : undefined,
      level: form.required_level || undefined,
      project_id: form.project_id || undefined,
      exclude_ba_ids: form.ba_id ? [form.ba_id] : undefined,
      limit: 5
    };
  }, [form.ba_id, form.capacity_percent, form.end_date, form.project_id, form.required_level, form.required_skill_ids, form.start_date]);

  const showSuggestBaPanel = Boolean(
    suggestionQuery &&
      (form.auto_assign || riskLevel === 'OVERBOOK_RISK' || !form.ba_id)
  );


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
                Leave unassigned — the BA Manager will pick from model
                suggestions, then approve.
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
                required
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
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
            <Field label="Required skills">
              <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
                <div className="grid gap-2">
                  <label className="grid gap-1 text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">Choose skill tags</span>
                    <select
                      value=""
                      onChange={(event) => {
                        const value = event.target.value;
                        if (!value) return;
                        setForm((prev) => ({
                          ...prev,
                          required_skill_ids: prev.required_skill_ids.includes(value)
                            ? prev.required_skill_ids
                            : [...prev.required_skill_ids, value],
                          skill_source: 'manual'
                        }));
                      }}
                      className="h-10 rounded-md border px-3"
                    >
                      <option value="">Add required skill</option>
                      {(tags.data ?? []).map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name} ({tag.group === 'DOMAIN' ? 'Domain' : 'Analysis'})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <textarea
                  value={form.prd_text}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, prd_text: event.target.value }))
                  }
                  className="min-h-24 rounded-md border p-3 text-sm"
                  placeholder="Paste PRD, scope notes, or requirement details so AI can suggest skill tags for this request."
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => extractSkills.mutate()}
                    disabled={!form.prd_text.trim() || extractSkills.isPending}
                  >
                    {extractSkills.isPending ? 'Extracting…' : 'Extract skills from PRD'}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.required_skill_ids.length ? (
                    form.required_skill_ids.map((tagId) => {
                      const tag = (tags.data ?? []).find((item) => item.id === tagId);
                      return (
                        <button
                          key={tagId}
                          type="button"
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              required_skill_ids: prev.required_skill_ids.filter((id) => id !== tagId)
                            }))
                          }
                          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:border-slate-400"
                        >
                          {tag?.name ?? 'Unknown tag'} ×
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-xs text-slate-500">
                      No required skills selected yet. Add tags manually or extract them from PRD text.
                    </p>
                  )}
                  {form.required_level ? (
                    <p className="text-xs text-slate-500">
                      System-selected BA level: <span className="font-semibold text-slate-700">{form.required_level}</span>
                    </p>
                  ) : null}
                </div>
                {extractSkills.data?.reasoning?.length ? (
                  <div className="grid gap-1 text-xs text-slate-500">
                    <p className="font-semibold uppercase tracking-[0.18em] text-slate-400">
                      {extractSkills.data.provider === 'deepseek' ? 'DeepSeek reasoning' : 'Fallback matching'}
                    </p>
                    {extractSkills.data.reasoning.slice(0, 3).map((reason) => (
                      <p key={reason}>{reason}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
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
            {showSuggestBaPanel ? (
              <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      AI assist
                    </p>
                    <p className="text-sm font-medium text-slate-900">
                      {riskLevel === 'OVERBOOK_RISK'
                        ? 'This request may exceed the selected BA\'s capacity.'
                        : 'Need help choosing the best BA for this request?'}
                    </p>
                    <p className="text-xs text-slate-600">
                      {riskLevel === 'OVERBOOK_RISK'
                        ? `${riskDays.length} risk day${riskDays.length === 1 ? '' : 's'} · peak ${capacityCheck.data?.max_risk_capacity_after_request ?? 0}%`
                        : 'Get ranked suggestions based on availability, project fit, and capacity headroom.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <RecommendationDropdown
                      query={suggestionQuery}
                      selectedBaId={form.ba_id}
                      triggerLabel={riskLevel === 'OVERBOOK_RISK' ? 'Find safer BA' : 'Suggest BAs'}
                      onSelectCandidate={(baId) =>
                        setForm((prev) => ({
                          ...prev,
                          ba_id: baId,
                          auto_assign: false
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            ) : null}
            {shouldShowCapacityExplain ? (
              <details className={`rounded-md border ${riskStyles.panel}`} open={riskLevel === 'OVERBOOK_RISK'}>
                <summary className="cursor-pointer list-none px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${riskStyles.eyebrow}`}>
                        {riskLevel === 'OVERBOOK_RISK' ? 'Why this is risky' : 'Capacity status'}
                      </p>
                      <p className="text-sm font-medium text-current">
                        {riskLevel === 'OVERBOOK_RISK'
                          ? overbookExplanation?.summary
                          : 'Safe to proceed with the selected BA.'}
                      </p>
                      <p className={`text-xs ${riskStyles.muted}`}>
                        {primaryRiskDay
                          ? `First risk day ${primaryRiskDay.date} · approved ${primaryRiskDay.approved_capacity}% · pending ${primaryRiskDay.pending_capacity}% · request ${primaryRiskDay.requested_capacity}%`
                          : 'No overbook risk detected for the selected BA and date range.'}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${riskStyles.badge}`}
                    >
                      {RISK_LEVEL_LABELS[riskLevel]}
                    </span>
                  </div>
                </summary>
                <div className="grid gap-3 border-t border-black/5 px-4 py-4 text-sm">
                  {overbookExplanation?.why_flagged?.length ? (
                    <div className="grid gap-1.5">
                      {overbookExplanation.why_flagged.slice(0, 3).map((reason) => (
                        <p key={reason}>{reason}</p>
                      ))}
                    </div>
                  ) : null}
                  {overbookExplanation?.suggested_actions?.length ? (
                    <div className="grid gap-1">
                      <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${riskStyles.eyebrow}`}>
                        Suggested next steps
                      </p>
                      <div className="grid gap-1 sm:grid-cols-2">
                        {overbookExplanation.suggested_actions.slice(0, 3).map((action) => (
                          <p key={action} className={`rounded-md px-3 py-2 text-xs ${riskStyles.card}`}>
                            {action}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {riskDays.length ? (
                    <div className="grid gap-1">
                      <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${riskStyles.eyebrow}`}>
                        Risk days
                      </p>
                      <div className="grid gap-1 sm:grid-cols-2">
                        {riskDays.slice(0, 4).map((day) => (
                          <p key={day.date} className={`rounded-md px-3 py-2 text-xs ${riskStyles.card}`}>
                            {day.date} · peak {day.risk_after_request}% · overflow {day.overflow_capacity}%
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </details>
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
