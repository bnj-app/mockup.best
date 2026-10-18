'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The panel's signature control. The whole row is draggable, with a fill growing from the left,
 * notches while dragging and a value on the right. Click the value for inline number entry. The
 * hint badge beside the label explains available gestures.
 */
export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step = 0.01,
  precision = 2,
  keyframed,
  onChange,
  onToggleKeyframe,
  onReset,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  precision?: number;
  keyframed?: boolean;
  onChange: (v: number) => void;
  onToggleKeyframe?: () => void;
  /** Right-click to reset to the default. If omitted, show the browser menu. */
  onReset?: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const ratio = Math.min(1, Math.max(0, (value - min) / (max - min)));

  /*
    The 3 px dark handle crossed the label inside the track, splitting letters ("LIGHT ROTA|ION",
    "|FOV", "KEY HEIG|HT") even at default values. Measure track and label widths; when the handle
    overlaps the label, split it into two short notches with a central gap. The text stays clear
    while position remains visible.
  */
  const labelRef = useRef<HTMLSpanElement>(null);
  const [geo, setGeo] = useState<{ track: number; labelL: number; labelR: number } | null>(null);
  useLayoutEffect(() => {
    const t = trackRef.current;
    const l = labelRef.current;
    if (!t || !l) return;
    const measure = () =>
      setGeo((prev) => {
        const next = { track: t.clientWidth, labelL: l.offsetLeft, labelR: l.offsetLeft + l.offsetWidth };
        return prev && prev.track === next.track && prev.labelL === next.labelL && prev.labelR === next.labelR
          ? prev
          : next;
      });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(t);
    ro.observe(l);
    return () => ro.disconnect();
  }, [label, hint]);
  const handleX = geo ? ratio * geo.track : -1;
  const splitHandle = !!geo && handleX > geo.labelL - 4 && handleX < geo.labelR + 4;

  const applyFromPointer = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const raw = min + r * (max - min);
      onChange(Math.round(raw / step) * step);
    },
    [min, max, step, onChange],
  );

  /*
    Disable page-wide text selection while dragging. Pointer events worked, but real mouse drags
    started text selection and changed the cursor to an I-beam, making the handle feel unresponsive.
    Selection dragging could also scroll the panel.
  */
  useEffect(() => {
    if (!dragging) return;
    const prevSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';

    const move = (e: PointerEvent) => applyFromPointer(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, applyFromPointer]);

  const commitDraft = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
    setEditing(false);
  };

  /*
    Keyboard fine adjustment. Mouse dragging is useful for coarse changes, but exact values such as
    18 degrees require precision. Arrow keys move ±1 step, Shift ±10, on both the focused track and
    inline number input. Left/right and up/down behave identically so either expected arrow direction
    works on the horizontal track.
  */
  const nudge = (dir: -1 | 1, big: boolean) => {
    const delta = step * dir * (big ? 10 : 1);
    const next = Math.min(max, Math.max(min, value + delta));
    // Limit floating-point accumulation: values such as 0.30000000000000004
    // look untidy in the inline input.
    onChange(Number(next.toFixed(6)));
  };

  const onArrowKey = (e: React.KeyboardEvent): boolean => {
    const up = e.key === 'ArrowUp' || e.key === 'ArrowRight';
    const down = e.key === 'ArrowDown' || e.key === 'ArrowLeft';
    if (!up && !down) return false;
    e.preventDefault();
    // Do not propagate to scene shortcuts such as playhead nudging.
    e.stopPropagation();
    nudge(up ? 1 : -1, e.shiftKey);
    return true;
  };

  return (
    <div className="relative flex items-center gap-1.5" style={{ height: 'var(--mp-row-h)' }}>
      <div
        ref={trackRef}
        data-active={dragging}
        onPointerDown={(e) => {
          if (editing) return;
          e.preventDefault();
          e.stopPropagation();
          // Pointer capture keeps events here even when the pointer leaves
          // the track; otherwise another element under the pointer
          // can steal the drag.
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          setDragging(true);
          applyFromPointer(e.clientX);
        }}
        /*
          Right-click resets to the default. This shared gesture avoids cluttering the panel with
          individual reset buttons.
        */
        onContextMenu={
          onReset
            ? (e) => {
                e.preventDefault();
                onReset();
              }
            : undefined
        }
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        onKeyDown={(e) => {
          if (onArrowKey(e)) return;
          /*
            Consume Delete/Backspace on the focused track. The global shortcut (app/page.tsx) deletes the
            active scene when no keyframe is selected; keyboard users tabbing to a slider and trying to clear
            its number otherwise lost the entire scene.
          */
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          // Home/End: jump to the ends with one key instead of a long drag.
          if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            onChange(e.key === 'Home' ? min : max);
          }
        }}
        className="group relative h-full flex-1 cursor-ew-resize select-none overflow-hidden outline-none focus-visible:ring-1"
        style={{
          borderRadius: 'var(--mp-radius)',
          background: 'var(--mp-surface)',
          touchAction: 'none',
        }}
      >
        {/* Fill growing from the left */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 transition-colors"
          style={{
            width: `${ratio * 100}%`,
            background: dragging ? 'var(--mp-border-hover)' : 'var(--mp-surface-active)',
          }}
        />

        {/* Notches visible only while dragging */}
        <div className="pointer-events-none absolute inset-0">
          {Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              className="absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors"
              style={{
                left: `${((i + 1) / 10) * 100}%`,
                background: dragging ? 'var(--mp-border-hover)' : 'transparent',
              }}
            />
          ))}
        </div>

        {/* Handle: two notches with a central gap when overlapping the label */}
        {splitHandle ? (
          <>
            <div
              data-split-handle
              className="pointer-events-none absolute h-2 w-[3px] rounded-full"
              style={{
                left: `calc(${ratio * 100}% - 1.5px)`,
                top: 'calc(50% - 15px)',
                background: 'var(--mp-text-primary)',
              }}
            />
            <div
              className="pointer-events-none absolute h-2 w-[3px] rounded-full"
              style={{
                left: `calc(${ratio * 100}% - 1.5px)`,
                top: 'calc(50% + 7px)',
                background: 'var(--mp-text-primary)',
              }}
            />
          </>
        ) : (
          <div
            className="pointer-events-none absolute top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
            style={{ left: `calc(${ratio * 100}% - 1.5px)`, background: 'var(--mp-text-primary)' }}
          />
        )}

        <span
          ref={labelRef}
          className="mp-label pointer-events-none absolute left-2.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5"
          style={{ color: dragging ? 'var(--mp-text-focus)' : undefined }}
        >
          {label}
          {hint ? <span className="mp-hint">{hint}</span> : null}
        </span>
      </div>

      {/* Value / inline input */}
      <div className="relative w-12 shrink-0 text-right">
        {editing ? (
          <input
            autoFocus
            // The input has no visible label (the number is at the row's right edge);
            // its accessible name comes from the row label, matching
            // the slider track above.
            aria-label={label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitDraft();
              if (e.key === 'Escape') setEditing(false);
              /*
                Arrow keys also work in the inline input, but use the draft first: typing 18 then pressing up
                should yield 19 rather than advancing from the old value.
              */
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const base = Number.isFinite(Number(draft)) ? Number(draft) : value;
                const delta = step * (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1);
                const next = Number(Math.min(max, Math.max(min, base + delta)).toFixed(6));
                setDraft(next.toFixed(precision));
                onChange(next);
              }
            }}
            className="mp-label w-full bg-transparent text-right outline-none"
            style={{ borderBottom: '1px solid var(--mp-text-label)', color: 'var(--mp-text-focus)' }}
          />
        ) : (
          <button
            onClick={() => {
              setDraft(value.toFixed(precision));
              setEditing(true);
            }}
            className="mp-label w-full cursor-text text-right"
            style={{ color: dragging ? 'var(--mp-text-focus)' : undefined }}
          >
            {value.toFixed(precision)}
          </button>
        )}
      </div>

      {onToggleKeyframe ? (
        <button
          onClick={onToggleKeyframe}
          aria-label={keyframed ? 'Remove keyframe' : 'Add keyframe'}
          className="grid h-5 w-5 shrink-0 place-items-center"
        >
          <span
            className="block h-2 w-2 rotate-45"
            style={{
              background: keyframed ? 'var(--mp-accent)' : 'transparent',
              border: `1px solid ${keyframed ? 'var(--mp-accent)' : 'var(--mp-text-tertiary)'}`,
              borderRadius: 1,
            }}
          />
        </button>
      ) : null}
    </div>
  );
}
