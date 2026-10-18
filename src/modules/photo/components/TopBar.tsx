'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TOPBAR_H } from '@photo/config/ui';
import { usePhoto } from '@photo/store/photo';
import { LoginModal } from './LoginModal';
import { ModeSwitch } from '@/components/shell/ModeSwitch';
import { FREE_FOR_ALL } from '@/config/brand';

export function TopBar() {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [login, setLogin] = useState(false);
  const reset = usePhoto((s) => s.reset);

  // Close on Escape and outside clicks; menus share a single state.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    const onClick = () => setMenu(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, [menu]);

  return (
    <header className="shrink-0 relative z-50 w-full" style={{ height: TOPBAR_H }}>
      <div className="grid grid-cols-3 items-center h-full px-6 w-full">
        <div className="flex items-center justify-start">
          <button
            type="button"
            onClick={() => router.push('/photo')}
            className="flex items-baseline gap-1.5 cursor-pointer hover:opacity-70 transition-opacity"
          >
            <span
              className="text-xl font-extrabold tracking-tight"
              /*
                Derive the muted half from the theme token for 45% contrast in both themes; fixed
                dark gray disappeared in dark mode.
              */
              style={{ color: 'color-mix(in srgb, var(--foreground) 45%, transparent)' }}
            >
              MOCKUP
            </span>
            <span className="text-xl font-extrabold tracking-tight">TOP</span>
          </button>
        </div>

        {/*
          Place the mode switch in the empty center cell. Left/right cell dimensions remain
          unchanged, preserving layout measurements.
        */}
        <div className="flex items-center justify-center">
          <ModeSwitch variant="photo" />
        </div>

        <div className="flex items-center justify-end gap-3">
          {/*
            Design decision: temporarily hide GET PRO and LOG IN.
            Neither button had a working service: no login server or purchase flow. Showing
            "coming soon" after a click made the product feel unfinished. Restore these entries
            when payments and accounts are available. `LoginModal` and `/photo/pro` remain; only
            their entry points are removed.
          */}
          <div className="relative">
            <button
              type="button"
              aria-label="Open menu"
              onClick={(e) => {
                e.stopPropagation();
                setMenu((v) => !v);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md cursor-pointer"
              style={{ background: menu ? 'var(--muted-hover)' : 'transparent' }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <circle cx="8" cy="3" r="1.4" fill="currentColor" />
                <circle cx="8" cy="8" r="1.4" fill="currentColor" />
                <circle cx="8" cy="13" r="1.4" fill="currentColor" />
              </svg>
            </button>
            {menu && (
              <div
                // The editor's Escape guard identifies open layers by role.
                role="menu"
                aria-label="Project menu"
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 mt-2 w-44 overflow-hidden rounded-xl py-1"
                style={{ background: 'var(--card)', border: '1px solid rgba(var(--ink),.1)', boxShadow: '0 8px 24px rgba(0,0,0,.16)' }}
              >
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setMenu(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm cursor-pointer hover:bg-[rgba(var(--ink),.06)]"
                >
                  New project
                </button>
                {/*
                  Hide the pricing row while everything is free (see brand.ts FREE_FOR_ALL). The
                  page itself remains.
                */}
                {!FREE_FOR_ALL ? (
                  <Link href="/photo/pro" className="block w-full px-3 py-2 text-left text-sm hover:bg-[rgba(var(--ink),.06)]">
                    Pricing
                  </Link>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* key: reset the form on each opening. */}
      <LoginModal key={login ? 'open' : 'closed'} open={login} onClose={() => setLogin(false)} />
    </header>
  );
}
