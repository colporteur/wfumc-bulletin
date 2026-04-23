import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-6">
      <h1 className="font-serif text-4xl text-umc-900">404</h1>
      <p className="mt-3 text-gray-600">Page not found.</p>
      <Link to="/" className="mt-6 btn-primary">
        Back to bulletin
      </Link>
    </div>
  );
}
