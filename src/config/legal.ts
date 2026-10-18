/**
 * Legal page links. Previously hosted under <slug>.hugosoftware.net, all three ungenerated pages
 * returned 404. A visible broken Privacy link is worse than no link. Pages now live within the site
 * and describe actual behavior: no server, accounts, or data collection.
 */
export const LEGAL = {
  /*
    Trailing slash required: trailingSlash does not rewrite plain anchors; slashless production URLs
    trigger an nginx 301 with an absolute redirect downgrading to HTTP.
  */
  privacy: '/privacy/',
  terms: '/terms/',
  /** Support links directly to email, not a separate page; the address below is authoritative. */
  support: 'mailto:support@hugosoftware.net',
} as const;

/**
 * Contact address: use support@hugosoftware.net everywhere rather than a personally named address.
 * Replaced support@mockup.best; landing, privacy, and terms pages all read this constant.
 */
export const CONTACT_EMAIL = 'support@hugosoftware.net';

/**
 * Guide: 30 topics × 11 languages at mockup.best/guide/<language>/. Separate from the app build,
 * served by an nginx container through Traefik PathPrefix(/guide). App deployment does not delete
 * the guide, and guide deployment does not rebuild the app. The menu links to English; each page
 * has hreflang for all 11 languages so search engines select the correct language.
 */
export const GUIDE_URL = '/guide/en/';

/** Last revision date for legal text; update when editing it. */
export const LEGAL_UPDATED = '15 October 2026';
