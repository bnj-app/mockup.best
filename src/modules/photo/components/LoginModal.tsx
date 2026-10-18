'use client';

import { useEffect, useState } from 'react';

/**
 * Login modal: 448x405, 10px radius, #f5f5f5 background, 24px padding; "Get Started" title, "Enter
 * your email to continue." subtitle, Email field (you@example.com), light "Send Code" button, "or"
 * divider, dark "Continue with Google", close button at top right. ⚠️ No authentication backend:
 * buttons do not work, and explicitly show a coming-soon notice instead of falsely claiming a code
 * was sent. No Cloudflare verification box is included to avoid imitating third-party branding.
 * Closing must reset email and notice; doing this with setState inside an effect triggers React 19
 * cascading-render warnings, so the caller resets the component with a key (see TopBar).
 */
export function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center p-4"
      style={{ background: 'rgba(0,0,0,.35)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Get Started"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full"
        style={{ maxWidth: 448, background: '#f5f5f5', borderRadius: 10, padding: 24 }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 h-6 w-6 grid place-items-center rounded-md cursor-pointer"
          style={{ color: 'var(--muted-foreground)' }}
        >
          ✕
        </button>

        <h2 className="text-xl font-bold tracking-tight">Get Started</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Enter your email to continue.
        </p>

        <label className="mt-5 block text-sm font-medium" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-1.5 h-10 w-full rounded-md px-3 text-sm outline-none"
          style={{ background: '#fff', border: '1px solid rgba(51,51,51,.16)' }}
        />

        <button
          type="button"
          onClick={() => setNote('Accounts aren’t open yet — coming soon.')}
          className="mt-3 h-10 w-full rounded-md text-sm font-medium cursor-pointer"
          style={{ background: 'rgba(51,51,51,.06)' }}
        >
          Send Code
        </button>

        <div className="my-4 flex items-center gap-3">
          <span className="h-px flex-1" style={{ background: 'rgba(51,51,51,.12)' }} />
          <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            or
          </span>
          <span className="h-px flex-1" style={{ background: 'rgba(51,51,51,.12)' }} />
        </div>

        <button
          type="button"
          onClick={() => setNote('Accounts aren’t open yet — coming soon.')}
          className="h-10 w-full rounded-md text-sm font-semibold cursor-pointer"
          style={{ background: 'var(--foreground)', color: '#fff' }}
        >
          Continue with Google
        </button>

        {note && (
          <p className="mt-3 text-center text-xs" style={{ color: 'var(--muted-foreground)' }}>
            {note}
          </p>
        )}
      </div>
    </div>
  );
}
