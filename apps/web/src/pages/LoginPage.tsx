import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { roleHomePath } from '@/auth/routes';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const showDemoAccounts = import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto grid max-w-md gap-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">BA Bazaar</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">Sign in</h1>
          <p className="mt-2 text-sm text-slate-600">
            Use your internal account to access timeline, requests, and manager tools.
          </p>
        </div>
        <Card>
          <CardContent className="grid gap-4 p-5">
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-10 rounded-md border border-slate-200 bg-white px-3"
                autoComplete="email"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-10 rounded-md border border-slate-200 bg-white px-3"
                autoComplete="current-password"
              />
            </label>
            {error ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            ) : null}
            <Button
              onClick={async () => {
                setSubmitting(true);
                setError('');
                try {
                  const user = await login(email, password);
                  navigate(roleHomePath(user.role), { replace: true });
                } catch (nextError) {
                  setError(nextError instanceof Error ? nextError.message : 'Login failed.');
                } finally {
                  setSubmitting(false);
                }
              }}
              disabled={submitting}
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </Button>
            <p className="text-sm text-slate-600">
              Need a PM/PO account? <Link className="font-semibold text-blue-700" to="/register">Register here</Link>.
            </p>
          </CardContent>
        </Card>
        {showDemoAccounts ? (
          <Card>
            <CardContent className="grid gap-2 p-5 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">Demo accounts</p>
              <p>BA Manager: `manager@ba-bazaar.local` / `Manager@123`</p>
              <p>PM/PO: `pm1@ba-bazaar.local` / `Pmpo@123`</p>
              <p>BA: `ba1@ba-bazaar.local` / `Ba@123`</p>
              <p>Admin: `admin@ba-bazaar.local` / `Admin@123`</p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
