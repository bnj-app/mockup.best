'use client';

import { useEffect, useRef, useState } from 'react';
import { shotStart, useEditor, totalDuration } from '@/store/editor';
import { EASINGS, trackLabel } from '@/config/tracks';
import { MOTION_PRESETS } from '@/config/motion';
import { Chevron, FileButton } from '@/components/panel/Controls';
import { ContextMenu, useContextMenu } from '@/components/panel/ContextMenu';
import { EasingGraph } from '@/components/panel/EasingGraph';
import { toast } from '@/components/shell/Toast';
import { useProjectBeats, useWaveform } from '@/components/shell/waveform';
import { BeatsMenu } from '@/components/shell/BeatsMenu';

/**
 * Minimum ruler duration. The window expands beyond 12 seconds so clips stay inside it and the
 * playhead can reach the entire project.
 */
const MIN_RULER_SECONDS = 12;

/**
 * Snap time to nearby convenient values.
 * Targets are whole and half seconds. The threshold is in PIXELS (6 px): a fixed time threshold
 * becomes too sticky or ineffective when zooming. Alt disables snapping for precise values such
 * as 1.37.
 */
/** Time display: the only small component subscribed to the playhead. */
function PlayheadTime({ total }: { total: number }) {
  const playhead = useEditor((s) => s.playhead);
  return (
    <span
      className="mp-label tabular-nums"
      style={{ color: 'var(--mp-text-primary)', minWidth: 96, textAlign: 'center' }}
    >
      {playhead.toFixed(2)} / {total.toFixed(2)}s
    </span>
  );
}

/** Cursor line from the ruler to the bottom; the second playhead subscriber. */
function PlayheadCursor({
  rulerSeconds,
  pct,
}: {
  rulerSeconds: number;
  pct: (t: number) => string;
}) {
  const playhead = useEditor((s) => s.playhead);
  return (
    <div className="pointer-events-none absolute bottom-0 z-30" style={{ top: 0, left: GUTTER, right: 0 }}>
      <div className="absolute bottom-0 top-0" style={{ left: pct(Math.min(playhead, rulerSeconds)) }}>
        <span className="absolute bottom-0 top-0 w-px" style={{ background: 'var(--mp-accent)' }} />
        <span
          className="absolute -translate-x-1/2"
          style={{
            top: 0,
            width: 9,
            height: 9,
            background: 'var(--mp-accent)',
            clipPath: 'polygon(50% 100%, 0 0, 100% 0)',
          }}
        />
      </div>
    </div>
  );
}

/** Beat targets: ascending list in PROJECT time plus the caller's local time origin. */
type BeatSnap = { list: number[]; offset: number } | null;

/** Nearest value to `x` in an ascending list (binary search). */
function nearestBeat(list: number[], x: number): number | null {
  if (!list.length) return null;
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  const a = list[lo];
  const b = lo > 0 ? list[lo - 1] : a;
  return Math.abs(a - x) < Math.abs(b - x) ? a : b;
}

function snapSeconds(t: number, perSec: number, disabled: boolean, playheadLocal?: number, beats?: BeatSnap): number {
  if (disabled) return t;
  // 10 px: with 6 px, half-second grid lines were 46 px apart, so
  // snapping almost never triggered (measured: it stayed at 1.1 s).
  const thresholdSec = 10 / Math.max(1, perSec);
  /*
    BEATS FIRST: a beat within the threshold takes priority over the grid and playhead. Otherwise
    a 0.5 s grid line could win 60 ms away from a beat, making beat snapping feel broken.
  */
  if (beats) {
    const b = nearestBeat(beats.list, t + beats.offset);
    if (b !== null && Math.abs(b - beats.offset - t) <= thresholdSec) return b - beats.offset;
  }
  const candidates = [Math.round(t), Math.round(t * 2) / 2];
  // The playhead is also a target for aligning to the current time.
  if (playheadLocal !== undefined && playheadLocal >= 0) candidates.push(playheadLocal);
  let best: number | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = Math.abs(t - c);
    if (d <= thresholdSec && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best ?? Math.round(t * 100) / 100;
}


/*
  Subtrack labels come from ANIMATABLE in `config/tracks.ts` (`animatable(path).label`), keeping
  labels, ranges and steps together. The duplicate source of truth here was removed.
*/

/**
 * Fixed left-column width. The ruler, clips and playhead share this offset to stay aligned;
 * manually repeated offsets caused rows to drift.
 */
/*
  268 fits the arrow, name, duration, transition selector and action buttons (↑↓⧉✕). At 240,
  adding reorder arrows truncated names to "SHOT…": opacity-0 hover controls still take space.
*/
const GUTTER = 268;

export function Timeline() {
  const shots = useEditor((s) => s.shots);
  const activeShotId = useEditor((s) => s.activeShotId);
  const goToShot = useEditor((s) => s.goToShot);
  const duplicateShot = useEditor((s) => s.duplicateShot);
  const removeShot = useEditor((s) => s.removeShot);
  const moveShot = useEditor((s) => s.moveShot);
  const removeKeyframe = useEditor((s) => s.removeKeyframe);
  const removeTrackKeyframe = useEditor((s) => s.removeTrackKeyframe);
  const setShotDuration = useEditor((s) => s.setShotDuration);
  const setShotTransition = useEditor((s) => s.setShotTransition);
  const addShot = useEditor((s) => s.addShot);
  const patchCamera = useEditor((s) => s.patchCamera);
  const setMotion = useEditor((s) => s.setMotion);
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  /*
    NO PLAYHEAD SUBSCRIPTION HERE.
    Measured on RTX 5070 Ti: dragging in the timeline increased frame time p50 from 4.2 to 9.3 ms,
    with p95 25 ms and 10% of frames exceeding 16.7 ms. Hiding the timeline reduced the same drag
    to p50 6.5 / p95 16.6 ms: about half the cost came from this component rerendering. The
    playhead changes 60–120 times per second, rebuilding hundreds of clip/keyframe rows.
    Only the time display and cursor need the playhead during render. They subscribe independently
    in small components, so the rest no longer rerenders on playhead changes.
  */
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const recording = useEditor((s) => s.recording);
  const toggleRecording = useEditor((s) => s.toggleRecording);
  const loop = useEditor((s) => s.loop);
  const toggleLoop = useEditor((s) => s.toggleLoop);
  const clearKeyframes = useEditor((s) => s.clearKeyframes);
  const activeMotionId = useEditor((s) => s.active().motionId);
  const keyframeCount = useEditor((s) =>
    s.active().tracks.reduce((n, tr) => n + tr.keyframes.length, 0),
  );

  const [presetsOpen, setPresetsOpen] = useState(false);
  const presetsRef = useRef<HTMLDivElement>(null);
  /*
    Close Presets on Escape and outside clicks, matching the other dropdowns (top-bar menus,
    Select, context menu and emoji picker). Otherwise a 420 px layer stayed open over the
    timeline.
  */
  useEffect(() => {
    if (!presetsOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPresetsOpen(false);
    const onDown = (e: PointerEvent) => {
      const el = presetsRef.current;
      if (el && !el.contains(e.target as Node)) setPresetsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [presetsOpen]);
  /*
    SIMPLE / FULL timeline. Many users are unfamiliar with video editors; property tracks, gaps
    and diamonds add noise. Simple mode keeps scene rows and durations but hides tracks. The
    preference lasts for the session; persistent preferences will come with the backend.
  */
  const [simpleMode, setSimpleMode] = useState(false);
  const autoMotion = useEditor((s) => s.autoMotion);
  const selectedIds = useEditor((s) => s.selectedShotIds);
  const ctx = useContextMenu();
  const reverseShot = useEditor((s) => s.reverseShot);
  const loopShot = useEditor((s) => s.loopShot);
  const splitShot = useEditor((s) => s.splitShot);
  const clearTrack = useEditor((s) => s.clearTrack);
  const selectedKfs = useEditor((s) => s.selectedKfs);
  const selectKeyframe = useEditor((s) => s.selectKeyframe);
  const clearKfSelection = useEditor((s) => s.clearKfSelection);
  const setKeyframeEasing = useEditor((s) => s.setKeyframeEasing);
  /** Keyframe whose graph editor is open. */
  const [easingTarget, setEasingTarget] = useState<{
    shotId: string;
    path: string;
    id: string;
  } | null>(null);
  const removeTextIn = useEditor((s) => s.removeText);
  const audioTracks = useEditor((s) => s.audioTracks);
  const addAudio = useEditor((s) => s.addAudio);

  const removeAudioTrack = useEditor((s) => s.removeAudioTrack);
  /*
    MARQUEE selection. Plain dragging scrubs, so Shift+drag draws a rectangle and selects the
    diamonds inside it. Hit testing uses the DOM (`data-kf` on each diamond) to use actual screen
    positions without duplicating time/row calculations.
  */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  const marqueeRef = useRef<{ x0: number; y0: number } | null>(null);

  const setGapBefore = useEditor((s) => s.setGapBefore);
  /** Drag the gap from the scene's left edge. */
  const gapDrag = useRef<{ shotId: string; startX: number; from: number; perSec: number } | null>(
    null,
  );
  /** Audio strip drag: changes only the start time. */
  const audioDrag = useRef<{ id: string; startX: number; from: number; perSec: number } | null>(null);
  /** Auto-motion ruler marker: click to seek, drag to move. */
  const focusDrag = useRef<{ shotId: string; index: number; startX: number; from: number; perSec: number; moved: boolean } | null>(null);
  /*
    TEXT STRIP drag: drag the body to move, an edge to trim. As with keyframes, freeze px/s at
    drag start so ruler changes cannot move the handle away from the pointer.
  */
  /*
    Keep the drag starter at COMPONENT LEVEL. A factory inside map triggered the ref-during-render
    lint rule: the read occurs during the event, but the rule cannot infer that, and the pattern
    can easily become a real bug.
  */
  const textDrag = useRef<{
    shotId: string;
    textId: string;
    mode: 'move' | 'left' | 'right';
    startX: number;
    from: number;
    to: number;
    perSec: number;
    duration: number;
  } | null>(null);
  const selectShot = useEditor((s) => s.selectShot);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const laneRef = useRef<HTMLDivElement>(null);
  /*
    Ruler lane width in pixels determines label density. Measured after mount; initially 0 for
    hydration safety.
  */
  const [laneWidth, setLaneWidth] = useState(0);
  const scrubbing = useRef(false);
  // Trim duration from the clip's right edge. Freeze `perSec` at drag START:
  // the dynamic ruler changes px/s as duration grows, which otherwise
  // moves the handle away from the pointer during the drag.
  const trimming = useRef<{ shotId: string; startX: number; startDur: number; perSec: number } | null>(null);
  // Reorder scenes by dragging the row handle up or down.
  const rowDrag = useRef<{ shotId: string; lastY: number } | null>(null);
  /*
    KEYFRAME DRAG. The `moved` flag is required because diamonds can be dragged or clicked to
    delete. Without it, the click after each drag deleted the keyframe just moved.
  */
  /*
    Panel height is session-only. Persisting an enlarged panel could consume the editor on small
    screens; resetting to a reasonable default on each opening is safer.
  */
  const [panelH, setPanelH] = useState(240);
  const panelResize = useRef<{ startY: number; startH: number } | null>(null);
  const kfDrag = useRef<{
    shotId: string;
    path: string;
    id: string;
    startX: number;
    startT: number;
    perSec: number;
    moved: boolean;
    /** Move the selected group together. */
    group: boolean;
    /** Last applied time for calculating group-move deltas. */
    lastT: number;
  } | null>(null);

  const total = totalDuration(shots);
  /** Ruler covering the entire project; the zoom limit. */
  const fullSeconds = Math.max(MIN_RULER_SECONDS, Math.ceil(total + 0.5));

  /*
    TIMELINE ZOOM uses a time window.
    Wider row lanes in a shared horizontal scroller would require a sticky left column, shared
    scrollLeft and playhead alignment: a risky layout refactor in a 700-line component. Instead,
    `pct()` maps seconds to percentages within [viewStart, viewStart+viewSeconds]. Layout stays
    the same; zooming, panning and all drag calculations share one transform.
    Ctrl/Cmd+wheel zooms around the pointer; Shift+wheel pans. Maximum zoom is 8×.
  */
  const [viewSeconds, setViewSeconds] = useState<number | null>(null);
  const [viewStart, setViewStart] = useState(0);
  const span = Math.min(fullSeconds, viewSeconds ?? fullSeconds);
  const start = Math.min(Math.max(0, viewStart), Math.max(0, fullSeconds - span));
  // Keep the existing name: the number of ruler seconds currently visible.
  const rulerSeconds = span;
  const pct = (seconds: number) => `${((seconds - start) / span) * 100}%`;

  /*
    RULER LABEL SPACING is based on pixels.
    Labels every second work in the default 12 s window, but a 60 s project (20 scenes × 3 s)
    leaves about 16 px per second, merging "10S11S12S13S…" into an unreadable strip.
    Choose the step from px/s so each label gets at least MIN_LABEL_PX. `laneWidth` is measured
    after mount and initially 0, so the step falls back to 1 and server/client first frames match
    (#418).
  */
  const MIN_LABEL_PX = 34;
  const pxPerSec = laneWidth > 0 ? laneWidth / span : 0;
  const labelStep =
    pxPerSec > 0 ? ([1, 2, 5, 10, 15, 30, 60].find((s) => s * pxPerSec >= MIN_LABEL_PX) ?? 60) : 1;
  /* Ticks use half the label step, leaving one minor tick between labels. */
  const tickStep = labelStep / 2;

  /** Pointer position to seconds for scrubbing. */
  const seek = (clientX: number) => {
    const el = laneRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setPlayhead(Math.round((start + ratio * span) * 100) / 100);
  };

  /**
   * Wheel zoom/pan keeps the time beneath the pointer fixed.
   * ⚠️ React attaches `onWheel` through a passive root listener, silently ignoring
   * `preventDefault()` ("Unable to preventDefault inside passive event listener"). Ctrl+wheel
   * then zoomed both the timeline and browser, while Shift+wheel scrolled the panel. Attach the
   * listener manually with `{ passive: false }`, as with framing controls.
   */
  const onWheel = (e: WheelEvent) => {
    const el = laneRef.current;
    if (!el) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const anchor = start + ratio * span;
      // Maximum zoom 8×; minimum shows the entire project.
      const next = Math.min(fullSeconds, Math.max(fullSeconds / 8, span * (e.deltaY > 0 ? 1.15 : 0.87)));
      setViewSeconds(next);
      setViewStart(Math.min(Math.max(0, anchor - ratio * next), Math.max(0, fullSeconds - next)));
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      setViewStart((v) =>
        Math.min(Math.max(0, v + (e.deltaY / 400) * span), Math.max(0, fullSeconds - span)),
      );
    }
  };
  /*
    Attach the listener manually once. Its closure refreshes each render as span/start change;
    write the ref inside the effect, not during render.
  */
  const wheelRef = useRef(onWheel);
  useEffect(() => {
    wheelRef.current = onWheel;
  });
  useEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  /* Watch lane width: narrower windows require larger label steps. */
  useEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    setLaneWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setLaneWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Start dragging a text strip.
   * Like `seek`, this plain function is defined during render but reads the ref at EVENT TIME. A
   * factory inside map previously triggered the ref-during-render lint rule.
   */
  const beginTextDrag = (
    e: React.PointerEvent,
    mode: 'move' | 'left' | 'right',
    info: { shotId: string; textId: string; from: number; to: number; duration: number },
  ) => {
    const lane = laneRef.current;
    if (!lane) return;
    e.preventDefault();
    e.stopPropagation();
    const st = useEditor.getState();
    st.selectShot(info.shotId);
    st.selectText(info.textId);
    textDrag.current = {
      ...info,
      mode,
      startX: e.clientX,
      perSec: lane.getBoundingClientRect().width / span,
    };
  };

  const seekRef = useRef(seek);
  useEffect(() => {
    seekRef.current = seek;
  });
  /*
    BEATS. The window-level drag handler reads through a ref. With "Snap to beats" off, the list
    is null and snapping is disabled, but ruler markers remain visible.
  */
  const beatInfo = useProjectBeats();
  const beatSnap = useEditor((s) => s.beatSnap);
  const beatsRef = useRef<number[] | null>(null);
  useEffect(() => {
    beatsRef.current = beatSnap && beatInfo.beats.length ? beatInfo.beats : null;
  });

  // Window-level dragging keeps scrubbing/trimming active outside the lane.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (scrubbing.current) seekRef.current(e.clientX);
      const t = trimming.current;
      if (t) {
        const raw = t.startDur + (e.clientX - t.startX) / t.perSec;
        const st = useEditor.getState();
        let dur = Math.round(raw * 10) / 10;
        /*
          Snap the scene END to a beat (Alt disables snapping). Skip duration rounding for beat
          snaps: they are not multiples of 0.1, and rounding could shift cuts by up to 50 ms.
        */
        const bl = beatsRef.current;
        if (bl && !e.altKey) {
          const begin = shotStart(st.shots, t.shotId);
          const b = nearestBeat(bl, begin + raw);
          if (b !== null && Math.abs(b - begin - raw) <= 10 / Math.max(1, t.perSec)) dur = b - begin;
        }
        st.setShotDuration(t.shotId, dur);
      }
      const kd = kfDrag.current;
      if (kd) {
        const raw = kd.startT + (e.clientX - kd.startX) / kd.perSec;
        if (Math.abs(e.clientX - kd.startX) > 2) kd.moved = true;
        const st = useEditor.getState();
        const kdBegin = shotStart(st.shots, kd.shotId);
        const localPlayhead = st.playhead - kdBegin;
        const kdBeats: BeatSnap = beatsRef.current ? { list: beatsRef.current, offset: kdBegin } : null;
        if (kd.group) {
          /*
            GROUP MOVE. Compute the delta from the last applied time; assigning absolute time
            would pile all selected keyframes onto the same position each frame. Alt enables
            proportional retiming.
          */
          const target = e.altKey ? raw : snapSeconds(raw, kd.perSec, false, localPlayhead, kdBeats);
          const delta = target - kd.lastT;
          if (Math.abs(delta) > 0.0001) {
            st.moveSelectedKeyframes(delta, e.altKey);
            kd.lastT = target;
          }
        } else {
          st.moveTrackKeyframe(
            kd.shotId,
            kd.path,
            kd.id,
            snapSeconds(raw, kd.perSec, e.altKey, localPlayhead, kdBeats),
          );
        }
      }
      const td = textDrag.current;
      if (td) {
        const d = (e.clientX - td.startX) / td.perSec;
        const tdBeats: BeatSnap = beatsRef.current
          ? { list: beatsRef.current, offset: shotStart(useEditor.getState().shots, td.shotId) }
          : null;
        const snap = (v: number) => snapSeconds(v, td.perSec, e.altKey, undefined, tdBeats);
        let from = td.from;
        let to = td.to;
        if (td.mode === 'move') {
          const len = td.to - td.from;
          from = Math.min(Math.max(0, snap(td.from + d)), td.duration - len);
          to = from + len;
        } else if (td.mode === 'left') {
          from = Math.min(Math.max(0, snap(td.from + d)), td.to - 0.2);
        } else {
          to = Math.max(td.from + 0.2, Math.min(td.duration, snap(td.to + d)));
        }
        useEditor.getState().patchTextIn(td.shotId, td.textId, {
          start: Math.round(from * 100) / 100,
          end: Math.round(to * 100) / 100,
        });
      }
      const mq = marqueeRef.current;
      if (mq) {
        setMarquee({ x0: mq.x0, y0: mq.y0, x1: e.clientX, y1: e.clientY });
      }
      const gd = gapDrag.current;
      if (gd) {
        const raw = gd.from + (e.clientX - gd.startX) / gd.perSec;
        const st = useEditor.getState();
        const gs = st.shots.find((x) => x.id === gd.shotId);
        // Gaps are measured from the previous scene's end; beat time is local to that point.
        const gdBeats: BeatSnap =
          beatsRef.current && gs ? { list: beatsRef.current, offset: shotStart(st.shots, gd.shotId) - gs.gapBefore } : null;
        st.setGapBefore(gd.shotId, snapSeconds(Math.max(0, raw), gd.perSec, e.altKey, undefined, gdBeats));
      }
      const fd = focusDrag.current;
      if (fd) {
        if (Math.abs(e.clientX - fd.startX) > 2) fd.moved = true;
        if (fd.moved) {
          const st = useEditor.getState();
          const raw = fd.from + (e.clientX - fd.startX) / fd.perSec;
          // Also snap to beats to align auto-motion with music.
          const fdBeats: BeatSnap = beatsRef.current ? { list: beatsRef.current, offset: shotStart(st.shots, fd.shotId) } : null;
          st.moveFocusMark(fd.shotId, fd.index, snapSeconds(raw, fd.perSec, e.altKey, undefined, fdBeats));
        }
      }
      const ad = audioDrag.current;
      if (ad) {
        const raw = ad.from + (e.clientX - ad.startX) / ad.perSec;
        useEditor
          .getState()
          .patchAudio(ad.id, { start: Math.max(0, snapSeconds(raw, ad.perSec, e.altKey)) });
      }
      const pr = panelResize.current;
      if (pr) {
        const next = pr.startH + (pr.startY - e.clientY);
        setPanelH(Math.min(Math.round(window.innerHeight * 0.5), Math.max(150, next)));
      }
      const rd = rowDrag.current;
      if (rd) {
        // 32 px is one row height; crossing the threshold swaps adjacent rows.
        const dy = e.clientY - rd.lastY;
        if (Math.abs(dy) > 32) {
          useEditor.getState().moveShot(rd.shotId, dy > 0 ? 1 : -1);
          rd.lastY = e.clientY;
        }
      }
    };
    const up = () => {
      if (marqueeRef.current) {
        const box = marqueeRef.current;
        marqueeRef.current = null;
        setMarquee((cur) => {
          if (cur) {
            const left = Math.min(cur.x0, cur.x1);
            const right = Math.max(cur.x0, cur.x1);
            const top = Math.min(cur.y0, cur.y1);
            const bottom = Math.max(cur.y0, cur.y1);
            const hits: string[] = [];
            document.querySelectorAll<HTMLElement>('[data-kf]').forEach((el) => {
              const r = el.getBoundingClientRect();
              const cx = r.x + r.width / 2;
              const cy = r.y + r.height / 2;
              if (cx >= left && cx <= right && cy >= top && cy <= bottom) {
                const key = el.dataset.kf;
                if (key) hits.push(key);
              }
            });
            if (hits.length) useEditor.setState({ selectedKfs: hits });
          }
          return null;
        });
        void box;
      }
      scrubbing.current = false;
      trimming.current = null;
      rowDrag.current = null;
      panelResize.current = null;
      textDrag.current = null;
      audioDrag.current = null;
      gapDrag.current = null;
      const fd = focusDrag.current;
      if (fd) {
        focusDrag.current = null;
        // If no drag occurred, treat it as a click and seek to that target.
        if (!fd.moved) {
          const st = useEditor.getState();
          const sh = st.shots.find((x) => x.id === fd.shotId);
          const m = sh?.focusMarks?.[fd.index];
          if (m) {
            st.setPlaying(false);
            st.setPlayhead(shotStart(st.shots, fd.shotId) + m.t);
          }
        }
      }
      // Keep the drag result until the next click: its handler checks
      // `moved` to prevent deletion.
      if (kfDrag.current) window.setTimeout(() => (kfDrag.current = null), 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  return (
    <div
      className="relative flex shrink-0 flex-col select-none"
      style={{
        height: panelH,
        borderRadius: 'var(--mp-radius-lg)',
        border: '1px solid var(--mp-border)',
        background: 'var(--mp-glass)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/*
        HEIGHT HANDLE. Expanding property tracks used to squeeze them into a fixed-height
        timeline, making five scenes' tracks impossible to view together. Drag the top edge upward
        to enlarge it. Minimum: toolbar + ruler + one row; maximum: half the screen.
      */}
      <div
        onPointerDown={(e) => {
          e.preventDefault();
          panelResize.current = { startY: e.clientY, startH: panelH };
        }}
        title="Drag to resize the timeline"
        className="absolute inset-x-0 -top-1 z-20 h-2 cursor-ns-resize"
      />

      <ContextMenu menu={ctx.menu} onClose={ctx.close} />
      {easingTarget ? (
        <EasingGraph target={easingTarget} onClose={() => setEasingTarget(null)} />
      ) : null}

      {/* Selection rectangle: fixed because coordinates are in screen space. */}
      {marquee ? (
        <div
          className="pointer-events-none fixed z-[800]"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
            border: '1px solid var(--mp-accent)',
            background: 'color-mix(in srgb, var(--mp-accent) 15%, transparent)',
            borderRadius: 2,
          }}
        />
      ) : null}

      {/* --- Toolbar --- */}
      <div className="flex items-center gap-1.5 px-2" style={{ height: 44 }}>
        {/*
          Zoom indicator and one-click fit let users recognize accidental zoom changes and reset
          them immediately.
        */}
        {span < fullSeconds - 0.01 ? (
          <button
            className="mp-topbtn"
            onClick={() => {
              setViewSeconds(null);
              setViewStart(0);
            }}
            title="Reset zoom to fit the whole project"
          >
            {`${(fullSeconds / span).toFixed(1)}×`}
          </button>
        ) : null}
        <button
          className="mp-topbtn"
          onClick={() => setSimpleMode((v) => !v)}
          data-active={simpleMode}
          title={
            simpleMode
              ? 'Simple timeline — property tracks hidden'
              : 'Full timeline — property tracks visible'
          }
        >
          {simpleMode ? 'Simple' : 'Full'}
        </button>
        {/*
          AUTO-MOTION: draw focus areas on screen, then Compose creates editable camera keyframes
          that visit them in sequence.
        */}
        <button
          className="mp-topbtn"
          onClick={() => useEditor.setState((s) => ({ autoMotion: !s.autoMotion, playing: false }))}
          data-active={autoMotion}
          title="Draw focus areas on your screen and generate a camera move"
        >
          Auto-motion
        </button>
        <div className="relative" ref={presetsRef}>
          <button className="mp-topbtn" onClick={() => setPresetsOpen((v) => !v)} data-active={presetsOpen}>
            Presets
            <span className="ml-1.5">
              <Chevron open={presetsOpen} />
            </span>
          </button>

          {presetsOpen ? (
            <div
              className="mp-scroll absolute bottom-full left-0 z-50 mb-2 grid max-h-80 w-[420px] grid-cols-2 gap-1.5 overflow-y-auto p-2"
              style={{
                background: 'var(--mp-dropdown)',
                border: '1px solid var(--mp-border)',
                borderRadius: 'var(--mp-radius-lg)',
                boxShadow: 'var(--mp-shadow-dropdown)',
              }}
            >
              {MOTION_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    /*
                      If the previous preset rotated the DEVICE (fold-up rotX, hero-turn rotY),
                      that camera field retained its first-keyframe value. A new preset that did
                      not write it left the device tilted/rotated. Reset only fields driven by the
                      previous preset, preserving manual rotation.
                    */
                    const prev = MOTION_PRESETS.find((m) => m.id === activeMotionId);
                    const reset: { rotX?: number; rotY?: number } = {};
                    for (const k of ['rotX', 'rotY'] as const) {
                      if (prev?.keys.some((key) => key.camera[k] !== undefined)) reset[k] = 0;
                    }
                    /*
                      Presets appeared ineffective on scenes with CAMERA KEYFRAMES because Stage
                      gives camera tracks priority. All opening demo scenes have keyframes.
                      Selecting a preset means using that camera motion: remove CAMERA tracks,
                      keep blur/light/effect tracks, explain in a toast, and allow Ctrl+Z to
                      restore them.
                    */
                    // With multiple scenes selected, filter each scene's OWN tracks (see dropCameraTracks).
                    const dropped = useEditor.getState().dropCameraTracks();
                    if (dropped) {
                      toast(
                        dropped > 1
                          ? `${p.label}: replaced camera keyframes in ${dropped} scenes · Ctrl+Z to undo`
                          : `${p.label}: replaced this scene's camera keyframes · Ctrl+Z to undo`,
                      );
                    }
                    setMotion(p.id);
                    patchCamera({ ...reset, ...p.keys[0].camera });
                    setPresetsOpen(false);
                    // Preview from the SELECTED scene's start. Starting at 0 made users
                    // watch scenes 1 and 2 before seeing a preset applied to scene 3.
                    {
                      const st = useEditor.getState();
                      setPlayhead(shotStart(st.shots, st.activeShotId));
                    }
                    setPlaying(true);
                  }}
                  className="p-2 text-left transition-colors"
                  style={{
                    background: 'var(--mp-surface)',
                    borderRadius: 'var(--mp-radius)',
                    border: `1px solid ${activeMotionId === p.id ? 'var(--mp-accent)' : 'transparent'}`,
                  }}
                >
                  {/* CSS-animated preview approximates the preset's camera path. */}
                  <span className="mp-glyph mb-1.5 h-16 w-full" data-anim={p.id}>
                    <span />
                  </span>
                  <span className="mp-label flex items-center justify-between">
                    {p.label}
                    <span style={{ color: 'var(--mp-text-tertiary)' }}>{p.duration}s</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          onClick={toggleRecording}
          data-tour="record"
          className="mp-topbtn"
          style={recording ? { background: '#e5484d1f', color: '#e5484d' } : undefined}
          title="While on, every camera change is recorded at the playhead"
        >
          <span
            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full"
            style={{
              background: recording ? '#e5484d' : 'var(--mp-text-tertiary)',
              boxShadow: recording ? '0 0 0 3px #e5484d33' : undefined,
            }}
          />
          {recording ? 'Recording' : 'Record'}
        </button>

        {/* BEATS: only when an audio track is present. */}
        <BeatsMenu />

        {keyframeCount > 0 ? (
          <button onClick={clearKeyframes} className="mp-topbtn" style={{ color: 'var(--mp-text-tertiary)' }}>
            {keyframeCount} key ✕
          </button>
        ) : null}

        {/* Transport controls: centered. */}
        <div className="flex flex-1 items-center justify-center gap-2">
          <button
            onClick={() => {
              setPlaying(false);
              setPlayhead(0);
            }}
            className="grid h-7 w-7 place-items-center rounded-lg"
            style={{ background: 'var(--mp-surface)' }}
            aria-label="Rewind"
            title="Go to start (Home)"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="2.5" y="2.5" width="1.6" height="7" fill="currentColor" />
              <path d="M10 2.5v7L5 6l5-3.5Z" fill="currentColor" />
            </svg>
          </button>

          <button
            onClick={() => {
              // READ at event time: subscribing to the playhead during render
              // rerendered the entire timeline every frame.
              if (!playing && useEditor.getState().playhead >= total - 0.05) setPlayhead(0);
              setPlaying(!playing);
            }}
            className="grid h-8 w-8 place-items-center rounded-lg"
            style={{ background: playing ? 'var(--mp-accent)' : 'var(--mp-surface-active)' }}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
          >
            <span style={{ color: playing ? '#fff' : 'var(--mp-text-primary)' }}>
              {playing ? (
                <svg width="13" height="13" viewBox="0 0 12 12">
                  <rect x="3" y="2.5" width="2" height="7" fill="currentColor" />
                  <rect x="7" y="2.5" width="2" height="7" fill="currentColor" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 12 12">
                  <path d="M4 2.5v7l6-3.5-6-3.5Z" fill="currentColor" />
                </svg>
              )}
            </span>
          </button>

          <PlayheadTime total={total} />

          {/* Loop: when off, playback stops at the end for single previews and recording. */}
          <button
            onClick={toggleLoop}
            className="grid h-7 w-7 place-items-center rounded-lg"
            style={{
              background: loop ? 'var(--mp-surface-active)' : 'var(--mp-surface)',
              color: loop ? 'var(--mp-text-primary)' : 'var(--mp-text-tertiary)',
            }}
            title={loop ? 'Loop on — playback repeats' : 'Loop off — playback stops at end'}
            aria-label="Toggle loop"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path
                d="M4.5 3.5h5a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3h-5a3 3 0 0 1-3-3v0a3 3 0 0 1 3-3Z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path d="m6 1.8-1.8 1.7L6 5.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <button className="mp-topbtn" onClick={addShot} title="Add a scene — starts with this scene's look">
          + Scene
        </button>
      </div>

      {/*
        Ruler and tracks share an aligned area. `min-h-0 flex-1 overflow-y-auto` scrolls
        overflowing content instead of clipping it when the user resizes the panel.
      */}
      <div
        className="mp-scroll relative min-h-0 flex-1 overflow-y-auto"
        style={{ borderTop: '1px solid var(--mp-surface-subtle)' }}
      >
        {/* Playhead: one continuous line from the ruler to the bottom. */}
        <PlayheadCursor rulerSeconds={rulerSeconds} pct={pct} />

        {/* Ruler */}
        <div className="flex" style={{ height: 22 }}>
          <div className="shrink-0" style={{ width: GUTTER }} />
          <div
            ref={laneRef}
            className="relative flex-1 cursor-ew-resize"
            onPointerDown={(e) => {
              scrubbing.current = true;
              setPlaying(false);
              // Clicking the ruler clears the selection.
              clearKfSelection();
              seek(e.clientX);
            }}
          >
            {/*
               Render ticks only in the VISIBLE range to avoid hundreds of invisible elements when
               zoomed in.
             */}
            {Array.from({ length: Math.floor(span / tickStep) + 2 }, (_, i) => {
              const t = Math.floor(start / tickStep) * tickStep + i * tickStep;
              /* Major tick: a label position. */
              const major = Math.abs(t / labelStep - Math.round(t / labelStep)) < 0.001;
              return (
                <span
                  key={i}
                  className="absolute bottom-0"
                  style={{
                    left: pct(t),
                    width: 1,
                    height: major ? 8 : 4,
                    background: 'var(--mp-border-hover)',
                    opacity: major ? 0.9 : 0.5,
                  }}
                />
              );
            })}
            {Array.from({ length: Math.floor(span / labelStep) + 2 }, (_, i) => {
              const t = Math.ceil(start / labelStep) * labelStep + i * labelStep;
              /*
                Skip positions outside the window: the last label could extend past the ruler and
                overlap clips.
              */
              if (t > start + span + 1e-6) return null;
              return (
                <span
                  key={i}
                  className="mp-label absolute top-0.5"
                  style={{ left: `calc(${pct(t)} + 3px)`, fontSize: 9, color: 'var(--mp-text-tertiary)' }}
                >
                  {t}s
                </span>
              );
            })}
            {/*
              AUTO-MOTION MARKERS: numbered camera target times at each focus area. Click to
              seek; drag to move that target's camera keyframes (snaps to beats; Alt disables
              snapping). Hide the marker if its target keyframe was manually deleted.
            */}
            {shots.flatMap((sh) => {
              const marks = sh.focusMarks ?? [];
              if (!marks.length) return [];
              const begin = shotStart(shots, sh.id);
              const cam = sh.tracks.filter((tr) => tr.path.startsWith('camera.'));
              return marks.map((m, i) =>
                cam.some((tr) => tr.keyframes.some((k) => Math.abs(k.t - m.t) < 0.02)) &&
                begin + m.t >= start - 0.01 &&
                begin + m.t <= start + span + 0.01 ? (
                  <button
                    key={`${sh.id}-fm-${i}`}
                    data-focus-mark={`${sh.id}|${i}`}
                    title={`Focus ${i + 1} — camera arrives at ${m.t.toFixed(2)}s · click to jump, drag to move (Alt: no snap)`}
                    onPointerDown={(e) => {
                      const lane = laneRef.current;
                      if (!lane) return;
                      e.preventDefault();
                      e.stopPropagation();
                      focusDrag.current = {
                        shotId: sh.id,
                        index: i,
                        startX: e.clientX,
                        from: m.t,
                        perSec: lane.getBoundingClientRect().width / span,
                        moved: false,
                      };
                    }}
                    className="absolute z-10 grid h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center"
                    style={{
                      // Below the label row (top ~12 px) to avoid overlapping second labels.
                      top: 15,
                      left: pct(begin + m.t),
                      borderRadius: 999,
                      background: '#f5a524',
                      color: '#1a1408',
                      fontSize: 8,
                      fontWeight: 700,
                      lineHeight: 1,
                    }}
                  >
                    {i + 1}
                  </button>
                ) : null,
              );
            })}
            {/*
              BEAT MARKERS: accent-colored dots along the ruler's bottom edge. Thin them when
              spacing is < 4 px per beat. `data-beat` carries time; tests/test-beats.mjs reads
              marker pixel positions.
            */}
            {(() => {
              const list = beatInfo.beats;
              if (!list.length || pxPerSec <= 0) return null;
              const gap = list.length > 1 ? (list[list.length - 1] - list[0]) / (list.length - 1) : 1;
              const every = Math.max(1, Math.ceil(4 / Math.max(0.001, gap * pxPerSec)));
              return list.map((b, i) =>
                i % every === 0 && b >= start - 0.01 && b <= start + span + 0.01 ? (
                  <span
                    key={i}
                    data-beat={b.toFixed(3)}
                    className="pointer-events-none absolute bottom-0"
                    style={{
                      left: pct(b),
                      width: 3,
                      height: 3,
                      marginLeft: -1.5,
                      borderRadius: 2,
                      background: 'var(--mp-accent)',
                      opacity: beatSnap ? 0.9 : 0.4,
                    }}
                  />
                ) : null,
              );
            })()}
          </div>
        </div>

        {/* Tracks */}
        <div
          className="pb-1.5"
          onPointerDown={(e) => {
            // Shift only: plain dragging moves scenes/keyframes.
            if (!e.shiftKey) return;
            e.preventDefault();
            marqueeRef.current = { x0: e.clientX, y0: e.clientY };
            setMarquee({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
          }}
        >
          {shots.map((shot, i) => {
            // Gaps count toward duration: scene starts include gapBefore.
            const start = shots
              .slice(0, i + 1)
              .reduce((sum, s, k) => sum + (s.gapBefore ?? 0) + (k < i ? s.duration : 0), 0);
            const gap = shot.gapBefore ?? 0;
            const isActive = shot.id === activeShotId;
            // Property tracks: one row per animatable field.
            const tracks = shot.tracks;
            return (
              <div key={shot.id}>
              <div
                className="group relative flex items-center"
                style={{
                  height: 32,
                  background: isActive || selectedIds.includes(shot.id) ? 'var(--mp-surface-subtle)' : undefined,
                  boxShadow: selectedIds.includes(shot.id) ? 'inset 3px 0 0 var(--mp-accent)' : undefined,
                }}
                /*
                  SCENE CONTEXT MENU. Reverse and split already existed in the store but needed UI
                  entry points to be usable.
                */
                onContextMenu={ctx.open([
                  {
                    label: 'Split at playhead',
                    onSelect: () => {
                      selectShot(shot.id);
                      if (!splitShot()) toast('Move the playhead inside the scene first');
                    },
                  },
                  { label: 'Reverse animation', onSelect: () => reverseShot(shot.id) },
                  {
                    label: 'Make seamless loop',
                    onSelect: () =>
                      toast(
                        loopShot(shot.id)
                          ? 'Seamless loop: forward, then back to the first frame · Ctrl+Z to undo'
                          : 'Nothing animates in this scene yet — add a camera move or keyframes first',
                      ),
                  },
                  { label: 'Duplicate', onSelect: () => duplicateShot(shot.id) },
                  {
                    label: 'Delete scene',
                    danger: true,
                    onSelect: () => removeShot(shot.id),
                    disabled: shots.length < 2,
                  },
                ])}
              >
                {/* Left column */}
                <div className="relative flex shrink-0 items-center gap-1" style={{ width: GUTTER }}>
                  <span
                    className="w-1 self-stretch"
                    style={{ background: isActive ? 'var(--mp-accent)' : 'transparent' }}
                  />
                  {/* Drag handle: pull up/down to move the scene. */}
                  <span
                    onPointerDown={(e) => {
                      e.preventDefault();
                      rowDrag.current = { shotId: shot.id, lastY: e.clientY };
                    }}
                    title="Drag to reorder"
                    className="mp-label cursor-grab select-none px-0.5"
                    style={{ color: 'var(--mp-text-tertiary)', letterSpacing: '-1px' }}
                  >
                    ⠿
                  </span>
                  <button
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [shot.id]: !prev[shot.id] }))
                    }
                    className="grid h-4 w-4 shrink-0 place-items-center"
                    style={{
                      color: 'var(--mp-text-tertiary)',
                      transform: expanded[shot.id] ? 'rotate(90deg)' : undefined,
                      transition: 'transform .15s',
                    }}
                    aria-label={expanded[shot.id] ? 'Collapse scene' : 'Expand scene'}
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <path d="M3 1.5 5.5 4 3 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      // Shift selects a range; Ctrl/⌘ selects individually for editing scenes TOGETHER.
                      if (e.shiftKey) return useEditor.getState().selectShotMulti(shot.id, 'range');
                      if (e.ctrlKey || e.metaKey) return useEditor.getState().selectShotMulti(shot.id, 'toggle');
                      useEditor.getState().clearShotSelection();
                      goToShot(shot.id);
                    }}
                    className="mp-label flex-1 truncate px-1 text-left"
                    style={{ color: isActive ? 'var(--mp-text-primary)' : undefined }}
                  >
                    {shot.label}
                  </button>
                  <input
                    type="number"
                    min={0.5}
                    max={12}
                    step={0.5}
                    // Beat-aligned durations need not be multiples of 0.1 (2.2412…); show 2 decimal places.
                    value={Math.round(shot.duration * 100) / 100}
                    onChange={(e) => setShotDuration(shot.id, Number(e.target.value))}
                    /*
                      Hide number spinners: Chrome reserved space even when they were invisible,
                      separating the right-aligned number from its unit ("4 S"). Typing and arrow
                      keys still work; duration can also be dragged from the clip edge.
                    */
                    className="mp-label w-7 bg-transparent text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    style={{ color: 'var(--mp-text-tertiary)' }}
                    title="Scene duration (s)"
                    aria-label={`${shot.label} duration in seconds`}
                  />
                  {/* Use the SAME font size for number and unit: at 9 px the shifted baseline read as "4ˢ". */}
                  <span className="mp-label mr-1.5" style={{ color: 'var(--mp-text-tertiary)', marginLeft: 1 }}>
                    s
                  </span>
                  {/* Incoming transition for this scene. */}
                  <select
                    value={shot.transition?.kind ?? 'cut'}
                    onChange={(e) =>
                      setShotTransition(shot.id, {
                        kind: e.target.value as 'cut' | 'fade' | 'slide',
                      })
                    }
                    className="mp-label cursor-pointer bg-transparent outline-none"
                    style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}
                    title="Transition"
                  >
                    <option value="cut">CUT</option>
                    <option value="fade">FADE</option>
                    <option value="slide">SLIDE</option>
                  </select>
                  {/* Transition duration: users should be able to choose its speed as well as its type. */}
                  {shot.transition?.kind && shot.transition.kind !== 'cut' ? (
                    <input
                      type="number"
                      min={0.1}
                      max={2}
                      step={0.1}
                      value={shot.transition.duration}
                      onChange={(e) =>
                        setShotTransition(shot.id, { duration: Number(e.target.value) })
                      }
                      className="mp-label w-7 bg-transparent text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}
                      title="Transition duration (s)"
                      aria-label={`Transition into ${shot.label}, seconds`}
                    />
                  ) : null}
                  {/*
                    Overlay hover controls. In normal flow they truncated scene names to 'S…',
                    especially after adding fade and duration inputs. An overlay leaves the full
                    label visible.
                  */}
                  <span
                    className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center rounded px-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ background: 'var(--mp-dropdown)', boxShadow: 'var(--mp-shadow)' }}
                  >
                    <button
                      onClick={() => moveShot(shot.id, -1)}
                      title="Move scene up"
                      disabled={i === 0}
                      className="mp-label px-0.5 disabled:opacity-30"
                      style={{ color: 'var(--mp-text-tertiary)' }}
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveShot(shot.id, 1)}
                      title="Move scene down"
                      disabled={i === shots.length - 1}
                      className="mp-label px-0.5 disabled:opacity-30"
                      style={{ color: 'var(--mp-text-tertiary)' }}
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => duplicateShot(shot.id)}
                      title="Duplicate scene"
                      className="mp-label px-1"
                      style={{ color: 'var(--mp-text-tertiary)' }}
                    >
                      ⧉
                    </button>
                    {/*
                      The final scene cannot be deleted (`removeShot` rejects it). Disable the
                      button as in the context menu, so single-scene projects do not show
                      conflicting controls.
                    */}
                    <button
                      onClick={() => removeShot(shot.id)}
                      title="Delete scene"
                      disabled={shots.length < 2}
                      className="mp-label px-1 disabled:opacity-30"
                      style={{ color: 'var(--mp-text-tertiary)' }}
                    >
                      ✕
                    </button>
                  </span>
                </div>

                {/* Clip strip */}
                <div className="relative h-full flex-1">
                  <button
                    onClick={(e) => {
                      // Shift selects a range; Ctrl/⌘ selects individually for editing scenes TOGETHER.
                      if (e.shiftKey) return useEditor.getState().selectShotMulti(shot.id, 'range');
                      if (e.ctrlKey || e.metaKey) return useEditor.getState().selectShotMulti(shot.id, 'toggle');
                      useEditor.getState().clearShotSelection();
                      goToShot(shot.id);
                    }}
                    /*
                      MISSING MEDIA: faded body with a dashed amber border makes scenes with
                      missing files immediately visible.
                    */
                    data-missing={!shot.media && !!shot.mediaName}
                    className="absolute top-1/2 flex h-[22px] -translate-y-1/2 items-center overflow-hidden px-2 transition-colors"
                    style={{
                      left: pct(start),
                      width: pct(shot.duration),
                      borderRadius: 5,
                      background: isActive ? 'var(--mp-accent)' : 'var(--mp-surface-active)',
                      color: isActive ? '#fff' : 'var(--mp-text-label)',
                      ...(!shot.media && shot.mediaName
                        ? {
                            opacity: 0.6,
                            border: '1px dashed rgba(255,170,60,0.9)',
                            filter: 'saturate(0.4)',
                          }
                        : null),
                    }}
                  >
                    {/*
                      Except on the first scene, a 15 px transition button is centered on the
                      clip's left edge. px-2 crowded the name against it ("(|)LUMEN"); start the
                      name beyond the button.
                    */}
                    <span className="mp-label truncate" style={{ color: 'inherit', paddingLeft: i > 0 ? 6 : 0 }}>
                      {!shot.media && shot.mediaName ? `⚠ ${shot.label}` : shot.label}
                    </span>
                  </button>

                  {/*
                    TRIM HANDLE: drag the clip's right edge to change duration. Keep the number
                    input, but allow direct timeline editing; its 0.5 step and tiny size were
                    limiting.
                  */}
                  <span
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const lane = laneRef.current?.getBoundingClientRect();
                      trimming.current = {
                        shotId: shot.id,
                        startX: e.clientX,
                        startDur: shot.duration,
                        // Freeze the ratio at drag start so the dynamic ruler cannot
                        // move the handle away when it expands during the drag.
                        perSec: (lane?.width ?? 800) / rulerSeconds,
                      };
                    }}
                    title="Drag to trim duration"
                    className="absolute top-1/2 z-20 h-[22px] w-[7px] -translate-y-1/2 cursor-ew-resize"
                    style={{
                      left: `calc(${pct(start + shot.duration)} - 4px)`,
                      borderRadius: 2,
                      background: isActive ? 'var(--mp-accent-deep, var(--mp-accent))' : 'var(--mp-border-hover)',
                    }}
                  />

                  {/*
                    TRANSITION SEAM: show the transition between TWO SCENES rather than as one
                    scene's property. Click toggles cut ↔ fade; right-click offers all three
                    options. Row number inputs remain for precise duration adjustments.
                  */}
                  {/*
                    GAP: a light orange strip. Right-click closes it; drag its right edge to
                    resize. No scene appears during a gap, allowing pauses when working with
                    music.
                  */}
                  {gap > 0 ? (
                    <div
                      title={`Gap ${gap.toFixed(2)}s — drag right edge, right click to close`}
                      onContextMenu={ctx.open([
                        { label: 'Close gap', onSelect: () => setGapBefore(shot.id, 0) },
                      ])}
                      className="absolute top-1/2 h-[10px] -translate-y-1/2"
                      style={{
                        left: pct(start - gap),
                        width: `calc(${pct(start)} - ${pct(start - gap)})`,
                        background: 'rgba(255,170,60,0.35)',
                        border: '1px dashed rgba(255,170,60,0.9)',
                        borderRadius: 2,
                      }}
                    />
                  ) : null}
                  {i > 0 ? (
                    <span
                      onPointerDown={(e) => {
                        const lane = laneRef.current;
                        if (!lane) return;
                        e.preventDefault();
                        e.stopPropagation();
                        gapDrag.current = {
                          shotId: shot.id,
                          startX: e.clientX,
                          from: gap,
                          perSec: lane.getBoundingClientRect().width / span,
                        };
                      }}
                      title="Drag to add a gap before this scene"
                      className="absolute top-1/2 h-[16px] w-[6px] -translate-x-full -translate-y-1/2 cursor-ew-resize"
                      style={{ left: pct(start), background: 'transparent' }}
                    />
                  ) : null}
                  {i > 0 ? (
                    <button
                      onClick={() =>
                        setShotTransition(shot.id, {
                          kind: (shot.transition?.kind ?? 'cut') === 'cut' ? 'fade' : 'cut',
                        })
                      }
                      onContextMenu={ctx.open([
                        { label: 'Cut', onSelect: () => setShotTransition(shot.id, { kind: 'cut' }) },
                        { label: 'Fade', onSelect: () => setShotTransition(shot.id, { kind: 'fade' }) },
                        { label: 'Slide', onSelect: () => setShotTransition(shot.id, { kind: 'slide' }) },
                      ])}
                      title={`Transition into ${shot.label}: ${shot.transition?.kind ?? 'cut'} — click to toggle, right click for all`}
                      className="absolute top-1/2 z-20 grid h-[15px] w-[15px] -translate-x-1/2 -translate-y-1/2 place-items-center"
                      style={{
                        left: pct(start),
                        borderRadius: 999,
                        background:
                          (shot.transition?.kind ?? 'cut') === 'cut'
                            ? 'var(--mp-surface-active)'
                            : 'var(--mp-accent)',
                        border: '1px solid var(--mp-border-hover)',
                      }}
                    >
                      <span
                        className="mp-label"
                        style={{
                          fontSize: 8,
                          color:
                            (shot.transition?.kind ?? 'cut') === 'cut'
                              ? 'var(--mp-text-tertiary)'
                              : '#fff',
                        }}
                      >
                        {(shot.transition?.kind ?? 'cut') === 'cut' ? '|' : '◑'}
                      </span>
                    </button>
                  ) : null}

                  {/*
                    Scene-row diamonds combine keyframe times from ALL tracks. Clicking deletes
                    ALL property keyframes at that time; expand the scene and use a property row
                    to delete individually.
                    Place diamonds at the clip's BOTTOM EDGE: centered diamonds obscured names
                    ("R◇KS"), and the t=0 diamond overlapped the transition button. A 22 px clip
                    in a 32 px row leaves room for the edge diamond.
                  */}
                  {[...new Set(tracks.flatMap((tr) => tr.keyframes.map((k) => k.t)))].map((t) => (
                    <button
                      key={t}
                      onClick={() => removeKeyframe(shot.id, t)}
                      title={`Delete keyframes @ ${t.toFixed(2)}s`}
                      className="absolute z-10 h-[8px] w-[8px] -translate-x-1/2 -translate-y-1/2 rotate-45 hover:scale-125"
                      style={{
                        top: 'calc(50% + 10px)',
                        left: pct(start + Math.min(t, shot.duration)),
                        background: '#fff',
                        border: '1px solid var(--mp-accent-deep)',
                        borderRadius: 1,
                        transition: 'transform .1s',
                      }}
                    />
                  ))}
                </div>
              </div>

              {/*
                SUBTRACKS appear directly beneath their scene. Appending them after all scenes
                made scene 1's tracks appear below scene 2, obscuring ownership. Each camera field
                now shows its own keyframe positions.
              */}
              {!simpleMode && expanded[shot.id] && tracks.length === 0 ? (
                <div className="flex items-center" style={{ height: 24 }}>
                  <span
                    className="mp-label shrink-0 pl-8"
                    style={{ width: GUTTER, color: 'var(--mp-text-tertiary)', fontSize: 9 }}
                  >
                    no keyframes
                  </span>
                </div>
              ) : null}

              {/*
                TEXT STRIPS. The model stores start/end times; users can move and trim them here.
                Drag the body to move, an edge to trim; Alt disables snapping.
              */}
              {!simpleMode &&
                expanded[shot.id] &&
                shot.texts.map((tx) => {
                  const from = tx.start ?? 0;
                  const to = tx.end ?? shot.duration;
                  // Keep drag state in one place and handlers INLINE in JSX
                  // (a factory function triggered the ref lint rule).
                  const info = {
                    shotId: shot.id,
                    textId: tx.id,
                    from,
                    to,
                    duration: shot.duration,
                  };
                  return (
                    <div key={`${shot.id}-${tx.id}`} className="flex items-center" style={{ height: 22 }}>
                      <span
                        className="mp-label shrink-0 truncate pl-8"
                        style={{ width: GUTTER, color: 'var(--mp-text-tertiary)', fontSize: 9 }}
                        title={`${tx.kind === 'ticker' ? 'Ticker' : tx.kind === 'logo' ? 'Logo' : 'Text'}: ${tx.text}`}
                        onContextMenu={ctx.open([
                          {
                            label: 'Delete text',
                            danger: true,
                            onSelect: () => {
                              selectShot(shot.id);
                              removeTextIn(tx.id);
                            },
                          },
                        ])}
                      >
                        {tx.kind === 'ticker' ? '▤ ' : tx.kind === 'logo' ? '◆ ' : 'T '}
                        {tx.text || 'Text'}
                      </span>
                      <div className="relative h-full flex-1">
                        <div
                          onPointerDown={(e) => beginTextDrag(e, 'move', info)}
                          title="Drag to move · edges to trim (Alt: no snap)"
                          className="absolute top-1/2 h-[14px] -translate-y-1/2 cursor-grab"
                          style={{
                            left: pct(start + from),
                            width: `calc(${pct(start + to)} - ${pct(start + from)})`,
                            background: 'var(--mp-surface-active)',
                            border: '1px solid var(--mp-border-hover)',
                            borderRadius: 3,
                          }}
                        >
                          <span
                            onPointerDown={(e) => beginTextDrag(e, 'left', info)}
                            className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize"
                            style={{ background: 'var(--mp-accent)', borderRadius: '3px 0 0 3px' }}
                          />
                          <span
                            onPointerDown={(e) => beginTextDrag(e, 'right', info)}
                            className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize"
                            style={{ background: 'var(--mp-accent)', borderRadius: '0 3px 3px 0' }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}

              {!simpleMode &&
                expanded[shot.id] &&
                tracks.map((track) => (
                  <div key={`${shot.id}-${track.path}`} className="flex items-center" style={{ height: 22 }}>
                <span
                  className="mp-label shrink-0 truncate pl-8"
                  style={{ width: GUTTER, color: 'var(--mp-text-tertiary)', fontSize: 9 }}
                  title={`${track.path} — right click to clear`}
                  /* TRACK CONTEXT MENU: clear the entire animation in one action. */
                  onContextMenu={ctx.open([
                    {
                      label: `Clear ${trackLabel(track.path, shot)}`,
                      danger: true,
                      onSelect: () => {
                        selectShot(shot.id);
                        clearTrack(track.path);
                      },
                    },
                  ])}
                >
                  {trackLabel(track.path, shot)}
                </span>
                <div className="relative h-full flex-1">
                  <span
                    className="absolute top-1/2 h-px -translate-y-1/2"
                    style={{
                      left: pct(start),
                      width: pct(shot.duration),
                      background: 'var(--mp-surface-active)',
                    }}
                  />
                  {track.keyframes.map((k) => (
                      <button
                        key={k.id}
                        data-kf={`${shot.id}|${track.path}|${k.id}`}
                        onPointerDown={(e) => {
                          const lane = laneRef.current;
                          if (!lane) return;
                          e.preventDefault();
                          e.stopPropagation();
                          /*
                            CLICK SELECTS rather than deleting. Delete handles removal.
                            Single-click deletion caused accidental data loss and prevented
                            multiple selection.
                          */
                          const key = `${shot.id}|${track.path}|${k.id}`;
                          const already = selectedKfs.includes(key);
                          if (!already || e.shiftKey) selectKeyframe(key, e.shiftKey);
                          kfDrag.current = {
                            shotId: shot.id,
                            path: track.path,
                            id: k.id,
                            startX: e.clientX,
                            startT: k.t,
                            // Freeze px/s at drag start:
                            // changes to the dynamic ruler would otherwise move the handle away.
                            perSec: lane.getBoundingClientRect().width / span,
                            moved: false,
                            /*
                              Group move: move all selected keyframes together when more than one
                              is selected.
                            */
                            group: selectedKfs.length > 1 && (selectedKfs.includes(key) || e.shiftKey),
                            lastT: k.t,
                          };
                        }}
                        /*
                          KEYFRAME CONTEXT MENU: easing selection and deletion. Easing existed in
                          the model without a UI, leaving everything at easeInOut. Offer 8 presets
                          and apply to the entire selection when present.
                        */
                        onContextMenu={ctx.open([
                          ...EASINGS.map((es) => ({
                            label: `${es.label}${k.easingOut === es.id ? '  ✓' : ''}`,
                            onSelect: () =>
                              setKeyframeEasing(
                                es.id,
                                selectedKfs.length > 1
                                  ? undefined
                                  : { shotId: shot.id, path: track.path, id: k.id },
                              ),
                          })),
                          {
                            label: 'Easing graph…',
                            onSelect: () =>
                              setEasingTarget({ shotId: shot.id, path: track.path, id: k.id }),
                          },
                          {
                            label: 'Delete keyframe',
                            danger: true,
                            onSelect: () => removeTrackKeyframe(shot.id, track.path, k.id),
                          },
                        ])}
                        title={`${trackLabel(track.path, shot)} @ ${k.t.toFixed(2)}s — click to select, drag to move, right click for easing or delete`}
                        className="absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 hover:scale-125"
                        style={{
                          left: pct(start + Math.min(k.t, shot.duration)),
                          background: selectedKfs.includes(`${shot.id}|${track.path}|${k.id}`)
                            ? '#fff'
                            : 'var(--mp-accent)',
                          border: selectedKfs.includes(`${shot.id}|${track.path}|${k.id}`)
                            ? '1px solid var(--mp-accent)'
                            : undefined,
                          borderRadius: 1,
                          transition: 'transform .1s',
                        }}
                      />
                    ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}

          {/*
            AUDIO STRIP: independent of scene rows, below them. Audio belongs to the sequence;
            attaching it to scenes would interrupt music at every scene change.
          */}
          <div className="mt-1 flex items-center" style={{ height: 30, borderTop: '1px solid var(--mp-surface-subtle)' }}>
            <div className="flex shrink-0 items-center gap-1 pl-2" style={{ width: GUTTER }}>
              <FileButton
                accept="audio/*"
                className="mp-label cursor-pointer"
                style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}
                ariaLabel="Add audio track"
                onPick={(f) => {
                  const url = URL.createObjectURL(f);
                  addAudio(f.name, url);
                  /*
                    MEASURE file duration to determine strip width rather than asking the user.
                    Save it to the store when metadata loads.
                  */
                  const probe = new Audio(url);
                  probe.addEventListener('loadedmetadata', () => {
                    const list = useEditor.getState().audioTracks;
                    const last = list[list.length - 1];
                    if (last) useEditor.getState().patchAudio(last.id, { duration: probe.duration });
                  });
                }}
              >
                {audioTracks.length ? '♪ AUDIO' : '+ AUDIO'}
              </FileButton>
            </div>
            <div className="relative h-full flex-1">
              {audioTracks.map((a) => (
                <div
                  key={a.id}
                  title={`${a.name} — drag to move, right click to remove`}
                  onPointerDown={(e) => {
                    const lane = laneRef.current;
                    if (!lane) return;
                    e.preventDefault();
                    audioDrag.current = {
                      id: a.id,
                      startX: e.clientX,
                      from: a.start,
                      perSec: lane.getBoundingClientRect().width / span,
                    };
                  }}
                  onContextMenu={ctx.open([
                    { label: `Remove ${a.name}`, danger: true, onSelect: () => removeAudioTrack(a.id) },
                  ])}
                  className="absolute top-1/2 flex h-[22px] -translate-y-1/2 cursor-grab items-center overflow-hidden px-1.5"
                  style={{
                    left: pct(a.start),
                    // Use a placeholder width of 3 s until duration is measured.
                    width: `calc(${pct(a.start + (a.duration || 3))} - ${pct(a.start)})`,
                    background: 'var(--mp-accent)',
                    opacity: a.url ? 0.85 : 0.4,
                    borderRadius: 3,
                  }}
                >
                  <AudioWave url={a.url} />
                  <span className="mp-label relative truncate" style={{ fontSize: 8, color: '#fff' }}>
                    {a.url ? a.name : `${a.name} (file missing)`}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}


/**
 * Audio clip waveform: peak bars span the whole clip. Empty until decoded; the clip still has its
 * solid fill.
 */
function AudioWave({ url }: { url: string | null }) {
  const peaks = useWaveform(url);
  if (!peaks) return null;
  const n = peaks.length;
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${n} 100`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {peaks.map((p, i) => {
        const h = Math.max(4, p * 86);
        return <rect key={i} x={i + 0.15} y={50 - h / 2} width={0.7} height={h} fill="rgba(255,255,255,0.45)" />;
      })}
    </svg>
  );
}
