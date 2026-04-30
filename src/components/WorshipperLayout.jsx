import { Outlet, Link } from 'react-router-dom';
import VersionStamp from './VersionStamp.jsx';

export default function WorshipperLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="bg-umc-900 text-white px-4 py-3 no-print">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link to="/" className="font-serif text-lg leading-tight">
            Wedowee First UMC
          </Link>
          <nav className="text-xs flex items-center gap-4">
            <Link to="/archive" className="text-umc-100 hover:text-white">
              Past bulletins
            </Link>
            <Link to="/install" className="text-umc-100 hover:text-white">
              Install
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
      <footer className="bg-gray-50 border-t border-gray-200 px-4 py-6 text-xs text-gray-500 text-center no-print">
        <p>Wedowee First United Methodist Church</p>
        <p className="mt-1">
          <Link to="/admin/login" className="text-gray-400 hover:text-gray-600">
            Staff
          </Link>
        </p>
        <VersionStamp />
      </footer>
    </div>
  );
}
