'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * Dropdown using a role="combobox" button and a custom list of role="option" rows. Native select
 * opens the operating system's menu, which would not match the intended appearance.
 */
export function Select({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The combobox must identify the list it opens via aria-controls.
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-full items-center justify-between rounded-md px-2 text-sm cursor-pointer"
        style={{ background: 'var(--muted)', color: 'var(--foreground)' }}
      >
        <span>{value}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 overflow-hidden py-1"
          style={{
            background: 'var(--card)',
            borderRadius: 10,
            border: '1px solid rgba(var(--ink),.12)',
            boxShadow: '0 10px 28px rgba(0,0,0,.16)',
          }}
        >
          {options.map((o) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={o === value}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm cursor-pointer hover:bg-[rgba(var(--ink),.06)]"
              style={{ fontWeight: o === value ? 600 : 400 }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
