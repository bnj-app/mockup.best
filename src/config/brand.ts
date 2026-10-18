/**
 * Single source for product name and brand constants; rename only here. The display name changed
 * from "Mockuptop" to "mockup.best". Design decision: the name equals the address and stays
 * lowercase in prose, even at sentence starts; uppercase is only for wordmark. "Mockuptop" remains
 * internal in folders, localStorage keys (mockuptop:*; changing these would lose saved projects),
 * console labels, and window.__mockuptop.
 */
export const BRAND = {
  name: 'mockup.best',
  wordmark: 'MOCKUP.BEST',
  tagline: 'Turn product screens into premium visuals',
  domain: 'mockup.best',
  /** Download filename prefix (mockup-best-1290x2796.png), avoiding a dot that could look like an extension. */
  fileSlug: 'mockup-best',
  /**
   * Production root URL for canonical, og:url, and sitemap. Change only here when the domain
   * changes or mockup.best DNS connects.
   */
  siteUrl: 'https://mockup.best',
  /** Social sharing card. */
  ogImage: '/og.jpg',
} as const;

/** Free-plan capture allowance. */
export const FREE_CAPTURES = 3;

/**
 * ⭐ Everything free: design decision, until further notice. One switch: true removes Pro
 * restrictions, allowing unlimited captures, watermark-free output, all export presets, and PHOTO
 * 4K, while hiding UPGRADE and the capture counter. Why a constant instead of localStorage:
 * build-time values produce identical server/client first frames, avoiding React #418 hydration
 * mismatches. Initial store state must not read localStorage; constants are safe. To revert, set
 * false. Paywall wiring (Stripe integration point, trial, consumeCapture, UpgradeModal, /photo/pro)
 * remains in place and returns when the constant is disabled.
 */
// Explicit boolean type: a true literal lets TypeScript narrow the other branch
// as dead code, leaving it unchecked when the constant is later toggled.
// This way both branches pass through the compiler.
export const FREE_FOR_ALL: boolean = true;
