'use client';

import { useEffect, useState } from 'react';

/**
 * Single-line notification strip for timely feedback: show "Ideal media 1206×2622" when a device is
 * selected, plus contextual one-time tips. Permanent panel text would miss the moment when users
 * need this guidance. Usage: window.dispatchEvent(new CustomEvent('mockuptop:toast', { detail: {
 * message } })). One queue; new messages replace old ones.
 */
export function Toast() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      if (!detail?.message) return;
      setMsg(detail.message);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMsg(null), 3200);
    };
    window.addEventListener('mockuptop:toast', onToast);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mockuptop:toast', onToast);
    };
  }, []);

  if (!msg) return null;
  return (
    <div
      /*
        role="status" implies polite aria-live. Toasts sometimes provide the only guidance ("Move
        the playhead inside the scene first"), which screen-reader users previously missed. Use
        status rather than alert because this information is not urgent enough to interrupt speech.
      */
      role="status"
      className="mp-label pointer-events-none fixed left-1/2 z-[900] -translate-x-1/2 px-3.5 py-2"
      style={{
        bottom: 24,
        background: 'var(--mp-dropdown)',
        border: '1px solid var(--mp-border)',
        borderRadius: 'var(--mp-radius)',
        boxShadow: 'var(--mp-shadow-dropdown)',
        color: 'var(--mp-text-primary)',
      }}
    >
      {msg}
    </div>
  );
}

/** Shortcut to show a toast from anywhere. */
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent('mockuptop:toast', { detail: { message } }));
}

/** One-time tip: never show the same key again. */
export function tipOnce(key: string, message: string) {
  try {
    const k = `mockuptop:tip:${key}`;
    if (window.localStorage.getItem(k)) return;
    window.localStorage.setItem(k, '1');
  } catch {
    // Without storage, show the tip each time; harmless.
  }
  toast(message);
}
