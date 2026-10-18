'use client';

import { useEffect } from 'react';
import Script from 'next/script';
import { ANALYTICS } from '@/config/analytics';
import { installErrorReporting } from '@/lib/analytics';

/**
 * Load the analytics script and install client error listeners. Empty configuration renders
 * nothing: no script downloads, requests, or cookies, preserving existing behavior when analytics
 * is disabled. afterInteractive keeps analytics from delaying first paint or WebGL initialization:
 * scene startup shapes the first impression.
 */
export function Analytics() {
  useEffect(() => installErrorReporting(), []);

  if (!ANALYTICS.enabled) return null;

  return (
    <Script
      src={ANALYTICS.src}
      strategy="afterInteractive"
      // Umami reads data-website-id, Plausible reads data-domain; supplying both
      // is harmless because each provider ignores the unrelated attribute.
      data-website-id={ANALYTICS.id}
      data-domain={ANALYTICS.id}
    />
  );
}
