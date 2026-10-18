'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BRAND } from '@/config/brand';
import { track } from '@/lib/analytics';

/**
 * PHONE GATE.

 * Measured over 120 days: 65% of visitors used phones, with zero phone exports.
 * The editor opens on phones, but the timeline, side panel and video export
 * need a large screen. Give visitors a clear next step: send the link to their
 * computer. "Continue on this phone" stays available, preserving the landing
 * page's promise that framing and image export work on phones.

 * Shown only below lg (where the timeline hides) on devices without hover.
 * Desktop users narrowing a window do not see it.

 * Nothing goes to a server: sharing, clipboard copying and mailto all use
 * browser-native paths.
 */

const KEY = 'mockuptop:phone-gate:v1';
const QUERY = '(max-width: 1023px) and (hover: none)';

/*
  Capture the initial URL at module load. After reading #s=... share data and
  ?start= / ?template= / ?tool= parameters, the editor removes them from the
  URL (store/project.ts, EditorApp). Reading location.href at click time
  would send a link that opens an empty editor on the computer.
*/
const INITIAL_URL = typeof window === 'undefined' ? '' : window.location.href;

/** Narrow touchscreen, such as a phone/tablet? The tour uses the same check. */
export function isPhoneLike(): boolean {
  try {
    return window.matchMedia(QUERY).matches;
  } catch {
    return false;
  }
}

function PhoneGateCard({ onContinue }: { onContinue: () => void }) {
  const url = INITIAL_URL || window.location.href;
  const canShare = typeof navigator.share === 'function';
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      track('phone_gate', { step: 'copy' });
    } catch {
      // If clipboard permission is denied, the link below can be selected manually.
      setCopied(false);
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: BRAND.name, text: `Open ${BRAND.name} on my computer`, url });
      track('phone_gate', { step: 'share' });
    } catch {
      // The user dismissed the share sheet; this is not an error.
    }
  };

  const mailto = `mailto:?subject=${encodeURIComponent(`Open ${BRAND.name} on my computer`)}&body=${encodeURIComponent(url)}`;
  const shown = url.replace(/^https?:\/\//, '');

  const btn: React.CSSProperties = { borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface-active)' };
  const primary: React.CSSProperties = { borderRadius: 'var(--mp-radius)', background: 'var(--mp-accent)', color: '#fff', fontWeight: 600 };

  return (
    <div
      /*
        Use flex, not grid: a single auto grid column treated the 420px card width
        as its minimum and pushed the card offscreen on a 390px phone.
      */
      className="fixed inset-0 z-[970] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,10,14,0.55)', backdropFilter: 'blur(4px)' }}
      data-phone-gate
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-gate-title"
        className="flex w-full max-w-[420px] min-w-0 flex-col gap-3 p-5"
        style={{
          background: 'var(--mp-dropdown)',
          border: '1px solid var(--mp-border)',
          borderRadius: 'var(--mp-radius-lg)',
          boxShadow: 'var(--mp-shadow-dropdown)',
        }}
        // The portal is in body, but React events bubble to the editor's main (see GoalPackModal).
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => e.stopPropagation()}
        onDrop={(e) => e.stopPropagation()}
      >
        <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
          On a phone?
        </span>
        <span id="phone-gate-title" className="mp-label" style={{ color: 'var(--mp-text-primary)', fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>
          {BRAND.name} works best on a computer
        </span>
        <span className="mp-label" style={{ color: 'var(--mp-text-secondary)', lineHeight: 1.55 }}>
          The timeline, side panels and video export need a bigger screen. Send yourself this link and open it on your
          computer — no install, no account.
        </span>

        <span
          className="mp-mono truncate px-2.5 py-2 text-[11px]"
          style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface)', border: '1px solid var(--mp-border)', color: 'var(--mp-text-secondary)' }}
          title={url}
        >
          {shown}
        </span>

        <div className="flex flex-col gap-1.5 pt-1">
          {canShare ? (
            <button className="mp-label w-full py-3" style={primary} onClick={share} data-phone-gate-share>
              Send link to my computer
            </button>
          ) : null}
          <div className="flex gap-1.5">
            <button
              className="mp-label flex-1 py-2.5"
              style={canShare ? btn : primary}
              onClick={copy}
              data-phone-gate-copy
            >
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
            <a
              className="mp-label flex-1 py-2.5 text-center"
              style={btn}
              href={mailto}
              onClick={() => track('phone_gate', { step: 'email' })}
            >
              Email it to me
            </a>
          </div>
        </div>

        <button
          className="mp-label self-center px-2 py-2"
          style={{ color: 'var(--mp-text-tertiary)', textDecoration: 'underline', textUnderlineOffset: 3 }}
          onClick={onContinue}
          data-phone-gate-continue
        >
          Continue on this phone
        </button>
      </div>
    </div>
  );
}

export function PhoneGate() {
  /*
    HYDRATION: omit the gate on the server and first client frame. Decide after
    mount using matchMedia and localStorage to avoid React #418.
  */
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isPhoneLike()) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(KEY) === 'continue';
    } catch {
      // Without storage, show on every visit; Continue is still one tap.
    }
    if (dismissed) return;
    // Defer to a microtask: synchronous setState in the effect body triggers lint.
    const t = window.setTimeout(() => {
      setOpen(true);
      track('phone_gate', { step: 'shown' });
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  if (!open) return null;
  return createPortal(
    <PhoneGateCard
      onContinue={() => {
        setOpen(false);
        track('phone_gate', { step: 'continue' });
        try {
          window.localStorage.setItem(KEY, 'continue');
        } catch {
          // If saving fails, ask again on the next visit; acceptable.
        }
      }}
    />,
    document.body,
  );
}
