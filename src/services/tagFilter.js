// src/services/tagFilter.js — filtering by a tag, on every page that can.
//
// Pure: arrays and strings in, arrays and strings out. No React, no Firestore.
//
// A saved view stores `tagFilter` and the router passes it to every page as
// `initialTagFilter`. Board and Calendar honoured it; Gantt and the Activity
// Log declared no such prop, so a view saved with #client showed everything
// while the sidebar tooltip still advertised the tag (BUG-018). The prop
// contract was one-sided, and nothing fails when a prop is simply unused —
// which is why the rule lives here now, with one guard holding every page to it.
//
// The Activity Log is the reason this is not a one-liner: an activity carries
// no tags of its own. It inherits them from the task it was logged against, so
// filtering the log by #client means "entries against tasks tagged #client".

/**
 * The tags an item is filtered by.
 *
 * A task carries its own. An activity borrows its task's — pass `taskById` and
 * the activity's `taskId` is looked up. An activity whose task is gone (or has
 * scrolled out of the loaded page) has no tags and is filtered out, which is
 * the safe answer: better to show less than to show a #client entry to somebody
 * filtering for something else.
 */
export function tagsOf(item, { taskById } = {}) {
  if (!item) return [];
  if (Array.isArray(item.tags)) return item.tags;
  if (item.taskId && taskById) return taskById[item.taskId]?.tags || [];
  return [];
}

/** `items` carrying `tag`. A falsy tag filters nothing — it is "All". */
export function filterByTag(items = [], tag, ctx = {}) {
  if (!tag) return items;
  return items.filter((item) => tagsOf(item, ctx).includes(tag));
}

/**
 * Every tag present in `items`, sorted, for the chip strip.
 *
 * Sorted so the strip does not reshuffle when a task is edited, and de-duped
 * because two tasks sharing a tag is the normal case.
 */
export function availableTags(items = [], ctx = {}) {
  const set = new Set();
  for (const item of items) for (const tag of tagsOf(item, ctx)) if (tag) set.add(tag);
  return [...set].sort();
}

/**
 * The chip strip's state, in one call: which tags to offer, whether the current
 * filter is one of them, and what the page is actually showing.
 *
 * `missing` is true when the filter names a tag nothing on this page carries —
 * a saved view pointing at a tag since renamed, or a project filter that
 * excludes every tagged task. The page still shows the chip (so the filter is
 * visible and clearable) rather than silently showing an empty screen.
 */
export function tagFilterState(items = [], tag, ctx = {}) {
  const tags = availableTags(items, ctx);
  const active = tag || null;
  return {
    tags,
    active,
    missing: !!active && !tags.includes(active),
    filtered: filterByTag(items, active, ctx),
  };
}
