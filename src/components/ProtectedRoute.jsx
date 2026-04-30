import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import LoadingSpinner from './LoadingSpinner.jsx';

export default function ProtectedRoute({ children, requirePastor = false }) {
  const { loading, session, isStaff, isPastor } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingSpinner label="Checking access..." />;
  }

  if (!session) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  if (!isStaff) {
    return (
      <div className="max-w-lg mx-auto mt-12 p-6 text-center space-y-4">
        <h1 className="text-xl font-semibold">No staff profile</h1>
        <p className="text-gray-600 text-sm">
          You're signed in, but no staff profile is loaded for this user. This
          usually clears up with a reload — the profile briefly didn't come
          back from the server. If reloading doesn't work, ask Pastor Todd to
          confirm your account.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-primary"
        >
          Reload
        </button>
      </div>
    );
  }

  if (requirePastor && !isPastor) {
    return (
      <div className="max-w-lg mx-auto mt-12 p-6 text-center">
        <h1 className="text-xl font-semibold mb-2">Pastor access only</h1>
        <p className="text-gray-600 text-sm">
          This page is restricted to the pastor role.
        </p>
      </div>
    );
  }

  return children;
}
