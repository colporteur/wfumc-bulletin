export default function PrayerRequestsSection({ bulletin }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-xl text-umc-900">Prayer Requests</h2>
        <p className="text-sm text-gray-600 mt-1">
          Active prayer requests are shared across all bulletins. Add or remove
          them here; they appear in the worshipper view automatically.
        </p>
      </div>

      <div className="card text-center text-gray-500">
        <p className="text-sm">Editor coming in a future build session.</p>
      </div>
    </div>
  );
}
