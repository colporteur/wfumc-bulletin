import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Archive from './pages/Archive.jsx';
import BulletinPage from './pages/BulletinPage.jsx';
import SermonArchive from './pages/SermonArchive.jsx';
import SermonPage from './pages/SermonPage.jsx';
import InstallHelp from './pages/InstallHelp.jsx';
import NotFound from './pages/NotFound.jsx';
import AdminLogin from './pages/admin/Login.jsx';
import AdminDashboard from './pages/admin/Dashboard.jsx';
import BulletinList from './pages/admin/BulletinList.jsx';
import BulletinEdit from './pages/admin/BulletinEdit.jsx';
import Settings from './pages/admin/Settings.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AdminLayout from './components/AdminLayout.jsx';
import WorshipperLayout from './components/WorshipperLayout.jsx';

export default function App() {
  return (
    <Routes>
      {/* Worshipper-facing */}
      <Route element={<WorshipperLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/archive" element={<Archive />} />
        <Route path="/b/:date" element={<BulletinPage />} />
        <Route path="/sermons" element={<SermonArchive />} />
        <Route path="/sermons/:id" element={<SermonPage />} />
        <Route path="/install" element={<InstallHelp />} />
      </Route>

      {/* Admin */}
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/bulletins" element={<BulletinList />} />
        <Route path="/admin/bulletins/:id" element={<BulletinEdit />} />
        <Route path="/admin/settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
