'use client';

import { useEffect } from 'react';
import { BRAND, FREE_CAPTURES, FREE_FOR_ALL } from '@/config/brand';

/**
 * Pro introduction modal.
 *
 * Payments are not connected yet (Stripe is separate work), but UPGRADE
 * should explain Pro and respond to clicks. Show a CSS product scene first,
 * followed by a clear feature list. Only the CTA changes when payments launch.
 */
const PRO_FEATURES = [
  'Unlimited image captures',
  'Video export (MP4 / WebM, up to 60 fps)',
  'No watermark on exports',
  '4K & 1440P export sizes + custom size',
  'All devices — Phone Max, Tablet, Laptop 16", Display',
  'Batch export — every App Store size in one click',
];

export function UpgradeModal({ onClose }: { onClose: () => void }) {
  /*
    Close on Escape, like the other modals, emoji picker, and menus.
    Without this, keyboard users had to reach for the mouse.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[950] grid place-items-center"
      style={{ background: 'rgba(10,10,14,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        // A role supports screen readers and lets outer Escape handlers detect this layer.
        role="dialog"
        aria-modal="true"
        aria-label={`${BRAND.name} PRO`}
        className="w-[380px] overflow-hidden"
        style={{
          background: 'var(--mp-dropdown)',
          border: '1px solid var(--mp-border)',
          borderRadius: 'var(--mp-radius-lg)',
          boxShadow: 'var(--mp-shadow-dropdown)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Product preview: a code-generated mini scene without image assets. */}
        <div
          className="relative grid h-36 place-items-center"
          style={{
            background:
              'linear-gradient(135deg, #b9c6dd 0%, #8fa3c4 45%, #5b6b8c 100%)',
          }}
        >
          <div
            className="h-24 w-12 rotate-[14deg]"
            style={{
              borderRadius: 10,
              background: 'linear-gradient(160deg, rgba(255,255,255,0.9), rgba(255,255,255,0.25))',
              border: '1px solid rgba(255,255,255,0.75)',
              boxShadow: '0 14px 30px rgba(20,26,40,0.45), inset 0 0 12px rgba(255,255,255,0.35)',
            }}
          />
          <span
            className="mp-mono absolute bottom-2 right-3 text-[10px] font-bold tracking-[0.18em]"
            style={{ color: 'rgba(255,255,255,0.85)' }}
          >
            {BRAND.wordmark}{FREE_FOR_ALL ? ' — FREE' : ' PRO'}
          </span>
        </div>

        <div className="flex flex-col gap-2.5 p-4">
          <span className="mp-label" style={{ color: 'var(--mp-text-primary)', fontSize: 12 }}>
            {FREE_FOR_ALL ? 'Everything below is free — no plan, no sign-up' : 'Everything in Free — plus'}
          </span>
          <ul className="flex flex-col gap-1.5">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="mp-label flex items-start gap-2">
                <span style={{ color: 'var(--mp-accent)' }}>✓</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>

          {!FREE_FOR_ALL ? (
            <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }}>
              Free plan: {FREE_CAPTURES} image captures with watermark.
            </span>
          ) : null}

          {/*
            FREE_FOR_ALL hides UPGRADE, making this modal unreachable normally.
            Keep copy accurate in case a test or old link opens it, so it does
            not advertise an unavailable plan.
          */}
          {FREE_FOR_ALL ? (
            <button
              className="mp-label mt-1 w-full py-2.5"
              style={{
                borderRadius: 'var(--mp-radius)',
                background: 'var(--mp-accent)',
                color: '#fff',
                fontWeight: 600,
              }}
              onClick={onClose}
            >
              Start creating — it&apos;s all free
            </button>
          ) : null}
          <span className="mp-label text-center" style={{ color: 'var(--mp-text-tertiary)' }}>
            {FREE_FOR_ALL
              ? 'Every feature is unlocked — no card, no sign-up, no limits.'
              : 'Paid plans are not connected in this build.'}
          </span>
          <button
            className="mp-label w-full py-1.5"
            style={{ color: 'var(--mp-text-tertiary)' }}
            onClick={onClose}
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
