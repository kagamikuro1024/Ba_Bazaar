import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
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
          <h1 className="mt-4 text-3xl font-bold text-slate-950">Register</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Create a PM/PO account for booking requests.
          </p>
        </div>
        <Card className="rounded-[1.75rem] border-white/80 shadow-xl shadow-blue-950/10">
          <CardContent className="grid gap-4 p-5">
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Full name
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-base outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                autoComplete="name"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-base outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                autoComplete="email"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-base outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                autoComplete="new-password"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-base outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                autoComplete="new-password"
              />
            </label>
            {error ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            ) : null}
            {success ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {success}
              </div>
            ) : null}
            <Button
              onClick={async () => {
                if (password !== confirmPassword) {
                  setError('Password confirmation does not match.');
                  return;
                }

                setSubmitting(true);
                setError('');
                setSuccess('');
                try {
                  await register({
                    full_name: fullName,
                    email,
                    password
                  });
                  setSuccess('Account created. You can sign in now.');
                  navigate('/login', { replace: true });
                } catch (nextError) {
                  setError(nextError instanceof Error ? nextError.message : 'Register failed.');
                } finally {
                  setSubmitting(false);
                }
              }}
              disabled={submitting}
            >
              {submitting ? 'Creating account...' : 'Create account'}
            </Button>
            <p className="text-sm text-slate-600">
              Already have an account? <Link className="font-semibold text-blue-700" to="/login">Sign in</Link>.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
