/**
 * ANALYTICS CONFIGURATION.
 * Keep the provider configurable: account creation and keys are set up separately; the code
 * difference is one script tag. With this empty, analytics stays silent: no requests and no
 * cookies. Filling it in enables analytics automatically.
 * Enable via `app/.env.local`, embedded at build time:
 *
 * Umami (self-hosted, cookieless, GDPR/KVKK-friendly; recommended):
 * NEXT_PUBLIC_ANALYTICS=umami
 * NEXT_PUBLIC_ANALYTICS_SRC=https://umami.bnj.app/script.js
 * NEXT_PUBLIC_ANALYTICS_ID=<website-id>
 *
 * Plausible:
 * NEXT_PUBLIC_ANALYTICS=plausible
 * NEXT_PUBLIC_ANALYTICS_SRC=https://plausible.io/js/script.js
 * NEXT_PUBLIC_ANALYTICS_ID=mockup.best
 *
 * Self-hosting Umami on an existing VPS allows measurement without sending data to a third party.
 */
export type AnalyticsProvider = 'umami' | 'plausible' | 'none';

const provider = (process.env.NEXT_PUBLIC_ANALYTICS ?? 'none') as AnalyticsProvider;
const src = process.env.NEXT_PUBLIC_ANALYTICS_SRC ?? '';
const id = process.env.NEXT_PUBLIC_ANALYTICS_ID ?? '';

export const ANALYTICS = {
  provider,
  src,
  id,
  /** Load nothing unless all three values are set. */
  enabled: provider !== 'none' && src.length > 0 && id.length > 0,
} as const;
