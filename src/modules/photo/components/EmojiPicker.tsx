'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { searchEmojis } from '@photo/config/emoji-data';

/**
 * Emoji picker. The "+" button has aria-label "Add custom emoji". The panel above it has a 14px
 * radius, #f5f5f5 background, a "Search emojis..." input, nine category headings and 28px emoji
 * buttons. Clicking an emoji keeps the panel open, appends it to the row and marks it selected.
 * Search starts empty on each opening. Calling setQ('') in an effect causes a cascading-render
 * warning in React 19; the caller resets the component with key instead (see RightPanel).
 */
export function EmojiPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
}) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const cats = useMemo(() => searchEmojis(q), [q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Do not use the capture phase: let the "+" button's own click run first.
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      // The role is required: the editor's Escape guard identifies open layers by role.
      // Without it, Escape both closed the panel and opened "Discard changes?".
      role="dialog"
      aria-label="Emoji picker"
      className="absolute right-0 z-50 overflow-hidden"
      // Open upward and align to the right edge
      // to avoid overflowing the card.
      style={{
        bottom: 'calc(100% + 8px)',
        width: 272,
        borderRadius: 14,
        background: '#f5f5f5',
        border: '1px solid rgba(var(--ink),.12)',
        boxShadow: '0 12px 32px rgba(0,0,0,.18)',
      }}
    >
      <div className="p-2" style={{ borderBottom: '1px solid rgba(var(--ink),.08)' }}>
        <div className="flex items-center gap-2 rounded-md px-2" style={{ background: '#fff', height: 32 }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <circle cx="7" cy="7" r="4.6" />
            <path d="m10.4 10.4 3.2 3.2" />
          </svg>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search emojis..."
            className="h-8 w-full bg-transparent text-sm outline-none"
          />
        </div>
      </div>

      <div className="max-h-[260px] overflow-y-auto px-2 pb-2">
        {cats.map((k) => (
          <div key={k.id}>
            <p className="px-1 pt-2 pb-1 text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
              {k.label}
            </p>
            <div className="flex flex-wrap">
              {k.items.map((it) => (
                <button
                  key={k.id + it.e}
                  type="button"
                  aria-label={it.n}
                  title={it.n}
                  onClick={() => onPick(it.e)}
                  className="grid place-items-center rounded-md hover:bg-[rgba(var(--ink),.08)] cursor-pointer"
                  style={{ width: 28, height: 28, fontSize: 17, lineHeight: 1 }}
                >
                  {it.e}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!cats.length && (
          <p className="py-6 text-center text-xs" style={{ color: 'var(--muted-foreground)' }}>
            No results
          </p>
        )}
      </div>
    </div>
  );
}
