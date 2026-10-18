'use client';

import { useRef, useState } from 'react';
import { shotStart, useEditor } from '@/store/editor';
import { composeAutoMotion, type AreaRect } from './autoMotion';
import { toast } from '@/components/shell/Toast';

/**
 * Auto-motion drawing overlay above the frame, visible only while enabled. Drag creates a numbered
 * focus region. Compose uses the autoMotion.ts solver to write and play camera keyframes. Shuffle
 * reuses regions with new angles. Store regions as frame-relative coordinates (0–1); the solver
 * raycasts them onto the device screen.
 */
export function AutoMotionOverlay() {
  const active = useEditor((s) => s.autoMotion);
  const [rects, setRects] = useState<AreaRect[]>([]);
  const [draft, setDraft] = useState<AreaRect | null>(null);
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState(0);
  /*
    After Compose, hide boxes and let clicks pass through. Boxes refer to the framing at drawing
    time; once the camera moves, their positions no longer match and can suggest incorrect targeting.
    Keep the toolbar for Shuffle/Redraw.
  */
  const [composed, setComposed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  if (!active) return null;

  const rel = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };

  const close = () => {
    setRects([]);
    setDraft(null);
    setComposed(false);
    useEditor.setState({ autoMotion: false });
  };

  const compose = async (s: number) => {
    if (!rects.length || busy) return;
    setBusy(true);
    try {
      const n = await composeAutoMotion(rects, s);
      if (!n) {
        toast('Draw the areas on the device screen');
        return;
      }
      toast(`Auto-motion — ${n} focus area${n > 1 ? 's' : ''}, editable keyframes on the timeline`);
      setComposed(true);
      const st = useEditor.getState();
      st.setPlayhead(shotStart(st.shots, st.activeShotId));
      useEditor.setState({ playing: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={box}
      className={`absolute inset-0 z-40 ${composed ? 'pointer-events-none' : ''}`}
      style={{ cursor: 'crosshair', background: composed ? 'transparent' : 'rgba(10,10,20,0.12)' }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-am-ui]')) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const p = rel(e);
        setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!draft) return;
        const p = rel(e);
        setDraft({ ...draft, x1: p.x, y1: p.y });
      }}
      onPointerUp={() => {
        if (draft && Math.abs(draft.x1 - draft.x0) > 0.015 && Math.abs(draft.y1 - draft.y0) > 0.015) {
          setRects((r) => [...r, draft]);
        }
        setDraft(null);
      }}
    >
      {(composed ? [] : [...rects, ...(draft ? [draft] : [])]).map((r, i) => (
        <div
          key={i}
          className="pointer-events-none absolute"
          style={{
            left: `${Math.min(r.x0, r.x1) * 100}%`,
            top: `${Math.min(r.y0, r.y1) * 100}%`,
            width: `${Math.abs(r.x1 - r.x0) * 100}%`,
            height: `${Math.abs(r.y1 - r.y0) * 100}%`,
            border: '1.5px solid var(--mp-accent)',
            background: 'rgba(90,110,255,0.14)',
            borderRadius: 6,
          }}
        >
          <span
            className="mp-label absolute -left-px -top-5 px-1.5"
            style={{ background: 'var(--mp-accent)', color: '#fff', borderRadius: 4, fontSize: 10 }}
          >
            {i + 1}
          </span>
        </div>
      ))}

      <div
        data-am-ui
        className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 p-1.5"
        style={{
          background: 'var(--mp-dropdown)',
          border: '1px solid var(--mp-border)',
          borderRadius: 'var(--mp-radius-lg)',
          boxShadow: 'var(--mp-shadow-dropdown)',
          cursor: 'default',
        }}
      >
        <span className="mp-label px-2" style={{ color: 'var(--mp-text-tertiary)' }}>
          {rects.length ? `${rects.length} area${rects.length > 1 ? 's' : ''}` : 'Drag to mark focus areas'}
        </span>
        <button
          className="mp-topbtn"
          disabled={!rects.length || busy}
          onClick={() => compose(seed)}
          style={{ background: 'var(--mp-accent)', color: '#fff', opacity: rects.length ? 1 : 0.5 }}
        >
          {busy ? 'Composing…' : 'Compose'}
        </button>
        <button
          className="mp-topbtn"
          disabled={!rects.length || busy}
          onClick={() => {
            const s = seed + 1;
            setSeed(s);
            void compose(s);
          }}
          title="Same areas, different camera angles"
        >
          Shuffle
        </button>
        <button
          className="mp-topbtn"
          onClick={() => {
            setRects([]);
            setComposed(false);
            useEditor.setState({ playing: false });
          }}
          disabled={!rects.length}
        >
          {composed ? 'Redraw' : 'Clear'}
        </button>
        <button className="mp-topbtn" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}
