'use client';

import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@/store/editor';
import { useProjectBeats } from '@/components/shell/waveform';
import { Chevron } from '@/components/panel/Controls';
import { toast } from '@/components/shell/Toast';

const EVERY = [
  { n: 1, label: '1 beat' },
  { n: 2, label: '2 beats' },
  { n: 4, label: '4 beats' },
  { n: 8, label: '8 beats' },
] as const;

/**
 * BEATS: music beats. Show only when the project has an audio track with a source. Mark beats on
 * the ruler; with "Snap to beats" enabled, dragging scene ends, gaps, keyframes and text snaps to
 * beats. "Cut scenes on beats" aligns all scene boundaries to beats.
 */
export function BeatsMenu() {
  const hasAudio = useEditor((s) => s.audioTracks.some((a) => !!a.url));
  const beatSnap = useEditor((s) => s.beatSnap);
  const info = useProjectBeats();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  if (!hasAudio) return null;

  const status =
    info.state === 'loading'
      ? 'Finding the beat…'
      : info.state === 'ready'
        ? `≈${Math.round(info.bpm)} BPM · ${info.beats.length} beats`
        : 'No clear beat in this audio';

  const cut = (n: number) => {
    const changed = useEditor.getState().cutShotsOnBeats(info.beats, n);
    toast(changed ? `${changed} scene${changed > 1 ? 's' : ''} now cut on the beat` : 'No beats under the scenes');
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        className="mp-topbtn"
        onClick={() => setOpen((v) => !v)}
        data-active={open}
        data-testid="beats-menu"
        title="Music beats: snap and cut scenes on the beat"
      >
        Beats
        <span className="ml-1.5">
          <Chevron open={open} />
        </span>
      </button>
      {open ? (
        <div
          className="absolute bottom-full left-0 z-50 mb-2 flex w-[260px] flex-col gap-1.5 p-2"
          style={{
            background: 'var(--mp-dropdown)',
            border: '1px solid var(--mp-border)',
            borderRadius: 'var(--mp-radius-lg)',
            boxShadow: 'var(--mp-shadow-dropdown)',
          }}
        >
          <span className="mp-label px-1" data-testid="beats-status" style={{ color: 'var(--mp-text-tertiary)' }}>
            {status}
          </span>
          <label className="mp-label flex cursor-pointer items-center justify-between px-1 py-1">
            Snap to beats
            <input
              type="checkbox"
              checked={beatSnap}
              data-testid="beats-snap"
              onChange={(e) => useEditor.setState({ beatSnap: e.target.checked })}
            />
          </label>
          <span className="mp-label px-1" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
            CUT SCENES ON BEATS — EVERY
          </span>
          <div className="grid grid-cols-4 gap-1">
            {EVERY.map((e) => (
              <button
                key={e.n}
                className="mp-label py-1.5"
                disabled={info.state !== 'ready'}
                data-testid={`beats-cut-${e.n}`}
                onClick={() => cut(e.n)}
                style={{
                  background: 'var(--mp-surface-active)',
                  borderRadius: 'var(--mp-radius)',
                  opacity: info.state === 'ready' ? 1 : 0.4,
                  fontSize: 9,
                }}
              >
                {e.label}
              </button>
            ))}
          </div>
          <span className="mp-label px-1" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9, lineHeight: 1.4 }}>
            Scene animations stretch to the new length. Alt while dragging skips snapping.
          </span>
        </div>
      ) : null}
    </div>
  );
}
