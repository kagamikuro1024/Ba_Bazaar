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
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto grid max-w-md gap-6">
        <Link
          to="/"
          className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-slate-600 transition hover:text-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Về trang giới thiệu
        </Link>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">BA Bazaar</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">Register</h1>
          <p className="mt-2 text-sm text-slate-600">
            Self-registration is available only for PM/PO accounts.
          </p>
        </div>
        <Card>
          <CardContent className="grid gap-4 p-5">
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Full name
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="h-10 rounded-md border border-slate-200 bg-white px-3"
                autoComplete="name"
              />
            </label>
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
                autoComplete="new-password"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="h-10 rounded-md border border-slate-200 bg-white px-3"
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
