import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';

export default function AdminLogin() {
  const { signIn, session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Preserve the full original URL — pathname AND search/hash — so the
  // user lands back exactly where they were (filters and all).
  const fromLoc = location.state?.from;
  const from =
    (fromLoc?.pathname || '/admin') +
    (fromLoc?.search || '') +
    (fromLoc?.hash || '');

  // Already signed in? Bounce to admin (safely, in an effect).
  useEffect(() => {
    if (session) {
      navigate(from, { replace: true });
    }
  }, [session, from, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gray-50">
      <div className="card max-w-md w-full">
        <h1 className="font-serif text-2xl text-umc-900 text-center">Staff Sign In</h1>
        <p className="text-sm text-gray-600 text-center mt-1">
          Wedowee First UMC Bulletin
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full disabled:opacity-50"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">
          <Link to="/" className="text-gray-400 hover:text-gray-600">
            ← Back to bulletin
          </Link>
        </p>
      </div>
    </div>
  );
}
