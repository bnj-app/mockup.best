'use client';

import { useState, useSyncExternalStore } from 'react';

/**
 * COLOR INPUT: swatch, editable HEX and eyedropper.
 * A lone `<input type="color">` prevented typing or pasting brand colors and required the system
 * picker to sample a screen color. The HEX field also accepts rgb()/hsl() and three-digit
 * shorthand through the browser parser, leaving invalid input unchanged. EyeDropper uses the
 * Chromium API and is hidden in unsupported browsers.
 */
export function ColorInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (hex: string) => void;
  /** Screen-reader label. */
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Hydration: server and first client frame both use false; read the actual value afterward.
  const hasDropper = useSyncExternalStore(
    () => () => {},
    () => 'EyeDropper' in window,
    () => false,
  );

  const commit = (raw: string) => {
    const hex = toHex(raw.trim());
    if (hex) onChange(hex);
    setDraft(null);
  };

  return (
    <span className="flex items-center gap-1.5">
      <input
        aria-label={`${label} hex`}
        value={draft ?? value.toUpperCase()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'Escape') setDraft(null);
        }}
        spellCheck={false}
        className="mp-label w-[66px] bg-transparent text-right outline-none"
        style={{ color: 'var(--mp-text-primary)' }}
      />
      {hasDropper ? (
        <button
          type="button"
          aria-label={`${label} eyedropper`}
          title="Pick a color from the screen"
          className="grid h-5 w-5 place-items-center rounded"
          onClick={async () => {
            try {
              const Dropper = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } })
                .EyeDropper;
              const r = await new Dropper().open();
              const hex = toHex(r.sRGBHex);
              if (hex) onChange(hex);
            } catch {
              // User canceled with Escape.
            }
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M8.3 1.2a1.4 1.4 0 0 1 2 2L9.1 4.4l.6.6-.9.9-.6-.6-4.5 4.5H2.1V8.2l4.5-4.5-.6-.6.9-.9.6.6 1.2-1.2Z"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0"
      />
    </span>
  );
}

/** Convert any CSS color to #rrggbb; return null if invalid. */
export function toHex(raw: string): string | null {
  if (!raw) return null;
  let s = raw;
  if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s)) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (typeof document === 'undefined') return null;
  // rgb()/hsl()/named colors: use the browser parser.
  const probe = document.createElement('span');
  probe.style.color = '';
  probe.style.color = s;
  if (!probe.style.color) return null;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const m = c.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return null;
  return `#${m
    .slice(0, 3)
    .map((v) => Math.round(Number(v)).toString(16).padStart(2, '0'))
    .join('')}`;
}
