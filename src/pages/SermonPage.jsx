import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, withTimeout } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ManuscriptWithSlides from '../components/ManuscriptWithSlides.jsx';
import { fetchSlideImagesForSermon } from '../lib/sermonSlideImages';

function fmtDate(yyyymmdd) {
  if (!yyyymmdd) return '';
  return new Date(yyyymmdd + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Worshipper-facing detail view for a single sermon. Visible because
// the sermon is linked to a published bulletin (RLS handles access).
export default function SermonPage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sermon, setSermon] = useState(null);
  // Bulletins (published) where this sermon was preached
  const [preachings, setPreachings] = useState([]);
  const [slideImages, setSlideImages] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [sermonRes, preachRes, slidesRes] = await Promise.all([
          withTimeout(
            supabase.from('sermons').select('*').eq('id', id).maybeSingle()
          ),
          withTimeout(
            supabase
              .from('preachings')
              .select(
                '*, bulletin:bulletins(id, service_date, sunday_designation, status)'
              )
              .eq('sermon_id', id)
              .eq('is_at_our_church', true)
              .order('preached_at', { ascending: false, nullsFirst: false })
          ),
          fetchSlideImagesForSermon(id),
        ]);
        if (sermonRes.error) throw sermonRes.error;
        if (preachRes.error) throw preachRes.error;
        if (cancelled) return;
        setSermon(sermonRes.data);
        setPreachings(preachRes.data ?? []);
        setSlideImages(slidesRes || []);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <LoadingSpinner label="Loading sermon…" />;
  if (error) {
    return (
      <div className="card text-center space-y-3">
        <p className="text-sm text-red-700">Couldn't load sermon.</p>
        <p className="text-xs text-gray-500">{error}</p>
        <Link to="/sermons" className="btn-secondary inline-block">
          ← Back to archive
        </Link>
      </div>
    );
  }
  if (!sermon) {
    return (
      <div className="card text-center space-y-3">
        <h1 className="font-serif text-xl text-umc-900">Sermon not found</h1>
        <Link to="/sermons" className="btn-secondary inline-block">
          ← Back to archive
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/sermons"
        className="no-print inline-block text-sm text-gray-500 hover:text-gray-700"
      >
        ← All sermons
      </Link>

      <div className="card space-y-3">
        <h1 className="font-serif text-2xl text-umc-900">
          {sermon.title || (
            <span className="italic text-gray-400">Untitled sermon</span>
          )}
        </h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
          {sermon.scripture_reference && (
            <span>{sermon.scripture_reference}</span>
          )}
          {sermon.theme && <span className="italic">{sermon.theme}</span>}
        </div>
        {preachings.length > 0 && (
          <div className="pt-3 border-t border-gray-100">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
              Preached at WFUMC
            </p>
            <ul className="text-sm text-gray-700 space-y-0.5">
              {preachings.map((p) => {
                const isPublishedBulletin =
                  p.bulletin && p.bulletin.status === 'published';
                return (
                  <li key={p.id}>
                    {p.preached_at ? (
                      isPublishedBulletin ? (
                        <Link
                          to={`/b/${p.preached_at}`}
                          className="text-umc-700 hover:underline"
                        >
                          {fmtDate(p.preached_at)}
                        </Link>
                      ) : (
                        <span>{fmtDate(p.preached_at)}</span>
                      )
                    ) : (
                      <span className="italic text-gray-400">
                        Date unknown
                      </span>
                    )}
                    {p.bulletin?.sunday_designation && (
                      <span className="text-gray-500 ml-2">
                        — {p.bulletin.sunday_designation}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="font-serif text-lg text-umc-900">Manuscript</h2>
        {sermon.manuscript_text ? (
          <div className="mt-3">
            <ManuscriptWithSlides
              text={sermon.manuscript_text}
              slideImages={slideImages}
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-400 italic">
            No manuscript text posted for this sermon.
          </p>
        )}
      </div>
    </div>
  );
}
