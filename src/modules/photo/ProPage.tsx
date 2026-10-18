'use client';

import { useState } from 'react';
import { TopBar } from '@photo/components/TopBar';
import { LoginModal } from '@photo/components/LoginModal';
import { FREE_FOR_ALL } from '@/config/brand';

/** Comparison table with measured dimensions. */
const ROWS: [string, boolean, boolean][] = [
  ['Unlimited Exports', true, true],
  ['Auto Status Bar', true, true],
  ['All Devices & Hands', false, true],
  ['High Resolution (2x)', false, true],
  ['Custom Backgrounds', false, true],
  ['Emojis & Patterns', false, true],
  ['App Branding', false, true],
  ['Full Customization', false, true],
];

const PLANS = [
  { id: 'monthly', label: 'Monthly', price: '$5 / mo' },
  { id: 'yearly', label: 'Yearly', price: '$25 / yr' },
  { id: 'lifetime', label: 'Lifetime', price: '$50' },
] as const;

function Tick({ on }: { on: boolean }) {
  return on ? (
    // English labels match the page language for screen readers.
    <span style={{ color: '#22a06b' }} role="img" aria-label="included">
      ✓
    </span>
  ) : (
    <span style={{ color: '#e5484d' }} role="img" aria-label="not included">
      ✕
    </span>
  );
}

/**
 * EVERYTHING IS FREE version (brand.ts FREE_FOR_ALL).

 * Keep the route: its menu link is hidden, but old/external links and link
 * probes still open it. Explain availability without selling anything;
 * retaining pricing would advertise a plan that does not exist.
 */
function FreeForAllPage() {
  return (
    <div className="photo-root h-dvh flex flex-col overflow-hidden">
      <TopBar />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[480px] px-6 pb-24 pt-10">
          <h1 className="text-center text-3xl font-bold tracking-tight">Everything is free</h1>
          <p className="mt-2 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
            No plans, no limits, no sign-up. Every feature below is unlocked for everyone.
          </p>

          <div
            className="mt-8 overflow-hidden"
            style={{ background: 'var(--card)', border: '1px solid rgba(var(--ink),.1)', borderRadius: 14 }}
          >
            {ROWS.map(([label]) => (
              <div
                key={label}
                className="flex items-center justify-between px-4 py-3 text-sm"
                style={{ borderTop: '1px solid rgba(var(--ink),.08)' }}
              >
                <span>{label}</span>
                <Tick on />
              </div>
            ))}
          </div>

          {/*
            ⚠️ Use a plain anchor instead of next/link. Link prefetches an RSC payload
            absent from static exports (/photo/__next.photo.__PAGE__.txt), causing a
            console 404; the mode switch uses anchors for the same reason.
            A trailing slash is required: trailingSlash does not rewrite plain anchors,
            and /photo would add an unnecessary 301.
          */}
          <a
            href="/photo/"
            className="mt-4 flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold"
            style={{ background: 'var(--foreground)', color: '#fff' }}
          >
            Back to the editor
          </a>
        </div>
      </div>
    </div>
  );
}

export default function PhotoProPage() {
  if (FREE_FOR_ALL) return <FreeForAllPage />;
  return <PaidPlansPage />;
}

function PaidPlansPage() {
  const [plan, setPlan] = useState<string>('yearly');
  // "Get PRO <plan>" opens the same "Get Started" sign-in modal;
  // purchasing is available after sign-in.
  const [login, setLogin] = useState(false);
  const current = PLANS.find((p) => p.id === plan)!;

  return (
    <div className="photo-root h-dvh flex flex-col overflow-hidden">
      <TopBar />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[480px] px-6 pb-24 pt-10">
          <h1 className="text-center text-3xl font-bold tracking-tight">Get PRO</h1>
          <p className="mt-2 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Free forever. PRO is for the full experience.
          </p>

          <div
            className="mt-8 overflow-hidden"
            style={{ background: 'var(--card)', border: '1px solid rgba(var(--ink),.1)', borderRadius: 14 }}
          >
            <div
              className="grid grid-cols-[1fr_64px_64px] items-center px-4 py-3 text-xs font-medium uppercase tracking-[0.6px]"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <span />
              <span className="text-center">Free</span>
              <span className="text-center" style={{ color: 'var(--foreground)' }}>
                Pro
              </span>
            </div>
            {ROWS.map(([label, free, pro]) => (
              <div
                key={label}
                className="grid grid-cols-[1fr_64px_64px] items-center px-4 py-3 text-sm"
                style={{ borderTop: '1px solid rgba(var(--ink),.08)' }}
              >
                <span>{label}</span>
                <span className="text-center">
                  <Tick on={free} />
                </span>
                <span className="text-center">
                  <Tick on={pro} />
                </span>
              </div>
            ))}
          </div>

          <div
            className="mt-4 grid grid-cols-3 gap-2 p-2"
            style={{ background: 'var(--card)', border: '1px solid rgba(var(--ink),.1)', borderRadius: 14 }}
          >
            {PLANS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlan(p.id)}
                className="flex flex-col items-center gap-1 rounded-lg py-3 cursor-pointer transition-colors"
                style={{
                  background: plan === p.id ? 'var(--card)' : 'transparent',
                  border: `1px solid ${plan === p.id ? 'rgba(var(--ink),.16)' : 'transparent'}`,
                }}
              >
                <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  {p.label}
                </span>
                <span className="text-base font-semibold">{p.price}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setLogin(true)}
            className="mt-4 h-11 w-full rounded-xl text-sm font-semibold cursor-pointer"
            style={{ background: 'var(--foreground)', color: '#fff' }}
          >
            Get PRO {current.label}
          </button>

          <LoginModal open={login} onClose={() => setLogin(false)} />
        </div>
      </div>
    </div>
  );
}
