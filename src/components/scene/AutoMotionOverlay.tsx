'use client';

import { useRef, useState } from 'react';
import { shotStart, useEditor } from '@/store/editor';
import {
  analyzeFocus,
  composeTargets,
  DIRECT_DEFAULTS,
  rectsToTargets,
  type AreaRect,
  type DirectOptions,
  type FocusTarget,
} from './autoMotion';
import { toast } from '@/components/shell/Toast';

/**
 * Auto-motion overlay above the frame, visible only while enabled.
 * - Drag: a numbered focus area drawn by hand.
 * - Find focus areas: the screen image is analysed on this device; suggestions appear as the same
 *   numbered boxes. Nothing changes until Compose.
 * - Direct it: find and compose in one click, then play.
 * - Compose / Shuffle: the director (autoMotion.ts) turns the areas into editable camera keyframes.
 *   Areas are kept as screen-local targets, so Shuffle varies angles and rhythm on exactly the same
 *   pixels even after the camera has moved.
 * Boxes are shown in frame coordinates (0–1) for the view in which they were found or drawn.
 */

const OPTS_KEY = 'mockuptop:auto-direct:v1';
function readOpts(): DirectOptions {
  try {
    const raw = window.localStorage.getItem(OPTS_KEY);
    return raw ? { ...DIRECT_DEFAULTS, ...(JSON.parse(raw) as Partial<DirectOptions>) } : DIRECT_DEFAULTS;
  } catch {
    return DIRECT_DEFAULTS;
  }
}

const nextFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export function AutoMotionOverlay() {
  const active = useEditor((s) => s.autoMotion);
  // Suggested areas (target + box) and hand-drawn boxes.
  const [found, setFound] = useState<{ rect: AreaRect; target: FocusTarget }[]>([]);
  const [drawn, setDrawn] = useState<AreaRect[]>([]);
  const [draft, setDraft] = useState<AreaRect | null>(null);
  const [busy, setBusy] = useState<'' | 'find' | 'compose'>('');
  const [seed, setSeed] = useState(0);
  const [opts, setOptsState] = useState<DirectOptions>(readOpts);
  /*
    After Compose, hide boxes and let clicks pass through. Boxes refer to the framing at drawing time;
    once the camera moves, their positions no longer match and could suggest wrong targeting. Keep the
    toolbar for Shuffle/Redraw.
  */
  const [composed, setComposed] = useState(false);
  /** Targets of the last Compose: Shuffle reuses them instead of re-reading boxes with a moved camera. */
  const [lastTargets, setLastTargets] = useState<FocusTarget[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  if (!active) return null;

  const rects = [...found.map((f) => f.rect), ...drawn];

  const setOpts = (patch: Partial<DirectOptions>) => {
    const next = { ...opts, ...patch };
    setOptsState(next);
    try {
      window.localStorage.setItem(OPTS_KEY, JSON.stringify(next));
    } catch {
      // Preference only.
    }
  };

  const rel = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };

  const clearAll = () => {
    setFound([]);
    setDrawn([]);
    setDraft(null);
    setComposed(false);
    setLastTargets(null);
  };

  const close = () => {
    clearAll();
    useEditor.setState({ autoMotion: false });
  };

  /*
    Boxes are drawn for the camera as it is now. Stop playback (a composed move may be running) and let
    the camera settle first, or the boxes drift off the content while the move plays on.
  */
  const findAreas = async (): Promise<FocusTarget[] | null> => {
    const st = useEditor.getState();
    if (st.playing) useEditor.setState({ playing: false });
    // Read the screen in its overview: mid-tour the camera is zoomed and areas outside the frame are skipped.
    if (st.active().autoDirect) st.setPlayhead(shotStart(st.shots, st.activeShotId));
    await nextFrames();
    const res = await analyzeFocus();
    if (!res.targets.length) {
      toast(
        res.reason === 'no-image'
          ? 'Add a screenshot to the device first'
          : res.reason === 'facing-away'
            ? 'Turn the device so its screen faces the camera, then try again'
            : 'No clear focus areas found — drag to mark them',
      );
      return null;
    }
    setComposed(false);
    setLastTargets(null);
    setFound(res.targets.map((target, i) => ({ target, rect: res.rects[i] })));
    return res.targets;
  };

  const run = async (targets: FocusTarget[], s: number) => {
    const n = await composeTargets(targets, s, opts);
    if (!n) {
      toast('Draw the areas on the device screen');
      return false;
    }
    setLastTargets(targets);
    toast(`Auto-motion — ${n} stop${n > 1 ? 's' : ''}, editable keyframes on the timeline · Ctrl+Z undoes`);
    setComposed(true);
    const st = useEditor.getState();
    st.setPlayhead(shotStart(st.shots, st.activeShotId));
    useEditor.setState({ playing: true });
    return true;
  };

  const onFind = async () => {
    if (busy) return;
    setBusy('find');
    try {
      const t = await findAreas();
      if (t) toast(`Found ${t.length} focus area${t.length > 1 ? 's' : ''} — press Compose, or drag to add more`);
    } finally {
      setBusy('');
    }
  };

  const onDirect = async () => {
    if (busy) return;
    setBusy('find');
    try {
      const t = await findAreas();
      if (!t) return;
      setBusy('compose');
      setSeed(0);
      await run(t, 0);
    } finally {
      setBusy('');
    }
  };

  const compose = async (s: number, reuse: boolean) => {
    if (busy) return;
    const targets =
      reuse && lastTargets ? lastTargets : [...found.map((f) => f.target), ...rectsToTargets(drawn)];
    if (!targets.length) return;
    setBusy('compose');
    try {
      await run(targets, s);
    } finally {
      setBusy('');
    }
  };

  const canCompose = rects.length > 0 || !!lastTargets;

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
          setDrawn((r) => [...r, draft]);
          setLastTargets(null);
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
        /*
          Centred within the frame minus a margin, wrapping on narrow frames (9:16): a single row was
          wider than the frame and cut off Done. (left-1/2 would cap the width at half the frame.)
        */
        className="pointer-events-auto absolute inset-x-2 bottom-3 mx-auto flex w-fit max-w-[calc(100%-16px)] flex-wrap items-center justify-center gap-1.5 p-1.5"
        style={{
          background: 'var(--mp-dropdown)',
          border: '1px solid var(--mp-border)',
          borderRadius: 'var(--mp-radius-lg)',
          boxShadow: 'var(--mp-shadow-dropdown)',
          cursor: 'default',
        }}
      >
        <span className="mp-label px-2" style={{ color: 'var(--mp-text-tertiary)' }}>
          {busy === 'find'
            ? 'Reading the screen…'
            : busy === 'compose'
              ? 'Directing…'
              : rects.length
                ? `${rects.length} area${rects.length > 1 ? 's' : ''}`
                : 'Drag to mark focus areas'}
        </span>
        <button className="mp-topbtn" disabled={!!busy} onClick={onFind} data-am-find title="Suggest focus areas from the screenshot">
          Find focus areas
        </button>
        <button
          className="mp-topbtn"
          disabled={!!busy}
          onClick={onDirect}
          data-am-direct
          title="Find the focus areas and build the camera move in one step"
          style={{ background: 'var(--mp-accent)', color: '#fff' }}
        >
          Direct it
        </button>
        <button
          className="mp-topbtn"
          disabled={!rects.length || !!busy}
          onClick={() => compose(seed, false)}
          data-am-compose
          style={{ opacity: rects.length ? 1 : 0.5 }}
        >
          {busy === 'compose' ? 'Composing…' : 'Compose'}
        </button>
        <button
          className="mp-topbtn"
          disabled={!canCompose || !!busy}
          onClick={() => {
            const s = seed + 1;
            setSeed(s);
            void compose(s, true);
          }}
          title="Same areas, different camera angles and rhythm"
        >
          Shuffle
        </button>
        <button
          className="mp-topbtn"
          onClick={() => {
            clearAll();
            useEditor.setState({ playing: false });
          }}
          disabled={!rects.length && !composed}
        >
          {composed ? 'Redraw' : 'Clear'}
        </button>
        <button className="mp-topbtn" onClick={close}>
          Done
        </button>
        <div className="flex w-full flex-wrap items-center justify-center gap-3 pt-0.5" style={{ color: 'var(--mp-text-secondary)' }}>
          {(
            [
              ['highlights', 'Highlights', 'Ring a price or button while the camera holds on it'],
              ['countUp', 'Count up', 'Count up a price or total read from the screen, as a caption'],
              ['softFocus', 'Soft focus', 'Blur around each close-up, sharp on the area'],
            ] as const
          ).map(([k, label, title]) => (
            <label key={k} className="mp-label flex cursor-pointer items-center gap-1.5" title={title} style={{ fontSize: 10 }}>
              <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ [k]: e.target.checked })} data-am-opt={k} />
              {label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
