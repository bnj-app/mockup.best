'use client';

import { useEffect, useRef } from 'react';
import { useEditor } from '@/store/editor';
import {
  CAMERA_LIMITS,
  DRAG_DEGREES_PER_PX,
  clampCamera,
  wheelZoomStep,
} from '@/config/motion';

/**
 * Mouse camera controls on the canvas. Measured behavior: dragging moves 0.5 degrees per pixel on both
 * axes; dragging right increases Tilt Y, dragging down increases Tilt X. Each wheel notch changes zoom
 * by 0.5; scrolling down zooms in. Holding Space (or Alt) pans instead of rotating. Limits come from
 * CAMERA_LIMITS; unrestricted 360-degree rotation is deliberately excluded because product shots focus
 * on framing rather than viewing the device's back.
 */
export function useCanvasControls(target: React.RefObject<HTMLElement | null>) {
  const patchCamera = useEditor((s) => s.patchCamera);

  // Keep drag state in a ref: React rerenders on every mouse move
  // are unnecessary at 60 fps because the scene already reads from the store.
  const drag = useRef<{
    x: number;
    y: number;
    pan: boolean;
    /** Raw pan before snapping; see the note below. */
    rawX?: number;
    /** Hold Alt to rotate the device (rotX/rotY). */
    rotate?: boolean;
    rawY?: number;
  } | null>(null);
  const spaceDown = useRef(false);
  /*
    Touch: one finger pans, two fingers tilt, pinching zooms. Mouse dragging rotates, with Space/Alt for
    pan. Dragging a mouse is easy; sliding a finger naturally pans. Panning is the most common framing
    action on phones, so it uses one finger.
  */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    const el = target.current;
    if (!el) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };

    /*
      Touching the frame during playback first pauses it when RECORD is off. Properties with tracks write
      keyframes at the playhead, which is correct while paused. During playback, dragging or scrolling
      instead scattered unwanted keyframes along the curve. Without recording, interaction means pause to
      adjust; with RECORD enabled, playback deliberately continues for live recording.
    */
    const pauseIfPlaying = () => {
      const s = useEditor.getState();
      if (s.playing && !s.recording) s.setPlaying(false);
    };

    const onPointerDown = (e: PointerEvent) => {
      // In Auto-motion drawing mode, dragging draws a region instead of rotating the camera
      // (the overlay shares this container, so events also bubbled here).
      if (useEditor.getState().autoMotion) return;
      pauseIfPlaying();
      if (e.pointerType === 'touch') {
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.current.size === 2) {
          const [a, b] = [...touches.current.values()];
          pinch.current = {
            dist: Math.hypot(a.x - b.x, a.y - b.y),
            // Pinching must also start from the visible zoom, for the same reason.
            zoom: useEditor.getState().evaluated().camera.zoom,
          };
        }
        // One finger pans; adding a second switches to tilt.
        drag.current = { x: e.clientX, y: e.clientY, pan: touches.current.size === 1 };
        return;
      }
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      /*
        Space/Ctrl pans. Alt rotates the device (Rotate X/Y). Alt previously panned; Space and Ctrl remain
        available for familiar pan shortcuts.
      */
      const panning = spaceDown.current || e.ctrlKey;
      drag.current = { x: e.clientX, y: e.clientY, pan: panning, rotate: !panning && e.altKey };
      el.style.cursor = drag.current.pan ? 'grabbing' : 'move';
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        // Pinching: distance between two fingers controls zoom.
        if (touches.current.size === 2 && pinch.current) {
          const [a, b] = [...touches.current.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          const ratio = dist / Math.max(1, pinch.current.dist);
          patchCamera({ zoom: clampCamera('zoom', pinch.current.zoom * ratio) });
        }
        if (drag.current) drag.current.pan = touches.current.size === 1;
      }
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;

      /*
        ⚠️ Use the visible camera: active(), not evaluated(). With a track at an intermediate playhead
        position, base and displayed values differ. Computing controls from the base made the first input
        jump to it, then RECORD wrote that wrong value into the curve. Measured: at displayed zoom 4.50, one
        wheel notch wrote 6.50 (base 6.00 + 0.5), a 2-unit jump. Sliders already handled this; canvas
        controls had missed it.
      */
      const cam = useEditor.getState().evaluated().camera;

      /*
        Use negative signs so users feel they are holding the device, not the camera. Dragging right should
        turn the device right, requiring the camera to move left. Direct camera dragging made both axes feel
        reversed.
      */
      if (d.rotate) {
        patchCamera({
          rotY: clampCamera('rotY', cam.rotY + dx * 0.35),
          rotX: clampCamera('rotX', cam.rotX + dy * 0.35),
        });
        return;
      }
      if (d.pan) {
        /*
          Center snapping must use the raw value. Snapping the stored value on every step trapped framing at
          zero: each drag step moved ~0.017, below the 0.05 threshold, so every step reset to zero. Fast mouse
          drags hid this, but slow touch panning was completely unresponsive. Accumulate raw movement
          separately and snap only when writing, preserving movement as the finger leaves the center.
        */
        d.rawX = (d.rawX ?? cam.panX) - dx / 700;
        d.rawY = (d.rawY ?? cam.panY) + dy / 700;
        const snap = (v: number) => (!e.altKey && Math.abs(v) < 0.05 ? 0 : v);
        patchCamera({
          panX: clampCamera('panX', snap(d.rawX)),
          panY: clampCamera('panY', snap(d.rawY)),
        });
      } else {
        patchCamera({
          tiltY: clampCamera('tiltY', cam.tiltY - dx * DRAG_DEGREES_PER_PX),
          tiltX: clampCamera('tiltX', cam.tiltX - dy * DRAG_DEGREES_PER_PX),
        });
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.current.delete(e.pointerId);
        if (touches.current.size < 2) pinch.current = null;
        if (touches.current.size === 0) drag.current = null;
      }
      drag.current = null;
      el.style.cursor = '';
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      pauseIfPlaying();
      // Continue from the displayed value (see above): using the base value
      // made animated zoom jump.
      const cam = useEditor.getState().evaluated().camera;
      // Scrolling forward (up) zooms in, as in maps
      // and design tools. Upward deltaY is negative, so invert the sign.
      // One notch is roughly 100 units, depending on the browser.
      const ticks = e.deltaY / 100;
      patchCamera({ zoom: clampCamera('zoom', cam.zoom - ticks * wheelZoomStep(cam.zoom)) });
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [target, patchCamera]);
}

/** Export the limits so sliders use the same bounds. */
export { CAMERA_LIMITS };
