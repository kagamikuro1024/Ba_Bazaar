import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#dbeafe,_transparent_32rem),linear-gradient(180deg,#f8fafc,#eef6ff)] px-3 py-5 sm:px-4 sm:py-10">
      <div className="mx-auto grid max-w-md gap-4 sm:gap-6">
        <Link
          to="/"
          className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-slate-600 transition hover:text-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to overview
        </Link>
        <div className="rounded-[2rem] border border-white/70 bg-white/70 p-4 shadow-xl shadow-blue-950/10 backdrop-blur">
          <p className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-xs font-black text-white shadow-sm shadow-blue-600/30">
            BA
          </p>
          <h1 className="mt-4 text-3xl font-bold text-slate-950">Sign in</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Access timelines, booking requests, and manager tools.
          </p>
        </div>
        <Card className="rounded-[1.75rem] border-white/80 shadow-xl shadow-blue-950/10">
          <CardContent className="grid gap-4 p-5">
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-base outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                placeholder="manager@ba-bazaar.local"
                autoComplete="email"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-base outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                placeholder="Enter password"
                autoComplete="current-password"
              />
            </label>
            {error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
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
