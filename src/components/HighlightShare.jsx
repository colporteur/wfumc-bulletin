import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, withTimeout } from '../lib/supabase';

// Worshipper-facing highlight + share. When a worshipper selects any
// text inside the bulletin body, a small floating button appears near
// the selection. Clicking it opens a modal that lets them send the
// snippet to the social media team with optional commentary.
//
// Uses native browser text selection — no special markup needed
// throughout the bulletin. We do walk up the DOM to detect a
// `data-source-label` hint on a parent element, so the social media
// team sees "From the sermon" / "Hymn 314, vs 2" etc. instead of
// having to guess.
//
// Submissions go into the same `responses` table as prompt responses,
// distinguished by `highlighted_text` being non-null.
export default function HighlightShare({ bulletinId }) {
  const [selectedText, setSelectedText] = useState('');
  const [sourceLabel, setSourceLabel] = useState(null);
  const [pos, setPos] = useState(null); // { top, left } in viewport
  const [open, setOpen] = useState(false);
  // Snapshot the selection at the moment the user clicks the floating
  // button — opening the modal blurs the page and clears the selection.
  const snapshotRef = useRef({ text: '', label: null });

  // ----- Selection tracking -----
  const updateFromSelection = useCallback(() => {
    if (open) return; // don't move the button while modal is up
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelectedText('');
      setPos(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text || text.length < 4) {
      // Ignore trivially-short selections (caret blips, single words
      // probably accidental).
      setSelectedText('');
      setPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    // Skip selections inside form fields or our own modal.
    const container = range.commonAncestorContainer;
    const el =
      container.nodeType === 1 ? container : container.parentElement;
    if (!el) return;
    if (
      el.closest('input, textarea, select, [contenteditable="true"]')
    ) {
      setSelectedText('');
      setPos(null);
      return;
    }
    if (el.closest('[data-highlight-share-ui]')) {
      // Selection inside our own modal — ignore.
      return;
    }
    // Only act on selections inside the bulletin body wrapper. If
    // there isn't one in scope, do nothing (the component is mounted
    // alongside the bulletin so this should always succeed).
    if (!el.closest('[data-bulletin-body]')) {
      setSelectedText('');
      setPos(null);
      return;
    }
    // Find a source label hint by walking up looking for a
    // `data-source-label` attribute. Falls back to the closest
    // section's id (turned into a Title-Case label).
    let label = null;
    let walker = el;
    while (walker && walker !== document.body) {
      if (walker.dataset?.sourceLabel) {
        label = walker.dataset.sourceLabel;
        break;
      }
      if (walker.tagName === 'SECTION' && walker.id) {
        label =
          walker.id.charAt(0).toUpperCase() + walker.id.slice(1);
        break;
      }
      walker = walker.parentElement;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    setSelectedText(text);
    setSourceLabel(label);
    // Position the button just above the selection's top-right corner;
    // if there's no room above, place it just below.
    const buttonHeight = 36;
    const margin = 8;
    let top = rect.top - buttonHeight - margin;
    if (top < 8) top = rect.bottom + margin;
    let left = rect.left + rect.width / 2 - 90; // approx half button width
    if (left < 8) left = 8;
    if (left + 200 > window.innerWidth) left = window.innerWidth - 200;
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    const handler = () => updateFromSelection();
    document.addEventListener('selectionchange', handler);
    window.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', handler);
    return () => {
      document.removeEventListener('selectionchange', handler);
      window.removeEventListener('scroll', handler);
      window.removeEventListener('resize', handler);
    };
  }, [updateFromSelection]);

  // ----- Modal -----
  const openModal = () => {
    snapshotRef.current = {
      text: selectedText,
      label: sourceLabel,
    };
    setOpen(true);
  };

  const closeModal = () => {
    setOpen(false);
    setSelectedText('');
    setPos(null);
    // Clear any lingering selection so the floating button doesn't
    // pop right back up.
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      /* noop */
    }
  };

  return (
    <>
      {/* Floating button — only when there's a selection AND no modal. */}
      {pos && selectedText && !open && (
        <button
          type="button"
          data-highlight-share-ui
          onMouseDown={(e) => e.preventDefault() /* keep selection alive */}
          onClick={openModal}
          className="no-print fixed z-30 px-3 py-1.5 text-xs rounded-full bg-umc-900 text-white shadow-lg hover:bg-umc-800 transition-colors flex items-center gap-1"
          style={{ top: pos.top, left: pos.left }}
        >
          ✨ Share with social media
        </button>
      )}

      {open && (
        <HighlightModal
          bulletinId={bulletinId}
          highlightedText={snapshotRef.current.text}
          sourceLabel={snapshotRef.current.label}
          onClose={closeModal}
        />
      )}
    </>
  );
}

function HighlightModal({
  bulletinId,
  highlightedText,
  sourceLabel,
  onClose,
}) {
  const [commentary, setCommentary] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { error: insErr } = await withTimeout(
        supabase.from('responses').insert({
          bulletin_id: bulletinId,
          is_anonymous: isAnonymous,
          submitter_name: isAnonymous ? null : name.trim() || null,
          response_text: commentary.trim() || null,
          highlighted_text: highlightedText,
          source_label: sourceLabel || null,
        })
      );
      if (insErr) throw insErr;
      setSubmitted(true);
    } catch (e2) {
      setError(e2.message || String(e2));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-highlight-share-ui
      className="no-print fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center p-2 sm:p-4"
      onClick={(e) => {
        // Click outside the panel closes it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 sm:p-6">
          {submitted ? (
            <div className="text-center space-y-3 py-4">
              <p className="text-2xl">✨</p>
              <p className="text-base text-umc-900">
                Sent to the social media team. Thank you!
              </p>
              <button
                type="button"
                onClick={onClose}
                className="btn-primary"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-serif text-lg text-umc-900">
                    Share with social media
                  </h2>
                  {sourceLabel && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      From: {sourceLabel}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div className="border-l-4 border-umc-300 bg-umc-50/50 pl-3 py-2 italic text-sm text-gray-800">
                "{highlightedText}"
              </div>

              <div>
                <label className="label">
                  Add a thought (optional)
                </label>
                <textarea
                  className="input min-h-[80px]"
                  value={commentary}
                  onChange={(e) => setCommentary(e.target.value)}
                  placeholder="Why did this stand out to you?"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAnonymous}
                  onChange={(e) => setIsAnonymous(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-umc-700"
                />
                <span className="text-sm text-gray-700">
                  Submit anonymously
                </span>
              </label>

              <div>
                <label className="label">Your name (optional)</label>
                <input
                  type="text"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isAnonymous}
                  placeholder={
                    isAnonymous ? 'Anonymous' : 'e.g., Jane Smith'
                  }
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {error}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary disabled:opacity-50"
                >
                  {submitting ? 'Sending…' : 'Send'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
