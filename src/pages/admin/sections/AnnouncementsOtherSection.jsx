export default function AnnouncementsOtherSection({ bulletin }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-xl text-umc-900">Announcements &amp; Other</h2>
        <p className="text-sm text-gray-600 mt-1">
          Short bullet-style announcements, plus flexible "other" blocks for
          flyers, personal notes from the pastor, and heading-body content.
        </p>
      </div>

      <div className="card text-center text-gray-500">
        <p className="text-sm">Editor coming in a future build session.</p>
      </div>
    </div>
  );
}
