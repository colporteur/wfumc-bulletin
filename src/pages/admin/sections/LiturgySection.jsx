export default function LiturgySection({ bulletin }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-xl text-umc-900">Order of Worship</h2>
        <p className="text-sm text-gray-600 mt-1">
          The full liturgy — each item has a title, optional center text,
          person/group/hymn #, and an expand-on-tap detail area. Items are
          reorderable. Hymns, scripture, and the sermon have special fields.
        </p>
      </div>

      <div className="card text-center text-gray-500">
        <p className="text-sm">
          Editor coming in a future build session (this is the big one).
        </p>
        <p className="text-xs mt-2">
          Will include 21+ default items, drag-reorder, Claude-assist for
          hymn lyrics and scripture auto-fill, and a dedicated sermon
          manuscript upload.
        </p>
      </div>
    </div>
  );
}
