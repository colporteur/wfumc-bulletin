import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import './index.css';

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

// Mobile camera-restore: when a user opens the camera from a deep-linked
// page like /admin/bulletins/<id>, Android sometimes kills the browser
// tab to free memory. When they return, the browser reloads us — but
// occasionally to the entry URL instead of the page they were on. We
// stash the URL in sessionStorage just before opening the camera, then
// replace history here at boot (before React Router reads the URL) so
// the user lands back on their bulletin instead of the dashboard.
try {
  const restoreKey = 'wfumc-photo-return';
  const saved = sessionStorage.getItem(restoreKey);
  if (saved) {
    sessionStorage.removeItem(restoreKey);
    const currentPath =
      window.location.pathname + window.location.search + window.location.hash;
    if (saved !== currentPath) {
      window.history.replaceState(null, '', saved);
    }
  }
} catch {
  // sessionStorage may be unavailable in private mode — non-fatal.
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
