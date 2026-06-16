import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { apiFetch, type AdminUser, type UserRole } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { LoadingScreen } from '@/components/ui/loading-screen';

const ROLES: UserRole[] = ['BA', 'PM_PO', 'BA_MANAGER', 'ADMIN', 'IT_ADMIN'];

function fmtDate(value?: string | null) {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'dd/MM/yyyy');
  } catch {
    return value;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [roleEditUser, setRoleEditUser] = useState<AdminUser | null>(null);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);

  const queryKey = useMemo(
    () => ['admin-users', search, roleFilter, statusFilter],
    [search, roleFilter, statusFilter]
  );

  const users = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (roleFilter) params.set('role', roleFilter);
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString();
      return apiFetch<AdminUser[]>(`/api/admin/users${qs ? `?${qs}` : ''}`);
    }
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  const disable = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/admin/users/${id}/disable`, { method: 'PATCH' }),
    onSuccess: refresh
  });
  const enable = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/admin/users/${id}/enable`, { method: 'PATCH' }),
    onSuccess: refresh
  });
  const reset = useMutation({
    mutationFn: (user: AdminUser) =>
      apiFetch<{ temp_password: string }>(`/api/admin/users/${user.id}/reset-password`, {
        method: 'POST'
      }).then((res) => ({ res, user })),
    onSuccess: ({ res, user }) =>
      setTempPassword({ email: user.email, password: res.temp_password })
  });

  const rows = users.data ?? [];
  const actionError = disable.error ?? enable.error ?? reset.error;

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="IT Admin"
        title="User Management"
        description="Create accounts, change roles, enable or disable users, and reset passwords."
        actions={<Button onClick={() => setCreateOpen(true)}>Create user</Button>}
      />

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email"
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
          >
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace('_', ' ')}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
          >
            <option value="">All status</option>
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
          </select>
        </CardContent>
      </Card>

      {actionError ? (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{errorMessage(actionError)}</div>
      ) : null}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {users.isLoading ? (
            <LoadingScreen message="Loading users" />
          ) : users.error ? (
            <div className="p-5 text-sm text-rose-700">Could not load users.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 font-semibold">Name</th>
                    <th className="px-4 py-2 font-semibold">Email</th>
                    <th className="px-4 py-2 font-semibold">Role</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2 font-semibold">Last login</th>
                    <th className="px-4 py-2 font-semibold">Created</th>
                    <th className="px-4 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-4 text-slate-500">
                        No users match these filters.
                      </td>
                    </tr>
                  ) : (
                    rows.map((u) => (
                      <tr key={u.id} className="border-b border-slate-100">
                        <td className="px-4 py-2 font-medium text-slate-900">{u.full_name}</td>
                        <td className="px-4 py-2 text-slate-600">{u.email}</td>
                        <td className="px-4 py-2">
                          <Badge tone="info">{u.role.replace('_', ' ')}</Badge>
                        </td>
                        <td className="px-4 py-2">
                          <Badge tone={u.status === 'ACTIVE' ? 'success' : 'neutral'}>{u.status}</Badge>
                        </td>
                        <td className="px-4 py-2 text-slate-600">{fmtDate(u.last_login_at)}</td>
                        <td className="px-4 py-2 text-slate-600">{fmtDate(u.created_at)}</td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end gap-1.5">
                            <Button variant="secondary" size="sm" onClick={() => setRoleEditUser(u)}>
                              Edit role
                            </Button>
                            {u.status === 'ACTIVE' ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => disable.mutate(u.id)}
                                disabled={disable.isPending}
                              >
                                Disable
                              </Button>
                            ) : (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => enable.mutate(u.id)}
                                disabled={enable.isPending}
                              >
                                Enable
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => reset.mutate(u)}
                              disabled={reset.isPending}
                            >
                              Reset pw
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(temp) => {
          setCreateOpen(false);
          refresh();
          if (temp) setTempPassword(temp);
        }}
      />

      <EditRoleModal
        user={roleEditUser}
        onClose={() => setRoleEditUser(null)}
        onSaved={() => {
          setRoleEditUser(null);
          refresh();
        }}
      />

      <Modal
        title="Temporary password"
        open={Boolean(tempPassword)}
        onClose={() => setTempPassword(null)}
      >
        {tempPassword ? (
          <div className="grid gap-3 text-sm">
            <p className="text-slate-600">
              Share this one-time password with <span className="font-semibold">{tempPassword.email}</span>{' '}
              securely. It is shown once.
            </p>
            <code className="rounded-lg bg-slate-100 px-3 py-2 font-mono text-base text-slate-900">
              {tempPassword.password}
            </code>
            <div className="flex justify-end">
              <Button onClick={() => setTempPassword(null)}>Done</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function CreateUserModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (temp: { email: string; password: string } | null) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('BA');

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ email: string; temp_password?: string }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ full_name: fullName.trim(), email: email.trim(), role })
      }),
    onSuccess: (res) => {
      setFullName('');
      setEmail('');
      setRole('BA');
      onCreated(res.temp_password ? { email: res.email, password: res.temp_password } : null);
    }
  });

  return (
    <Modal title="Create user" open={open} onClose={onClose}>
      <form
        className="grid gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label className="grid gap-1">
          <span className="font-medium text-slate-700">Full name</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 px-3"
            required
          />
        </label>
        <label className="grid gap-1">
          <span className="font-medium text-slate-700">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 px-3"
            required
          />
        </label>
        <label className="grid gap-1">
          <span className="font-medium text-slate-700">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="h-9 rounded-lg border border-slate-200 px-2"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-500">
          A one-time password is generated and shown after creation.
        </p>
        {create.error ? (
          <div className="rounded-lg bg-rose-50 p-2 text-rose-700">{errorMessage(create.error)}</div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create user'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditRoleModal({
  user,
  onClose,
  onSaved
}: {
  user: AdminUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState<UserRole>('BA');
  useEffect(() => {
    if (user) setRole(user.role);
  }, [user]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/users/${user?.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role })
      }),
    onSuccess: onSaved
  });

  return (
    <Modal title="Edit role" open={Boolean(user)} onClose={onClose}>
      {user ? (
        <div className="grid gap-3 text-sm">
          <p className="text-slate-600">
            {user.full_name} · <span className="text-slate-500">{user.email}</span>
          </p>
          <label className="grid gap-1">
            <span className="font-medium text-slate-700">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="h-9 rounded-lg border border-slate-200 px-2"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          {save.error ? (
            <div className="rounded-lg bg-rose-50 p-2 text-rose-700">{errorMessage(save.error)}</div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save role'}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
