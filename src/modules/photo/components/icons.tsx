/**
 * Section heading icons.
 *
 * A thin-stroked 14px icon to the left of each card heading makes it feel
 * complete. Icons are defined in code rather than downloaded as a set.
 */

const P = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const Icons = {
  device: (
    <svg {...P}>
      <rect x="5" y="1.5" width="6" height="13" rx="1.6" />
      <path d="M7 3.2h2" />
    </svg>
  ),
  phone: (
    <svg {...P}>
      <rect x="4.5" y="1.5" width="7" height="13" rx="1.8" />
      <path d="M6.8 3.3h2.4" />
    </svg>
  ),
  hand: (
    <svg {...P}>
      <path d="M5 8V4.2a1 1 0 0 1 2 0V8" />
      <path d="M7 7.6V3.2a1 1 0 0 1 2 0v4.4" />
      <path d="M9 7.8V4.6a1 1 0 0 1 2 0V9" />
      <path d="M11 8.4c1.2-.4 2 .3 1.6 1.4l-1 2.6A3 3 0 0 1 8.8 14.5H8A3.6 3.6 0 0 1 4.4 11V8.6a1 1 0 0 1 2 0" />
    </svg>
  ),
  scene: (
    <svg {...P}>
      <rect x="1.6" y="3" width="12.8" height="10" rx="1.6" />
      <circle cx="5.6" cy="6.4" r="1" />
      <path d="M2.4 11.2 6 8l3 2.6 2.2-1.8 2.4 2" />
    </svg>
  ),
  preset: (
    <svg {...P}>
      <path d="M2 5h8M12.5 5H14M2 11h2M6.5 11H14" />
      <circle cx="11" cy="5" r="1.5" />
      <circle cx="5" cy="11" r="1.5" />
    </svg>
  ),
  app: (
    <svg {...P}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  ),
  background: (
    <svg {...P}>
      <path d="M8 1.6a6.4 6.4 0 1 0 0 12.8c.9 0 1.4-.6 1.4-1.3 0-.8-.7-1.2-.7-1.9 0-.6.5-1.1 1.2-1.1h1.2a2.9 2.9 0 0 0 2.9-2.9C14 3.9 11.3 1.6 8 1.6Z" />
      <circle cx="5" cy="6" r=".9" fill="currentColor" stroke="none" />
      <circle cx="8.4" cy="4.4" r=".9" fill="currentColor" stroke="none" />
    </svg>
  ),
  emojis: (
    <svg {...P}>
      <circle cx="8" cy="8" r="6.4" />
      <path d="M5.6 9.6c.6.9 1.4 1.4 2.4 1.4s1.8-.5 2.4-1.4" />
      <circle cx="6" cy="6.4" r=".7" fill="currentColor" stroke="none" />
      <circle cx="10" cy="6.4" r=".7" fill="currentColor" stroke="none" />
    </svg>
  ),
  shadow: (
    <svg {...P}>
      <path d="M8 1.8 14 5 8 8.2 2 5l6-3.2Z" />
      <path d="M2.4 8.4 8 11.4l5.6-3" />
      <path d="M2.4 11.6 8 14.6l5.6-3" />
    </svg>
  ),
  zoom: (
    <svg {...P}>
      <circle cx="7" cy="7" r="4.6" />
      <path d="m10.4 10.4 3.2 3.2M5.2 7h3.6M7 5.2v3.6" />
    </svg>
  ),
  pattern: (
    <svg {...P}>
      <rect x="2" y="2" width="4.6" height="4.6" rx="1" />
      <rect x="9.4" y="2" width="4.6" height="4.6" rx="1" />
      <rect x="2" y="9.4" width="4.6" height="4.6" rx="1" />
      <rect x="9.4" y="9.4" width="4.6" height="4.6" rx="1" />
    </svg>
  ),
  export: (
    <svg {...P}>
      <path d="M8 2v7.4M5.2 6.8 8 9.6l2.8-2.8" />
      <path d="M2.6 11.4v1.4a1.2 1.2 0 0 0 1.2 1.2h8.4a1.2 1.2 0 0 0 1.2-1.2v-1.4" />
    </svg>
  ),
};
