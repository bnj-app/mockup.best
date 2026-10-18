import './globals.css';
import Link from 'next/link';
import type { Metadata } from 'next';
import { BRAND } from '@/config/brand';

/*
  Multiple root layouts ((en) and (tr), each emitting its own html lang) prevent a 404 from using a
  single layout. Next requires global-not-found for this (next.config experimental.globalNotFound).
  It must return a complete HTML document.
*/
export const metadata: Metadata = {
  title: `Page not found — ${BRAND.name}`,
  robots: { index: false, follow: true },
};

export default function GlobalNotFound() {
  return (
    <html lang="en" data-theme="light">
      <body style={{ background: 'var(--mp-page)', color: 'var(--mp-text-primary)', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ maxWidth: '60ch', margin: '0 auto', padding: '96px 24px' }}>
          <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, letterSpacing: '0.08em', color: 'var(--mp-text-tertiary)' }}>404</p>
          <h1 style={{ fontSize: 32, margin: '8px 0 16px' }}>This page does not exist.</h1>
          <p style={{ color: 'var(--mp-text-secondary)' }}>
            <Link href="/" style={{ color: 'var(--mp-accent)' }}>Home</Link> ·{' '}
            <Link href="/editor/" style={{ color: 'var(--mp-accent)' }}>Open the editor</Link>
          </p>
        </main>
      </body>
    </html>
  );
}
