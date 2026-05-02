// Bulletin ↔ worship_plan sync helpers (Phase 3 auto-flow).
//
// When a bulletin is created for a service_date that has a worship_plan
// row from the Worship Planning app, those fields prefill into the
// bulletin's scripture liturgy_item and sermon row. The pastor can also
// trigger a manual "Refresh from worship plan" later if the plan changes
// after the bulletin was created.
//
// What syncs:
//   * worship_plans.scripture_reference  →  scripture liturgy_item.scripture_reference
//   * worship_plans.theme                →  sermon.theme (lazy-creates sermon if needed)
//   * worship_plans.sermon_topic         →  sermon.title (only if sermon.title is blank)
//
// What we DON'T touch:
//   * scripture_text — pastor fills this in via Claude-assist after picking the ref
//   * Any non-scripture liturgy item
//   * sermon.manuscript_text or anything else on the sermon — only the
//     metadata fields the worship plan owns.

import { supabase, withTimeout } from './supabase';

// Pull the worship_plan for a service_date. Returns null if none exists.
async function loadWorshipPlan(serviceDate) {
  const { data, error } = await withTimeout(
    supabase
      .from('worship_plans')
      .select('*')
      .eq('service_date', serviceDate)
      .maybeSingle()
  );
  if (error) {
    // worship_plans table may not exist yet on older deploys — log and skip.
    // eslint-disable-next-line no-console
    console.warn('loadWorshipPlan:', error.message);
    return null;
  }
  return data;
}

// Apply the worship_plan's data to the bulletin. Returns:
//   { applied: boolean, changes: string[] }
// where `changes` is a human-readable list of what got updated.
//
// `options.includeSermon` (default true) controls whether to lazy-create
// the sermon row to set theme + topic. The bulletin-create flow can leave
// this false to keep the create path simple; the explicit refresh button
// passes true.
//
// `options.overwrite` (default false): if true, we overwrite existing
// non-null values on the bulletin. If false, we only fill blanks.
//
// `options.userId` is required to set sermons.owner_user_id when
// lazy-creating.
export async function syncBulletinFromWorshipPlan(
  bulletinId,
  serviceDate,
  options = {}
) {
  const { includeSermon = true, overwrite = false, userId = null } = options;
  const plan = await loadWorshipPlan(serviceDate);
  if (!plan) {
    return { applied: false, changes: [], reason: 'no_plan' };
  }

  const changes = [];

  // ---- Scripture: update the bulletin's scripture liturgy_item ----
  if (plan.scripture_reference) {
    const { data: items, error: itemsErr } = await withTimeout(
      supabase
        .from('liturgy_items')
        .select('id, scripture_reference, position')
        .eq('bulletin_id', bulletinId)
        .eq('item_type', 'scripture')
        .order('position', { ascending: true })
    );
    if (itemsErr) throw itemsErr;

    if (items && items.length > 0) {
      const target = items[0];
      const shouldUpdate =
        overwrite || !target.scripture_reference?.trim();
      if (
        shouldUpdate &&
        target.scripture_reference !== plan.scripture_reference
      ) {
        const { error: updErr } = await withTimeout(
          supabase
            .from('liturgy_items')
            .update({ scripture_reference: plan.scripture_reference })
            .eq('id', target.id)
        );
        if (updErr) throw updErr;
        changes.push(`Scripture → ${plan.scripture_reference}`);
      }
    }
    // No scripture liturgy_item exists yet. We deliberately don't create
    // one — the pastor decides where it goes in the order of service. The
    // refresh button can be called again after they add a scripture item.
  }

  // ---- Sermon: lazy-create if needed, set theme + title ----
  if (
    includeSermon &&
    (plan.theme || plan.sermon_topic || plan.scripture_reference)
  ) {
    const { data: sermonItems, error: sErr } = await withTimeout(
      supabase
        .from('liturgy_items')
        .select('id, sermon_id')
        .eq('bulletin_id', bulletinId)
        .eq('item_type', 'sermon')
        .order('position', { ascending: true })
    );
    if (sErr) throw sErr;

    if (sermonItems && sermonItems.length > 0) {
      const sermonItem = sermonItems[0];
      let sermonId = sermonItem.sermon_id;

      // Lazy-create the sermon row if not yet linked.
      if (!sermonId) {
        const { data: newSermon, error: insErr } = await withTimeout(
          supabase
            .from('sermons')
            .insert({
              title: plan.sermon_topic || null,
              theme: plan.theme || null,
              scripture_reference: plan.scripture_reference || null,
              preached_at: serviceDate,
              owner_user_id: userId,
            })
            .select()
            .single()
        );
        if (insErr) throw insErr;
        sermonId = newSermon.id;
        const { error: linkErr } = await withTimeout(
          supabase
            .from('liturgy_items')
            .update({ sermon_id: sermonId })
            .eq('id', sermonItem.id)
        );
        if (linkErr) throw linkErr;
        if (plan.sermon_topic) changes.push(`Sermon title → ${plan.sermon_topic}`);
        if (plan.theme) changes.push(`Sermon theme → ${plan.theme}`);
        if (plan.scripture_reference)
          changes.push(`Sermon scripture → ${plan.scripture_reference}`);
      } else {
        // Sermon row exists. Pull current values so we know what to
        // overwrite (or skip).
        const { data: existing, error: exErr } = await withTimeout(
          supabase
            .from('sermons')
            .select('title, theme, scripture_reference')
            .eq('id', sermonId)
            .single()
        );
        if (exErr) throw exErr;
        const updates = {};
        if (
          plan.theme &&
          (overwrite || !existing.theme?.trim()) &&
          existing.theme !== plan.theme
        ) {
          updates.theme = plan.theme;
          changes.push(`Sermon theme → ${plan.theme}`);
        }
        if (
          plan.sermon_topic &&
          (overwrite || !existing.title?.trim()) &&
          existing.title !== plan.sermon_topic
        ) {
          updates.title = plan.sermon_topic;
          changes.push(`Sermon title → ${plan.sermon_topic}`);
        }
        if (
          plan.scripture_reference &&
          (overwrite || !existing.scripture_reference?.trim()) &&
          existing.scripture_reference !== plan.scripture_reference
        ) {
          updates.scripture_reference = plan.scripture_reference;
          changes.push(`Sermon scripture → ${plan.scripture_reference}`);
        }
        if (Object.keys(updates).length > 0) {
          const { error: updErr } = await withTimeout(
            supabase.from('sermons').update(updates).eq('id', sermonId)
          );
          if (updErr) throw updErr;
        }
      }
    }
  }

  return { applied: changes.length > 0, changes, plan };
}

// Lightweight check used by the bulletin-create flow — returns true if
// a worship_plan exists for the date (so we know whether to bother
// calling the sync helper).
export async function hasWorshipPlan(serviceDate) {
  const { count, error } = await withTimeout(
    supabase
      .from('worship_plans')
      .select('id', { count: 'exact', head: true })
      .eq('service_date', serviceDate)
  );
  if (error) return false;
  return (count ?? 0) > 0;
}
