'use client';

import { Slider } from '@/components/panel/Slider';
import { ColorInput } from '@/components/panel/ColorInput';
import { shotStart, useEditor, type Annotation, type AnnotationKind } from '@/store/editor';

/** Per-type label, short description, and radius range relative to the short edge. */
const KINDS: { kind: AnnotationKind; label: string; hint: string; max: number }[] = [
  { kind: 'tap', label: 'Tap', hint: 'Touch ripple', max: 0.25 },
  { kind: 'ring', label: 'Ring', hint: 'Circle a detail', max: 0.45 },
  { kind: 'spotlight', label: 'Spotlight', hint: 'Dim the rest of the screen', max: 0.6 },
  { kind: 'cursor', label: 'Cursor', hint: 'Pointer glides in and clicks', max: 0.12 },
];

/** Time when entry finishes, matching the store's addAnnotation. */
const SETTLE: Record<AnnotationKind, number> = { tap: 0.15, ring: 0.45, spotlight: 0.45, cursor: 0.6 };

/**
 * Highlights anchored to the device screen. Add, then click the frame to
 * place (AnnotationPlaceOverlay). Configure position, size, color, and timing here.
 */
export function HighlightsPanel() {
  const shot = useEditor((s) => s.shots.find((x) => x.id === s.activeShotId));
  const placing = useEditor((s) => s.placingAnnotationId);
  const addAnnotation = useEditor((s) => s.addAnnotation);
  const patchAnnotation = useEditor((s) => s.patchAnnotation);
  const removeAnnotation = useEditor((s) => s.removeAnnotation);
  if (!shot) return null;
  const dur = shot.duration;

  /* Keep the marker visible while placing: move to entry end if outside its playhead window. */
  const startPlacing = (a: Annotation) => {
    const st = useEditor.getState();
    const begin = shotStart(st.shots, shot.id);
    const local = st.playhead - begin;
    const end = a.end ?? dur;
    const inside = local >= a.start && local <= end && (a.kind !== 'tap' || local - a.start <= 0.7);
    useEditor.setState({
      placingAnnotationId: a.id,
      playing: false,
      // Stay inside the scene; its exact end boundary selects the next scene.
      ...(inside ? null : { playhead: begin + Math.max(0, Math.min(a.start + SETTLE[a.kind], end, dur - 0.05)) }),
    });
  };

  return (
    <>
      <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', fontSize: 10, lineHeight: 1.4 }}>
        Marks stick to the device screen and turn with it.
      </span>
      <div className="grid grid-cols-2 gap-1">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            onClick={() => addAnnotation(k.kind)}
            title={k.hint}
            data-testid={`add-annotation-${k.kind}`}
            className="mp-label py-2"
            style={{ background: 'var(--mp-surface-active)', borderRadius: 'var(--mp-radius)' }}
          >
            + {k.label}
          </button>
        ))}
      </div>

      {shot.annotations.map((a) => {
        const def = KINDS.find((k) => k.kind === a.kind) ?? KINDS[0];
        const end = Math.min(a.end ?? dur, dur);
        return (
          <div
            key={a.id}
            className="flex flex-col gap-1.5 p-1.5"
            style={{ border: '1px solid var(--mp-border)', borderRadius: 'var(--mp-radius)' }}
          >
            <div className="flex items-center gap-1">
              <span className="mp-label flex-1 px-1" style={{ color: 'var(--mp-text-primary)' }}>
                {def.label}
              </span>
              <button
                onClick={() => (placing === a.id ? useEditor.setState({ placingAnnotationId: null }) : startPlacing(a))}
                className="mp-label px-2 py-1"
                style={{
                  borderRadius: 6,
                  background: placing === a.id ? 'var(--mp-accent)' : 'var(--mp-surface-active)',
                  color: placing === a.id ? '#fff' : undefined,
                }}
                title="Click the device screen to move it"
              >
                {placing === a.id ? 'Placing…' : 'Place'}
              </button>
              <button
                onClick={() => removeAnnotation(a.id)}
                className="mp-label px-1"
                style={{ color: 'var(--mp-text-tertiary)' }}
                aria-label={`Remove ${def.label}`}
                title="Remove"
              >
                ✕
              </button>
            </div>
            <div className="flex gap-1.5">
              <div className="min-w-0 flex-1">
                <Slider label="X" value={a.x} min={0} max={1} onChange={(x) => patchAnnotation(a.id, { x })} />
              </div>
              <div className="min-w-0 flex-1">
                <Slider label="Y" value={a.y} min={0} max={1} onChange={(y) => patchAnnotation(a.id, { y })} />
              </div>
            </div>
            <Slider
              label="Size"
              value={a.size}
              min={0.02}
              max={def.max}
              step={0.005}
              precision={3}
              onChange={(size) => patchAnnotation(a.id, { size })}
            />
            <div className="flex items-center justify-between px-1">
              <span className="mp-label">{a.kind === 'spotlight' ? 'Dim color' : 'Color'}</span>
              <ColorInput label={`${def.label} color`} value={a.color} onChange={(color) => patchAnnotation(a.id, { color })} />
            </div>
            <div className="flex gap-1.5">
              <div className="min-w-0 flex-1">
                <Slider
                  label="Start"
                  value={a.start}
                  min={0}
                  max={Math.max(0.1, dur)}
                  step={0.1}
                  precision={1}
                  onChange={(start) => patchAnnotation(a.id, { start: Math.min(start, end - 0.1) })}
                />
              </div>
              <div className="min-w-0 flex-1">
                <Slider
                  label="End"
                  value={end}
                  min={0}
                  max={Math.max(0.1, dur)}
                  step={0.1}
                  precision={1}
                  // An end at the scene boundary becomes null, extending the marker if the scene grows.
                  onChange={(v) => {
                    const e = Math.max(v, a.start + 0.1);
                    patchAnnotation(a.id, { end: e >= dur - 0.001 ? null : e });
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
