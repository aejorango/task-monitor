// src/components/Icon.jsx — small set of inline SVG icons matching the
// Linear-inspired theme. Stroke-based, 24x24 viewBox, inherits color from
// `currentColor` so they pick up the surrounding text color.
//
// Usage: <Icon name="clock" size={18} />

const PATHS = {
  // Time / clock — used for "Hours today"
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  // Calendar / due date — used for "Due today"
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 3v4M16 3v4" />
    </>
  ),
  // Alert circle — used for "Overdue"
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <circle cx="12" cy="16" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  // Check circle — used for "Done this week"
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </>
  ),
  // Play circle — used for "In progress"
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l5.5 3.5L10 15.5z" fill="currentColor" stroke="none" />
    </>
  ),
  // Sparkles — used for AI actions
  sparkles: (
    <>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />
    </>
  ),
  // Warning triangle — used for bottleneck rows
  warning: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  // Lightning / spark — alternative for AI / "ready" state
  bolt: (
    <path d="M13 3L4 14h7l-1 7 9-11h-7z" fill="currentColor" stroke="none" />
  ),
};

export default function Icon({ name, size = 18, className = '', strokeWidth = 1.7, style }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}
