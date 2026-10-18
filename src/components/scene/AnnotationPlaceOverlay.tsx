'use client';

import { useEffect, useRef } from 'react';
import { useEditor } from '@/store/editor';
import { getSceneRefs } from './exportBridge';
import { pickScreenPoint } from './screenMarks';
import { toast } from '@/components/shell/Toast';

const KIND_LABEL = { tap: 'tap', ring: 'ring', spotlight: 'spotlight', cursor: 'cursor' } as const;

/**
 * Annotation placement overlay above the frame, visible only in placement mode. Raycast the clicked
 * point from the current camera onto the device screen (pickScreenPoint). Store screen-relative
 * coordinates so the marker stays in place as the camera rotates. Consume clicks to prevent camera
 * dragging through useCanvasControls underneath.
 */
export function AnnotationPlaceOverlay() {
  const placingId = useEditor((s) => s.placingAnnotationId);
  const kind = useEditor((s) => {
    const shot = s.shots.find((x) => x.id === s.activeShotId);
    return shot?.annotations.find((a) => a.id === s.placingAnnotationId)?.kind ?? null;
  });
  const box = useRef<HTMLDivElement>(null);

  // Exit placement mode automatically if the annotation is deleted or the scene changes.
  useEffect(() => {
    if (placingId && !kind) useEditor.setState({ placingAnnotationId: null });
  }, [placingId, kind]);

  useEffect(() => {
    if (!placingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        useEditor.setState({ placingAnnotationId: null });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [placingId]);

  if (!placingId || !kind) return null;

  const place = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-place-ui]')) return;
    const refs = getSceneRefs();
    const r = box.current?.getBoundingClientRect();
    if (!refs || !r) return;
    const hit = pickScreenPoint(refs.camera, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (!hit) {
      toast('Click on the device screen');
      return;
    }
    const st = useEditor.getState();
    st.patchAnnotation(placingId, { x: Math.round(hit.x * 1000) / 1000, y: Math.round(hit.y * 1000) / 1000 });
    useEditor.setState({ placingAnnotationId: null });
  };

  return (
    <div
      ref={box}
      data-testid="annotation-place"
      className="absolute inset-0 z-40"
      style={{ cursor: 'crosshair', background: 'rgba(10,10,20,0.08)' }}
      onPointerDown={place}
    >
      <div
        data-place-ui
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
          Click the device screen to place the {KIND_LABEL[kind]}
        </span>
        <button className="mp-topbtn" onClick={() => useEditor.setState({ placingAnnotationId: null })}>
          Done
        </button>
      </div>
    </div>
  );
}
