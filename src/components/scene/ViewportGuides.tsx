'use client';

import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@/store/editor';
import { getAspect } from '@/config/aspects';

/*
  Reels / TikTok safe areas, approximate percentages of the frame. Official platform pages were
  unavailable and third-party sources disagree, so use conservative values: top 14%, bottom 35%, sides
  6%, attributed to Meta Reels ad guidance
  (https://www.inro.social/tools/instagram-reels-safe-zone-checker); right 22% for TikTok's vertical
  button column, measured from an ad preview (https://adkit.so/tools/safe-zones/tiktok, March 2026).
  Interfaces change, hence the "approx." label.
*/
const SAFE = { top: 0.14, bottom: 0.35, left: 0.06, right: 0.22 };

/**
 * Frame overlays: center lines and blur guides. Why DOM instead of WebGL: these editor helpers are
 * outside the scene. Putting them in WebGL risks inclusion in exports (as with watermark/text-layer
 * separation) and requires another render for each guide change. A canvas overlay that intercepts
 * clicks is cheap and cannot enter exports. Show the blur guide while settings change, then fade it:
 * permanent visibility clutters framing, while no guide makes abstract falloff values hard to judge.
 * Solid line = end of focus; dashed line = end of falloff.
 */
export function ViewportGuides() {
  const centerGuides = useEditor((s) => s.centerGuides);
  const safeAreaGuide = useEditor((s) => s.safeAreaGuide);
  // Useful only near 9:16 framing for full-screen vertical Reels/TikTok.
  const portrait916 = useEditor((s) => {
    const r = getAspect(s.aspectId).ratio;
    return !!r && r > 0.5 && r < 0.6;
  });
  const blur = useEditor((s) => s.active().blur);

  // Show the guide when blur changes, then fade after 1.2 seconds.
  const [blurVisible, setBlurVisible] = useState(false);
  const first = useRef(true);
  const sig = `${blur.mode}|${blur.strength}|${blur.focusSize}|${blur.falloff}|${blur.fx}|${blur.fy}|${blur.angle}`;
  useEffect(() => {
    // Skip the initial render: an unexplained circle appearing
    // in the center on page load is confusing.
    if (first.current) {
      first.current = false;
      return;
    }
    setBlurVisible(true);
    const t = window.setTimeout(() => setBlurVisible(false), 1200);
    return () => window.clearTimeout(t);
  }, [sig]);

  const showBlur = blurVisible && blur.mode !== 'off' && blur.strength > 0.01;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {safeAreaGuide && portrait916 ? (
        <div data-guide="safe-area" className="absolute inset-0">
          {/* Shade bands covered by platform UI; outline the remaining safe rectangle with dashes. */}
          {[
            { left: 0, top: 0, width: '100%', height: `${SAFE.top * 100}%` },
            { left: 0, bottom: 0, width: '100%', height: `${SAFE.bottom * 100}%` },
            { left: 0, top: `${SAFE.top * 100}%`, width: `${SAFE.left * 100}%`, height: `${(1 - SAFE.top - SAFE.bottom) * 100}%` },
            { right: 0, top: `${SAFE.top * 100}%`, width: `${SAFE.right * 100}%`, height: `${(1 - SAFE.top - SAFE.bottom) * 100}%` },
          ].map((st, i) => (
            <span key={i} className="absolute" style={{ ...st, background: 'rgba(255, 92, 60, 0.28)' }} />
          ))}
          <span
            className="absolute"
            style={{
              left: `${SAFE.left * 100}%`,
              top: `${SAFE.top * 100}%`,
              right: `${SAFE.right * 100}%`,
              bottom: `${SAFE.bottom * 100}%`,
              border: '1px dashed rgba(255, 92, 60, 0.9)',
            }}
          />
          <span
            className="mp-label absolute"
            style={{ left: `${SAFE.left * 100}%`, top: `calc(${SAFE.top * 100}% + 4px)`, color: 'rgba(255, 92, 60, 0.95)', fontSize: 9 }}
          >
            Reels / TikTok UI (approx.)
          </span>
        </div>
      ) : null}
      {centerGuides ? (
        <>
          <span
            className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2"
            style={{ background: 'var(--mp-accent)', opacity: 0.35 }}
          />
          <span
            className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2"
            style={{ background: 'var(--mp-accent)', opacity: 0.35 }}
          />
        </>
      ) : null}

      {showBlur && blur.mode === 'radial' ? (
        <div
          className="absolute"
          style={{
            left: `${blur.fx * 100}%`,
            top: `${blur.fy * 100}%`,
            transform: 'translate(-50%, -50%)',
            transition: 'opacity .25s',
          }}
        >
          {/* Focus circle: relative to the frame's short edge, matching scene calculations
              so the guide stays accurate. */}
          <span
            className="absolute rounded-full"
            style={{
              width: `${blur.focusSize * 100}vmin`,
              height: `${blur.focusSize * 100}vmin`,
              transform: 'translate(-50%, -50%)',
              border: '1px solid var(--mp-accent)',
              opacity: 0.9,
            }}
          />
          <span
            className="absolute rounded-full"
            style={{
              width: `${(blur.focusSize + blur.falloff) * 100}vmin`,
              height: `${(blur.focusSize + blur.falloff) * 100}vmin`,
              transform: 'translate(-50%, -50%)',
              border: '1px dashed var(--mp-accent)',
              opacity: 0.55,
            }}
          />
        </div>
      ) : null}

      {showBlur && blur.mode === 'linear' ? (
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            transform: `translate(-50%, -50%) rotate(${blur.angle}deg)`,
            width: '200%',
            height: '200%',
          }}
        >
          {[-1, 1].map((dir) => (
            <span key={`focus-${dir}`}>
              <span
                className="absolute left-0 w-full"
                style={{
                  top: `calc(50% + ${dir * blur.focusSize * 25}%)`,
                  height: 1,
                  background: 'var(--mp-accent)',
                  opacity: 0.9,
                }}
              />
              <span
                className="absolute left-0 w-full"
                style={{
                  top: `calc(50% + ${dir * (blur.focusSize + blur.falloff) * 25}%)`,
                  height: 0,
                  borderTop: '1px dashed var(--mp-accent)',
                  opacity: 0.55,
                }}
              />
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
