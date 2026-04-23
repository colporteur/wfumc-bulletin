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
      <div className="max-w-lg mx-auto mt-12 p-6 text-center">
        <h1 className="text-xl font-semibold mb-2">No staff profile</h1>
        <p className="text-gray-600 text-sm">
          You're signed in, but you don't have a staff profile yet. Ask Pastor
          Todd to add you, or follow the SETUP.md instructions to give yourself
          one.
        </p>
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
