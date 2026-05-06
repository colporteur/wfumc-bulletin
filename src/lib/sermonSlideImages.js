// Slide-deck-image helpers used by the bulletin app's read-only views.
// Mirrors the (richer) helper in the Sermons app — the bulletin app
// only needs to fetch + render, never upload or delete.

import { supabase } from './supabase';

export const SLIDE_DECK_BUCKET = 'sermon-slide-decks';

export function publicSlideImageUrl(path) {
  if (!path) return null;
  return supabase.storage
    .from(SLIDE_DECK_BUCKET)
    .getPublicUrl(path).data.publicUrl;
}

// Fetch slide images for a sermon. RLS allows public-read for sermons
// linked to a published bulletin OR with preachings.is_at_our_church,
// so this works for anonymous worshipper views too.
export async function fetchSlideImagesForSermon(sermonId) {
  if (!sermonId) return [];
  const { data, error } = await supabase
    .from('sermon_slide_images')
    .select('id, sort_order, image_path, matched_marker_number, matched_marker_description')
    .eq('sermon_id', sermonId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    // Non-fatal — the manuscript still renders without images.
    // eslint-disable-next-line no-console
    console.warn('Failed to fetch slide images for sermon', sermonId, error);
    return [];
  }
  return data ?? [];
}
