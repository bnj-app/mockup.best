'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EASINGS, animatable, cubicBezier, type Bezier, type EasingId } from '@/config/tracks';
import { useEditor } from '@/store/editor';

/**
 * Easing graph. Presets were already available on right-click; the missing pieces were seeing and
 * editing the curve. Names alone cannot convey the difference between "Ease out" and "Quint", but
 * curves do at a glance. Three parts: eight preset tiles, a two-handle Bezier curve and an animated
 * tracer. The tracer conveys acceleration and deceleration better than a static curve. A portal is
 * required because the timeline's backdrop-filter creates a stacking context that would place an
 * embedded panel below the canvas.
 */

const SIZE = 190;
const PAD = 18;

/** Approximate Bezier equivalents of preset curves, for tile previews. */
const PRESET_CURVE: Record<EasingId, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  sine: [0.37, 0, 0.63, 1],
  quint: [0.22, 1, 0.36, 1],
  expo: [0.7, 0, 0.84, 0],
  // A cubic Bezier cannot represent oscillation; the tile only suggests overshoot and settling.
  spring: [0.3, 1.6, 0.5, 0.95],
  back: [0.34, 1.56, 0.64, 1],
};

function path(b: Bezier): string {
  const x = (v: number) => PAD + v * (SIZE - PAD * 2);
  const y = (v: number) => SIZE - PAD - v * (SIZE - PAD * 2);
  return `M ${x(0)} ${y(0)} C ${x(b[0])} ${y(b[1])}, ${x(b[2])} ${y(b[3])}, ${x(1)} ${y(1)}`;
}

export function EasingGraph({
  target,
  onClose,
}: {
  target: { shotId: string; path: string; id: string };
  onClose: () => void;
}) {
  const setKeyframeEasing = useEditor((s) => s.setKeyframeEasing);
  const setKeyframeBezier = useEditor((s) => s.setKeyframeBezier);
  const kf = useEditor((s) => {
    const shot = s.shots.find((x) => x.id === target.shotId);
    const track = shot?.tracks.find((t) => t.path === target.path);
    return track?.keyframes.find((k) => k.id === target.id);
  });

  const curve: Bezier = kf?.bezier ?? PRESET_CURVE[kf?.easingOut ?? 'easeInOut'];
  const [dragging, setDragging] = useState<0 | 1 | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  /*
    Close on Escape. This fullscreen dimming layer otherwise required a backdrop click or finding ✕,
    unlike other modals (UpgradeModal, DiscardDialog, LoginModal, DropChoice), which handle Escape.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Animated tracer: motion makes the curve's meaning clear.
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = () => {
      setT(((performance.now() - start) / 1400) % 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (dragging === null) return;
    const move = (e: PointerEvent) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const nx = Math.min(1, Math.max(0, (e.clientX - r.left - PAD) / (SIZE - PAD * 2)));
      // Allow Y handles outside the curve for spring effects: -0.5..1.5.
      const ny = Math.min(1.5, Math.max(-0.5, 1 - (e.clientY - r.top - PAD) / (SIZE - PAD * 2)));
      const next: Bezier = [...curve] as Bezier;
      next[dragging * 2] = Math.round(nx * 100) / 100;
      next[dragging * 2 + 1] = Math.round(ny * 100) / 100;
      setKeyframeBezier(target, next);
    };
    const up = () => setDragging(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, curve, setKeyframeBezier, target]);

  const px = (v: number) => PAD + v * (SIZE - PAD * 2);
  const py = (v: number) => SIZE - PAD - v * (SIZE - PAD * 2);
  const traceY = cubicBezier(t, curve);

  return createPortal(
    <div
      className="fixed inset-0 z-[950] grid place-items-center"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        // The role is required for screen readers and overlay-detection tests,
        // matching the other modals.
        role="dialog"
        aria-modal="true"
        aria-label="Easing"
        className="flex flex-col gap-2.5 p-3.5"
        style={{
          background: 'var(--mp-dropdown)',
          border: '1px solid var(--mp-border)',
          borderRadius: 'var(--mp-radius-lg)',
          boxShadow: 'var(--mp-shadow-dropdown)',
        }}
      >
        <div className="flex items-center justify-between">
          {/*
            Identify the keyframe. A plain "Easing" title left users unsure which property and time they were
            editing in multi-track scenes, since the fullscreen backdrop hides the timeline.
          */}
          <span className="mp-label truncate" style={{ color: 'var(--mp-text-focus)' }}>
            Easing
            <span style={{ color: 'var(--mp-text-tertiary)' }}>
              {` · ${animatable(target.path)?.label ?? target.path}${kf ? ` @ ${kf.t.toFixed(2)}s` : ''}`}
            </span>
          </span>
          <button className="mp-label" onClick={onClose} aria-label="Close" style={{ color: 'var(--mp-text-tertiary)' }}>
            ✕
          </button>
        </div>

        {/* Center the curve: the wider preset grid otherwise left it aligned left with empty space on the right. */}
        <svg ref={svgRef} width={SIZE} height={SIZE} className="self-center" style={{ touchAction: 'none' }}>
          <rect
            x={PAD}
            y={PAD}
            width={SIZE - PAD * 2}
            height={SIZE - PAD * 2}
            fill="var(--mp-surface)"
            stroke="var(--mp-border)"
          />
          {/* Handles */}
          <line x1={px(0)} y1={py(0)} x2={px(curve[0])} y2={py(curve[1])} stroke="var(--mp-text-tertiary)" strokeDasharray="3 3" />
          <line x1={px(1)} y1={py(1)} x2={px(curve[2])} y2={py(curve[3])} stroke="var(--mp-text-tertiary)" strokeDasharray="3 3" />
          <path d={path(curve)} fill="none" stroke="var(--mp-accent)" strokeWidth={2} />
          {/* Tracer showing the motion represented by the curve */}
          <circle cx={px(t)} cy={py(traceY)} r={4} fill="var(--mp-accent)" opacity={0.9} />
          {[0, 1].map((h) => (
            <circle
              key={h}
              cx={px(curve[h * 2])}
              cy={py(curve[h * 2 + 1])}
              r={6}
              fill="#fff"
              stroke="var(--mp-accent)"
              strokeWidth={2}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => {
                e.preventDefault();
                setDragging(h as 0 | 1);
              }}
            />
          ))}
        </svg>

        <div className="grid grid-cols-4 gap-1">
          {EASINGS.map((es) => (
            <button
              key={es.id}
              onClick={() => {
                // Selecting a preset clears the custom curve; otherwise the curve
                // would not change and the control would appear broken.
                setKeyframeBezier(target, null);
                setKeyframeEasing(es.id, target);
              }}
              className="mp-label grid place-items-center px-1 py-1"
              style={{
                background:
                  !kf?.bezier && kf?.easingOut === es.id
                    ? 'var(--mp-surface-active)'
                    : 'var(--mp-surface)',
                borderRadius: 'var(--mp-radius)',
                fontSize: 8,
                // "EASE IN OUT" overflowed even at 8 px with 0.06em spacing.
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap',
              }}
              title={es.label}
            >
              <svg width={34} height={20} viewBox={`0 0 ${SIZE} ${SIZE}`} preserveAspectRatio="none">
                <path d={path(PRESET_CURVE[es.id])} fill="none" stroke="currentColor" strokeWidth={6} />
              </svg>
              {es.label}
            </button>
          ))}
        </div>

        {kf?.bezier ? (
          <button className="mp-topbtn" onClick={() => setKeyframeBezier(target, null)}>
            Reset to preset
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
