import { useMemo } from 'react';
import { publicSlideImageUrl } from '../lib/sermonSlideImages';

// Render a sermon manuscript with uploaded slide images interleaved
// inline at each <SLIDE #N – Description> marker. Sibling of the same
// component in the Sermons app — kept in sync manually.
//
// Worshipper views default to missingMode='hide' (don't expose the
// raw marker syntax to congregants when an image is missing). The
// admin SermonDetail in the sermons app uses 'placeholder' so the
// pastor sees what's missing.

const SLIDE_MARKER_RE = /<SLIDE\s+#?(\d+)\s*[-–—]\s*([^>]+)>/g;

export default function ManuscriptWithSlides({
  text,
  slideImages = [],
  missingMode = 'hide',
  className = 'text-base text-gray-800 font-serif leading-relaxed',
}) {
  const segments = useMemo(() => parseSegments(text || ''), [text]);

  const imageByMarker = useMemo(() => {
    const map = new Map();
    for (const img of slideImages) {
      if (img.matched_marker_number != null) {
        if (!map.has(img.matched_marker_number)) {
          map.set(img.matched_marker_number, img);
        }
      }
    }
    return map;
  }, [slideImages]);

  if (!text || !text.trim()) return null;

  return (
    <div className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          if (!seg.text) return null;
          return (
            <div key={i} className="whitespace-pre-wrap">
              {seg.text}
            </div>
          );
        }
        const img = imageByMarker.get(seg.number);
        if (!img) {
          if (missingMode === 'hide') return null;
          if (missingMode === 'text') {
            return (
              <span key={i} className="text-red-700 font-mono text-sm">
                {seg.raw}
              </span>
            );
          }
          return (
            <div key={i} className="my-3 text-center">
              <span className="inline-block rounded border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-2 text-xs text-gray-500 italic">
                ⚠ &lt;SLIDE #{seg.number} – {seg.description}&gt; (no image
                uploaded)
              </span>
            </div>
          );
        }
        return (
          <figure key={i} className="my-4 text-center">
            <img
              src={publicSlideImageUrl(img.image_path)}
              alt={seg.description || `Slide ${seg.number}`}
              loading="lazy"
              className="mx-auto rounded shadow border border-gray-200"
              style={{ maxWidth: '100%', maxHeight: '400px' }}
            />
            <figcaption className="text-xs text-gray-500 mt-1">
              Slide #{seg.number} — {seg.description}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function parseSegments(text) {
  if (!text) return [];
  const segments = [];
  let lastIdx = 0;
  let m;
  SLIDE_MARKER_RE.lastIndex = 0;
  while ((m = SLIDE_MARKER_RE.exec(text)) !== null) {
    if (m.index > lastIdx) {
      segments.push({ type: 'text', text: text.slice(lastIdx, m.index) });
    }
    segments.push({
      type: 'slide',
      number: parseInt(m[1], 10),
      description: m[2].trim(),
      raw: m[0],
    });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIdx) });
  }
  return segments;
}
