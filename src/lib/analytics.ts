'use client';

import { ANALYTICS } from '@/config/analytics';

/**
 * Event dispatch and client error reporting. Product code calls `track()` without knowing the
 * provider; calls silently do nothing when no provider is configured. No personal data is sent: event
 * names are fixed, and fields contain numbers or short labels. Uploaded filenames, images, and project
 * content never leave the device.
 */
type Data = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: { track: (name: string, data?: Data) => void };
    plausible?: (name: string, opts?: { props?: Data }) => void;
  }
}

export function track(event: string, data?: Data): void {
  if (!ANALYTICS.enabled || typeof window === 'undefined') return;
  try {
    if (ANALYTICS.provider === 'umami') window.umami?.track(event, data);
    else if (ANALYTICS.provider === 'plausible') window.plausible?.(event, data ? { props: data } : undefined);
  } catch {
    // Analytics must never crash the product.
  }
}

/*
  Error reporting uses the event channel without a separate service such as Sentry. This helps
  identify WebGL failures on unfamiliar GPUs and the browser and step involved. Rate-limit noise: one
  broken frame can emit hundreds of identical errors per second. Report each signature once, with at
  most 8 errors per session.
*/
const seen = new Set<string>();
let sent = 0;

function report(kind: string, message: string, extra?: Data): void {
  if (!ANALYTICS.enabled) return;
  const msg = String(message ?? '').slice(0, 180);
  const sig = `${kind}|${msg}`;
  if (seen.has(sig) || sent >= 8) return;
  seen.add(sig);
  sent += 1;
  track('client_error', { kind, message: msg, ...extra });
}

let installed = false;

export function installErrorReporting(): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;

  const onError = (e: ErrorEvent) => {
    report('error', e.message, {
      // Send only the filename, not the full path, to avoid exposing internal structure.
      file: (e.filename ?? '').split('/').pop() ?? '',
      line: e.lineno ?? 0,
    });
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: string } | string | undefined;
    report('unhandled_rejection', typeof r === 'string' ? r : (r?.message ?? 'unknown'));
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    installed = false;
  };
}

/** WebGL context loss: a particularly costly silent failure in a 3D app. */
export function reportContextLost(where: string): void {
  report('webgl_context_lost', where);
}
