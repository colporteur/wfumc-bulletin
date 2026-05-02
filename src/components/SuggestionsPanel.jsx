import { useEffect, useState } from 'react';
import {
  loadSuggestionsForBulletin,
  loadAddedSuggestionsForBulletin,
  reviewSuggestion,
  addSuggestionToBulletin,
  SUGGESTION_KIND_LABELS,
  SUGGESTION_STATUS_LABELS,
} from '../lib/suggestions';
import SmartAddModal from './SmartAddModal.jsx';

// Phase 4: Worship-element suggestions surfaced inside the bulletin
// editor's Order of Worship section.
//
// Suggestions are AUTHORED in the worship app (worship team / music
// director / admin from there). The bulletin app reads them and lets
// pastor / office_admin / music_director:
//   * Accept or decline pending suggestions inline
//   * Add an accepted suggestion as a liturgy_item with one click
//   * See which suggestions have already been incorporated
//
// Hides itself entirely when there's nothing relevant for this bulletin
// — no panel clutter on weeks with no suggestions.
export default function SuggestionsPanel({
  bulletin,
  userId,
  liturgyItems = [],
  onItemAdded,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingAccepted, setPendingAccepted] = useState([]);
  const [added, setAdded] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [smartAddSuggestion, setSmartAddSuggestion] = useState(null);

  const reload = async () => {
    if (!bulletin?.id || !bulletin?.service_date) return;
    setLoading(true);
    setError(null);
    try {
      const [open, used] = await Promise.all([
        loadSuggestionsForBulletin(bulletin.service_date),
        loadAddedSuggestionsForBulletin(bulletin.id),
      ]);
      setPendingAccepted(open);
      setAdded(used);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulletin?.id, bulletin?.service_date]);

  const handleReview = async (sug, status) => {
    setBusyId(sug.id);
    setError(null);
    try {
      await reviewSuggestion(sug.id, { status, reviewedBy: userId });
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleAdd = async (sug) => {
    setBusyId(sug.id);
    setError(null);
    try {
      await addSuggestionToBulletin(sug, bulletin.id);
      await reload();
      onItemAdded?.();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  // Hide the panel entirely if there's nothing to show. Don't show a
  // loading state for the empty case — keeps the editor clean.
  const nothing =
    !loading && pendingAccepted.length === 0 && added.length === 0 && !error;
  if (nothing) return null;

  return (
    <div className="card border-l-4 border-l-amber-400 bg-amber-50/30 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-serif text-base text-umc-900">
            Suggestions for this week
          </h3>
          <p className="text-xs text-gray-600 mt-0.5">
            From the worship team via the Worship Planning app.
          </p>
        </div>
        {(pendingAccepted.length > 0 || added.length > 0) && !loading && (
          <span className="text-[11px] text-gray-500">
            {pendingAccepted.length > 0 && (
              <span>{pendingAccepted.length} open</span>
            )}
            {pendingAccepted.length > 0 && added.length > 0 && ' · '}
            {added.length > 0 && (
              <span>{added.length} added</span>
            )}
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 italic">Loading…</p>
      ) : (
        <>
          {pendingAccepted.length > 0 && (
            <ul className="space-y-2">
              {pendingAccepted.map((sug) => (
                <SuggestionRow
                  key={sug.id}
                  suggestion={sug}
                  busy={busyId === sug.id}
                  onAccept={() => handleReview(sug, 'accepted')}
                  onDecline={() => handleReview(sug, 'declined')}
                  onAdd={() => handleAdd(sug)}
                  onSmartAdd={() => setSmartAddSuggestion(sug)}
                  hasLiturgyItems={liturgyItems.length > 0}
                />
              ))}
            </ul>
          )}
          {added.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-600 hover:text-gray-900">
                Already added ({added.length})
              </summary>
              <ul className="mt-1 ml-4 space-y-0.5">
                {added.map((sug) => (
                  <li key={sug.id} className="text-xs text-gray-600">
                    <span className="text-[10px] uppercase tracking-wide text-gray-500 mr-1">
                      {SUGGESTION_KIND_LABELS[sug.suggestion_kind]}
                    </span>
                    {sug.title}
                    {sug.suggestion_kind === 'hymn' &&
                      sug.hymnal &&
                      sug.hymn_number && (
                        <span className="text-gray-500 ml-1">
                          ({sug.hymnal} {sug.hymn_number})
                        </span>
                      )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <SmartAddModal
        open={Boolean(smartAddSuggestion)}
        onClose={() => setSmartAddSuggestion(null)}
        suggestion={smartAddSuggestion}
        bulletinId={bulletin?.id}
        serviceDate={bulletin?.service_date}
        liturgyItems={liturgyItems}
        onApplied={async () => {
          await reload();
          onItemAdded?.();
        }}
      />
    </div>
  );
}

const STATUS_BADGE = {
  pending: 'bg-amber-100 text-amber-800',
  accepted: 'bg-green-100 text-green-800',
};

function SuggestionRow({
  suggestion,
  busy,
  onAccept,
  onDecline,
  onAdd,
  onSmartAdd,
  hasLiturgyItems,
}) {
  const sug = suggestion;
  const isPending = sug.status === 'pending';
  const isAccepted = sug.status === 'accepted';
  return (
    <li className="rounded bg-white p-2 border border-amber-100">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span
              className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_BADGE[sug.status] || ''}`}
            >
              {SUGGESTION_STATUS_LABELS[sug.status]}
            </span>
            <span className="text-[11px] text-gray-500">
              {SUGGESTION_KIND_LABELS[sug.suggestion_kind]}
            </span>
            <span className="text-sm font-medium text-umc-900">
              {sug.title}
            </span>
            {sug.suggestion_kind === 'hymn' &&
              sug.hymnal &&
              sug.hymn_number && (
                <span className="text-xs text-gray-500">
                  · {sug.hymnal} {sug.hymn_number}
                </span>
              )}
          </div>
          {sug.body && (
            <p className="mt-0.5 text-xs text-gray-700 whitespace-pre-wrap">
              {sug.body}
            </p>
          )}
          {!sug.service_date && (
            <p className="mt-0.5 text-[10px] text-gray-500 italic">
              For any service
            </p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {isPending && (
            <>
              <button
                type="button"
                onClick={onAccept}
                disabled={busy}
                className="text-xs text-umc-700 hover:text-umc-900 underline disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={onDecline}
                disabled={busy}
                className="text-xs text-gray-600 hover:text-gray-800 underline disabled:opacity-50"
              >
                Decline
              </button>
            </>
          )}
          {(isAccepted || isPending) && (
            <>
              <button
                type="button"
                onClick={onAdd}
                disabled={busy}
                className="text-xs btn-primary py-0.5 px-2 disabled:opacity-50"
                title={
                  isPending
                    ? 'Accept and add as a new item at the end of the order of worship'
                    : 'Add as a new item at the end of the order of worship'
                }
              >
                {busy ? '…' : '+ Add to liturgy'}
              </button>
              {hasLiturgyItems && (
                <button
                  type="button"
                  onClick={onSmartAdd}
                  disabled={busy}
                  className="text-xs btn-secondary py-0.5 px-2 disabled:opacity-50"
                  title="Use Claude to fill an existing liturgy item with this suggestion's content"
                >
                  ✨ Smart Add
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}
