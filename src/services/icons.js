// src/services/icons.js — the one set of icons used to mark a group.
//
// Workspaces could already carry an icon; projects and segments could only
// carry a colour, so a sidebar of eight projects was eight coloured dots. An
// icon is what makes a group recognisable at a glance.
//
// A deliberately small, monochrome set: they sit next to text at 14–17px, take
// the surrounding colour, and render identically on every platform (an emoji
// does not). Picking from a list also keeps a non-technical user out of a
// free-text box they could put anything into.

export const GROUP_ICONS = [
  '◆', '◉', '◈', '▲', '■', '★', '✦', '✿',
  '☀', '☂', '⚡', '✈', '⚑', '☎', '✎', '⌘',
  '♠', '♥', '⬟', '⬢', '◐', '◑', '⟡', '✱',
];

/** The one used when nothing has been chosen. */
export const DEFAULT_GROUP_ICON = '◆';

/** Only an icon from the set is allowed through — never arbitrary text. */
export function normalizeIcon(icon, fallback = DEFAULT_GROUP_ICON) {
  const value = String(icon ?? '').trim();
  return GROUP_ICONS.includes(value) ? value : fallback;
}

/**
 * The icon to show for a thing, falling back sensibly:
 * its own icon → its parent's → the default.
 */
export function iconFor(entity, parent = null) {
  const own = String(entity?.icon ?? '').trim();
  if (GROUP_ICONS.includes(own)) return own;
  const inherited = String(parent?.icon ?? '').trim();
  if (GROUP_ICONS.includes(inherited)) return inherited;
  return DEFAULT_GROUP_ICON;
}

/**
 * A stable icon for something that has never been given one, so a list of
 * projects is still visually distinguishable before anybody customises it.
 * Same id always gets the same icon.
 */
export function suggestIcon(id) {
  const key = String(id ?? '');
  if (!key) return DEFAULT_GROUP_ICON;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return GROUP_ICONS[hash % GROUP_ICONS.length];
}
