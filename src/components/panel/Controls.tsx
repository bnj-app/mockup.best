'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** FREE / PRO badge. */
export function Badge({ tone }: { tone: 'free' | 'pro' }) {
  return (
    <span className="mp-badge" data-tone={tone}>
      {tone}
    </span>
  );
}

/**
 * On/off toggle. The badge prop was removed: it replaced the switch, hiding whether a badged Toggle
 * was on or off. Once the last call site was removed, the prop was unused.
 */
export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      data-checked={checked}
      /*
        role="switch" + aria-checked: this looked like a switch but was marked up as a plain button, so
        screen readers announced "Notch, button" without its state. Match the pattern already used by the
        photo module's Animate toggle.
      */
      role="switch"
      aria-checked={checked}
      className="flex w-full items-center justify-between px-2.5 transition-colors"
      style={{
        height: 'var(--mp-row-h)',
        borderRadius: 'var(--mp-radius)',
        background: 'var(--mp-surface)',
      }}
    >
      <span className="mp-label">{label}</span>
      <span
        className="relative h-5 w-9 rounded-full transition-colors"
        style={{ background: checked ? 'var(--mp-accent)' : 'var(--mp-surface-active)' }}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full transition-[left]"
          style={{ left: checked ? 18 : 2, background: '#fff' }}
        />
      </span>
    </button>
  );
}

/**
 * File-picker button. Why: a label with a display:none input is inaccessible by keyboard: the input
 * leaves the tab order, and the label is not focusable. "Upload media", "+ AUDIO" and "+ Logo" were
 * unreachable without a mouse. A real button receives focus, supports Enter/Space and opens the
 * input programmatically. Centralize the pattern already used by the photo module's App Logo
 * button.
 */
export function FileButton({
  accept,
  onPick,
  className,
  style,
  title,
  ariaLabel,
  children,
}: {
  accept: string;
  onPick: (file: File) => void;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={className}
        style={style}
        title={title}
        aria-label={ariaLabel}
      >
        {children}
      </button>
      {/*
        Reset the value each time: choosing the same file again otherwise does not fire change, making
        the click appear to do nothing.
      */}
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onPick(f);
        }}
      />
    </>
  );
}

/**
 * Segmented control with a sliding pill. Plain buttons announced separate actions without selection
 * state. Use a complete radio-group pattern; roles alone are insufficient because users expect
 * arrow-key navigation. Group: role="radiogroup"; items: role="radio" + aria-checked. Roving
 * tabIndex gives one Tab stop on the selected item, then arrows move focus and select as native
 * radios do. Home/End move to the ends.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** Group name. Supply it if there is no visible heading, or the group is announced without a name. */
  ariaLabel?: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys: move to the next item, wrap at either end, and move focus too.
  const step = (delta: number) => {
    const n = options.length;
    const next = (index + delta + n) % n;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  const jump = (next: number) => {
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="relative flex p-0.5"
      style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface)' }}
    >
      <span
        className="absolute bottom-0.5 top-0.5 rounded-md transition-[left]"
        style={{
          left: `calc(${(index / options.length) * 100}% + 2px)`,
          width: `calc(${100 / options.length}% - 4px)`,
          background: 'var(--mp-surface-active)',
        }}
      />
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === index ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault();
              step(1);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault();
              step(-1);
            } else if (e.key === 'Home') {
              e.preventDefault();
              jump(0);
            } else if (e.key === 'End') {
              e.preventDefault();
              jump(options.length - 1);
            }
          }}
          className="mp-label relative z-10 flex-1 py-1.5"
          style={{ color: o.value === value ? 'var(--mp-text-primary)' : undefined }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Labeled dropdown. Native select uses an OS menu that cannot show badges/swatches or match
 * styling. Implement the full combobox pattern: roles alone would promise arrow navigation without
 * providing it. Trigger: role="combobox", aria-expanded, aria-controls and aria-labelledby from the
 * visible label. List: role="listbox"; items: role="option" + aria-selected. Focus the selected
 * item on open; arrows and Home/End navigate. Enter/Space work natively on real buttons. Escape
 * closes and returns focus to the trigger so users do not lose their place at the page start. The
 * photo module's Select supplied the role structure; navigation is completed here.
 */
/**
 * Bring an element into view within its nearest scrollable container. Pitfall: scrollIntoView can
 * also scroll overflow:hidden ancestors; shifting the editor's fullscreen main/aside by even a
 * pixel leaves it displaced. Manually scroll only the first ancestor with overflow-y: auto|scroll.
 */
export function revealInScroller(el: HTMLElement | null, margin = 8) {
  if (!el) return;
  let p = el.parentElement;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) break;
    p = p.parentElement;
  }
  if (!p) return;
  const r = el.getBoundingClientRect();
  const pr = p.getBoundingClientRect();
  if (r.bottom > pr.bottom - margin) {
    p.scrollTop += Math.min(r.bottom - pr.bottom + margin, r.top - pr.top - margin);
  } else if (r.top < pr.top + margin) {
    p.scrollTop -= pr.top + margin - r.top;
  }
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; badge?: 'free' | 'pro'; swatch?: string }[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();
  const labelId = useId();
  /*
    The trigger name has two parts: label and current value. The label alone announced "Format,
    combobox" without the selection because aria-labelledby overrides the button's own content.
  */
  const valueId = useId();
  const current = options.find((o) => o.value === value);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));
  // Focused row while the list is open; meaningless when closed.
  const [focusIndex, setFocusIndex] = useState(selected);

  const openList = (index = selected) => {
    setFocusIndex(index);
    setOpen(true);
  };
  /** Close. If restore is false, leave focus unchanged (outside click). */
  const closeList = (restore = true) => {
    setOpen(false);
    if (restore) btnRef.current?.focus();
  };

  // Moving focus requires DOM access: focus the matching button whenever
  // focusIndex changes, and focus the selected item on opening.
  useEffect(() => {
    // preventScroll: automatic focus scrolling showed only the selected row,
    // leaving the rest clipped below the container (see the effect below).
    if (open) optionRefs.current[focusIndex]?.focus({ preventScroll: true });
  }, [open, focusIndex]);

  /*
    Show the whole list on opening. Selectors near the panel bottom (Text → In/Out animation, Blur →
    Mode) opened clipped at the container edge, hiding the available options.
  */
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) revealInScroller(listRef.current);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);

  // Handle list navigation in one place: trigger and rows share
  // a container, and events bubble to it.
  const onListKeyDown = (e: React.KeyboardEvent) => {
    const n = options.length;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeList();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIndex((i) => (i + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIndex((i) => (i - 1 + n) % n);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setFocusIndex(n - 1);
    } else if (e.key === 'Tab') {
      // Tab leaves the list; do not restore focus, so the browser
      // can advance normally to the next element.
      closeList(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            openList();
          }
        }}
        className="flex w-full items-center justify-between px-2.5"
        style={{ height: 'var(--mp-row-h)', borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface)' }}
      >
        <span className="mp-label" id={labelId}>
          {label}
        </span>
        <span
          id={valueId}
          className="mp-label flex items-center gap-1"
          style={{ color: 'var(--mp-text-primary)' }}
        >
          {current?.label ?? value}
          <Chevron open={open} />
        </span>
      </button>

      {open ? (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          onKeyDown={onListKeyDown}
          className="mp-scroll absolute right-0 z-50 mt-1 max-h-72 w-full overflow-y-auto p-1"
          style={{
            background: 'var(--mp-dropdown)',
            border: '1px solid var(--mp-border)',
            borderRadius: 'var(--mp-radius)',
            boxShadow: 'var(--mp-shadow-dropdown)',
          }}
        >
          {options.map((o, i) => (
            <button
              key={o.value}
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              type="button"
              role="option"
              aria-selected={o.value === value}
              // Rows are not Tab stops: focus is assigned programmatically on entry,
              // and arrow keys handle navigation.
              tabIndex={-1}
              onClick={() => {
                onChange(o.value);
                closeList();
              }}
              className="mp-label flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left"
              style={{
                background: o.value === value ? 'var(--mp-surface-active)' : 'transparent',
                color: o.value === value ? 'var(--mp-text-primary)' : undefined,
              }}
            >
              <span>{o.label}</span>
              {o.badge ? <Badge tone={o.badge} /> : null}
              {o.swatch ? (
                <span
                  className="h-4 w-6 shrink-0 rounded-[3px]"
                  style={{ background: o.swatch, border: '1px solid var(--mp-border)' }}
                />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Two-axis position pad for controls such as a focal point. */
export function XYPad({
  x,
  y,
  onChange,
}: {
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      onChange(
        Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      );
    };
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, onChange]);

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      className="relative h-32 w-full cursor-crosshair"
      style={{ background: 'var(--mp-surface)', borderRadius: 'var(--mp-radius)' }}
    >
      <span className="absolute left-1/2 top-0 h-full w-px" style={{ background: 'var(--mp-border)' }} />
      <span className="absolute left-0 top-1/2 h-px w-full" style={{ background: 'var(--mp-border)' }} />
      <span
        className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ left: `${x * 100}%`, top: `${y * 100}%`, background: 'var(--mp-accent)' }}
      />
    </div>
  );
}

export function Chevron({ open }: { open?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}
    >
      <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Collapsible section. */
export function Folder({
  title,
  children,
  defaultOpen = true,
  onReset,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  onReset?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className="pb-2"
      style={{ borderBottom: '1px solid var(--mp-surface-subtle)', marginBottom: 8 }}
    >
      <header className="flex items-center justify-between" style={{ height: 'var(--mp-row-h)' }}>
        <button onClick={() => setOpen((v) => !v)} className="mp-section-title flex-1 text-left" aria-expanded={open}>
          {title}
        </button>
        <div className="flex items-center gap-1" style={{ color: 'var(--mp-text-tertiary)' }}>
          {onReset ? (
            <button onClick={onReset} aria-label={`Reset ${title}`} className="p-1">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2.5 4.5A4 4 0 1 1 2 6"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <path d="M1 2v2.6h2.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
          <button onClick={() => setOpen((v) => !v)} className="p-1" aria-label={`Toggle ${title}`} aria-expanded={open}>
            <Chevron open={open} />
          </button>
        </div>
      </header>
      {open ? <div className="flex flex-col gap-1.5 pb-3">{children}</div> : null}
    </section>
  );
}
