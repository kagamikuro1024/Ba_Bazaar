import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { apiFetch, type BALevel } from '@/lib/api';
import { Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

type CreateBAModalProps = {
  open: boolean;
  onClose: () => void;
  /** Called when the BA is successfully created. */
  onCreated?: () => void;
};

/**
 * CreateBAModal — the canonical "create BA account" popup.
 *
 * Extracted from BADirectoryPage so other surfaces (manager dashboard,
 * BA directory quick-add) can reuse it. Validation:
 *   - name, email, password, confirm-password required
 *   - password length >= 8
 *   - password === confirm-password
 */
export function CreateBAModal({ open, onClose, onCreated }: CreateBAModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    level: 'MIDDLE' as BALevel,
    joined_date: new Date().toISOString().slice(0, 10)
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ba-directory'] });
      onCreated?.();
      handleClose();
    }
  });

  function handleClose() {
    setForm({
      full_name: '',
      email: '',
      password: '',
      confirmPassword: '',
      phone: '',
      level: 'MIDDLE',
      joined_date: new Date().toISOString().slice(0, 10)
    });
    setLocalError('');
    create.reset();
    onClose();
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (form.password.length < 8) {
      setLocalError('Password must be at least 8 characters.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setLocalError('Password confirmation does not match.');
      return;
    }
    setLocalError('');
    create.mutate();
  }

  return (
    <Modal title="Create BA Account" open={open} onClose={handleClose}>
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <input
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
              value={form.full_name}
              onChange={(event) => setForm({ ...form, full_name: event.target.value })}
              required
              autoFocus
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              required
            />
          </Field>
          <Field label="Phone">
            <input
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          </Field>
          <Field label="Level">
            <select
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
              value={form.level}
              onChange={(event) => setForm({ ...form, level: event.target.value as BALevel })}
            >
              <option value="JUNIOR">JUNIOR</option>
              <option value="MIDDLE">MIDDLE</option>
              <option value="SENIOR">SENIOR</option>
              <option value="LEAD">LEAD</option>
            </select>
          </Field>
          <Field label="Initial password">
            <input
              type="password"
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              minLength={8}
              required
            />
          </Field>
          <Field label="Confirm password">
            <input
              type="password"
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
              value={form.confirmPassword}
              onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
              minLength={8}
              required
            />
          </Field>
          <Field label="Joined date" className="sm:col-span-2">
            <input
              type="date"
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
              value={form.joined_date}
              onChange={(event) => setForm({ ...form, joined_date: event.target.value })}
              required
            />
          </Field>
        </div>

        {localError ? (
          <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{localError}</div>
        ) : null}
        {create.error ? (
          <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
            {create.error.message}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            <Plus className="h-4 w-4" />
            {create.isPending ? 'Creating…' : 'Create BA'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
