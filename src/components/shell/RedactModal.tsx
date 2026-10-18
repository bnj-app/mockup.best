'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '@/store/editor';
import {
  bakeToCanvas,
  loadImage,
  originalOf,
  redactToUrl,
  REDACT_STYLES,
  type RedactRect,
  type RedactStyle,
} from '@/config/redact';
import { toast } from '@/components/shell/Toast';
import { track } from '@/lib/analytics';

/**
 * HIDE PRIVATE INFO: mark regions in the source screenshot and permanently cover them. Rendering lives
 * in config/redact.ts. Drag empty space to create a region, drag a region to move it, use the
 * bottom-right handle to resize, and Delete to remove the selection. Style buttons affect the selected
 * region or future regions if none is selected. Preview renders live on a small copy; Apply renders at
 * full resolution and replaces the image everywhere it is used. ⚠️ Isolate keyboard events: the
 * editor's Delete shortcut removes the active scene. While open, intercept non-input keys on window
 * during capture so they cannot reach the editor, preserving default actions such as Enter on buttons.
 */

export const REDACT_EVENT = 'mockuptop:redact';
export function openRedact(url: string) {
  window.dispatchEvent(new CustomEvent(REDACT_EVENT, { detail: { url } }));
}

type Drag =
  | { kind: 'new'; x0: number; y0: number }
  | { kind: 'move'; i: number; dx: number; dy: number }
  | { kind: 'size'; i: number };

const PREVIEW_MAX = { w: 420, h: 520 };

function RedactModal({ url, onClose }: { url: string; onClose: () => void }) {
  const base = originalOf(url) ?? url;
  const editable = !!originalOf(url);
  // Read initial regions once: returning `[]` from the selector creates a new array each render and loops forever.
  const [rects, setRects] = useState<RedactRect[]>(() => {
    if (!editable) return [];
    const s = useEditor.getState();
    const list =
      s.shots.find((x) => x.media === url)?.redactions ??
      s.shots.flatMap((x) => x.extras).find((e) => e.media === url)?.redactions ??
      [];
    return list.map((r) => ({ ...r }));
  });
  const [sel, setSel] = useState<number | null>(null);
  const [style, setStyle] = useState<RedactStyle>('erase');
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let off = false;
    loadImage(base).then(
      (i) => !off && setImg(i),
      () => !off && toast('Could not open this image'),
    );
    return () => {
      off = true;
    };
  }, [base]);

  const fit = img
    ? (() => {
        const k = Math.min(PREVIEW_MAX.w / img.naturalWidth, PREVIEW_MAX.h / img.naturalHeight, 1);
        return { w: Math.round(img.naturalWidth * k), h: Math.round(img.naturalHeight * k) };
      })()
    : null;

  // Render live preview on the small copy after dragging and on every change.
  useEffect(() => {
    if (!img || !fit || drag) return;
    const c = canvasRef.current;
    if (!c) return;
    const baked = bakeToCanvas(img, rects, fit);
    c.width = fit.w;
    c.height = fit.h;
    c.getContext('2d')!.drawImage(baked, 0, 0);
    // fit is a new object each render; img determines its size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, rects, drag]);

  // Keyboard isolation and shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      e.stopPropagation();
      if (e.key === 'Escape') onClose();
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel !== null) {
        e.preventDefault();
        setRects((r) => r.filter((_, i) => i !== sel));
        setSel(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, sel]);

  const at = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const onDown = (e: React.PointerEvent) => {
    if (!img) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = at(e);
    const handle = (e.target as HTMLElement).dataset.handle;
    const hitIdx = (e.target as HTMLElement).dataset.rect;
    if (handle !== undefined) {
      setSel(Number(handle));
      setDrag({ kind: 'size', i: Number(handle) });
    } else if (hitIdx !== undefined) {
      const i = Number(hitIdx);
      setSel(i);
      setDrag({ kind: 'move', i, dx: p.x - rects[i].x, dy: p.y - rects[i].y });
    } else {
      setRects((r) => [...r, { x: p.x, y: p.y, w: 0, h: 0, style }]);
      setSel(rects.length);
      setDrag({ kind: 'new', x0: p.x, y0: p.y });
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = at(e);
    setRects((list) =>
      list.map((r, i) => {
        if (drag.kind === 'new' && i === list.length - 1) {
          return { ...r, x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) };
        }
        if (drag.kind === 'move' && i === drag.i) {
          return { ...r, x: Math.min(1 - r.w, Math.max(0, p.x - drag.dx)), y: Math.min(1 - r.h, Math.max(0, p.y - drag.dy)) };
        }
        if (drag.kind === 'size' && i === drag.i) {
          return { ...r, w: Math.max(0.01, p.x - r.x), h: Math.max(0.01, p.y - r.y) };
        }
        return r;
      }),
    );
  };

  const onUp = () => {
    if (!drag) return;
    // A click without dragging must not leave a new region.
    if (drag.kind === 'new') {
      setRects((list) => {
        const last = list[list.length - 1];
        if (last && (last.w < 0.008 || last.h < 0.004)) {
          setSel(null);
          return list.slice(0, -1);
        }
        return list;
      });
    }
    setDrag(null);
  };

  const pickStyle = (s: RedactStyle) => {
    setStyle(s);
    if (sel !== null) setRects((r) => r.map((x, i) => (i === sel ? { ...x, style: s } : x)));
  };

  const apply = async () => {
    if (!img) return;
    setBusy(true);
    try {
      // With all regions removed, skip rendering and restore this tab's original image.
      const next = rects.length ? await redactToUrl(url, rects) : base;
      const n = useEditor.getState().replaceMediaUrl(url, next, rects.length ? rects : undefined);
      track('redact_apply', { areas: rects.length, places: n });
      toast(
        rects.length
          ? `Hidden ${rects.length} area${rects.length === 1 ? '' : 's'} on ${n} screen${n === 1 ? '' : 's'} — Ctrl+Z to undo`
          : 'Hidden areas removed',
      );
      onClose();
    } catch {
      toast('Could not apply — try again');
      setBusy(false);
    }
  };

  const places = useEditor((s) => s.shots.filter((x) => x.media === url).length + s.shots.flatMap((x) => x.extras).filter((e) => e.media === url).length);

  return (
    <div
      className="fixed inset-0 z-[950] grid place-items-center p-4"
      style={{ background: 'rgba(10,10,14,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Hide private info"
        className="flex max-h-[92vh] max-w-full flex-col overflow-hidden"
        style={{
          width: 468,
          background: 'var(--mp-dropdown)',
          border: '1px solid var(--mp-border)',
          borderRadius: 'var(--mp-radius-lg)',
          boxShadow: 'var(--mp-shadow-dropdown)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1 p-4 pb-3">
          <span className="mp-label" style={{ color: 'var(--mp-text-primary)', fontSize: 13, fontWeight: 700 }}>
            Hide private info
          </span>
          <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', lineHeight: 1.5 }}>
            Drag over emails, names or balances. The areas are burned into the image on every scene that uses it
            {places > 1 ? ` (${places})` : ''}. The original stays in this tab only, for undo — it is never saved,
            exported or shared.
          </span>
        </div>

        <div className="mp-scroll grid min-h-0 flex-1 place-items-center overflow-auto px-4">
          {fit ? (
            <div
              ref={boxRef}
              className="relative select-none"
              style={{ width: fit.w, height: fit.h, cursor: 'crosshair', touchAction: 'none' }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              data-redact-stage
            >
              <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" style={{ width: fit.w, height: fit.h, borderRadius: 6 }} />
              {rects.map((r, i) => (
                <div
                  key={i}
                  data-rect={i}
                  className="absolute"
                  style={{
                    left: `${r.x * 100}%`,
                    top: `${r.y * 100}%`,
                    width: `${r.w * 100}%`,
                    height: `${r.h * 100}%`,
                    outline: `1.5px ${sel === i ? 'solid' : 'dashed'} ${sel === i ? 'var(--mp-accent)' : 'rgba(255,255,255,0.9)'}`,
                    boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
                    cursor: 'move',
                  }}
                >
                  {sel === i ? (
                    <span
                      data-handle={i}
                      className="absolute"
                      style={{ right: -5, bottom: -5, width: 10, height: 10, borderRadius: 3, background: 'var(--mp-accent)', cursor: 'nwse-resize' }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <span className="mp-label py-10" style={{ color: 'var(--mp-text-tertiary)' }}>
              Loading image…
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2 p-4 pt-3">
          <div className="flex gap-1" role="radiogroup" aria-label="Style">
            {REDACT_STYLES.map((s) => {
              const on = (sel !== null ? rects[sel]?.style : style) === s.id;
              return (
                <button
                  key={s.id}
                  role="radio"
                  aria-checked={on}
                  onClick={() => pickStyle(s.id)}
                  className="mp-label flex-1 py-1.5"
                  style={{
                    borderRadius: 'var(--mp-radius)',
                    background: on ? 'var(--mp-surface-active)' : 'var(--mp-surface)',
                    color: on ? 'var(--mp-text-primary)' : undefined,
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <div className="mp-label flex items-center justify-between" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
            <span>
              {rects.length
                ? `${rects.length} area${rects.length === 1 ? '' : 's'}${sel !== null ? ' · Delete removes the selected one' : ''}`
                : 'Drag on the image to cover something'}
            </span>
            {rects.length ? (
              <button
                className="mp-label underline"
                style={{ fontSize: 9 }}
                onClick={() => {
                  setRects([]);
                  setSel(null);
                }}
              >
                Clear all
              </button>
            ) : null}
          </div>
          <button
            disabled={!img || busy || (!rects.length && !editable)}
            data-redact-apply
            className="mp-label w-full py-2.5"
            style={{
              borderRadius: 'var(--mp-radius)',
              background: img && (rects.length || editable) ? 'var(--mp-accent)' : 'var(--mp-surface)',
              color: img && (rects.length || editable) ? '#fff' : 'var(--mp-text-tertiary)',
              fontWeight: 600,
            }}
            onClick={apply}
          >
            {busy ? 'Applying…' : rects.length ? `Hide ${rects.length} area${rects.length === 1 ? '' : 's'}` : editable ? 'Remove hidden areas' : 'Mark an area first'}
          </button>
          <button className="mp-label w-full py-1" style={{ color: 'var(--mp-text-tertiary)' }} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function RedactHost() {
  const [open, setOpen] = useState<{ url: string; n: number } | null>(null);
  useEffect(() => {
    let n = 0;
    const onOpen = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url;
      if (!url) return;
      n += 1;
      setOpen({ url, n });
    };
    window.addEventListener(REDACT_EVENT, onOpen);
    return () => window.removeEventListener(REDACT_EVENT, onOpen);
  }, []);
  if (!open) return null;
  return createPortal(<RedactModal key={open.n} url={open.url} onClose={() => setOpen(null)} />, document.body);
}
