'use client';

import { useEffect } from 'react';
import { evaluateShot, shotAtTime, useEditor } from '@/store/editor';
import { bgCacheSize, debugSlotGroups, mediaLoaded, videoSourceTime } from '@/components/scene/Stage';
import { setStudioOverride, type HdrStudio } from '@/components/scene/hdrStudio';
import { setLookdev } from '@/components/scene/lookdev';
import { setDofDebug } from '@/components/scene/dofPass';
import {
  benchPipeline,
  captureFrame,
  recordCanvas,
  recordFrames,
  restorePreview,
} from '@/components/scene/exportBridge';
import { applyProject, encodeShareLink, exportProject, loadDemoProject, loadPack, resetProject } from '@/store/project';
import { getPack, type PackInput } from '@/config/packs';
import { bakeRedactions } from '@/config/redact';
import { historyDepth } from '@/store/history';
import { audioDebugState } from '@/components/scene/audioBridge';
import { projectBeats } from '@/components/shell/waveform';
import { thumbRenderCount } from '@/components/shell/templateThumbs';
import { composeAutoMotion } from '@/components/scene/autoMotion';
import { getBrandKit, saveBrandKit, type BrandKit } from '@/config/brandKit';
import { TEMPLATES } from '@/config/templates';
import { FREE_FOR_ALL } from '@/config/brand';
import { getPreviewJitter, setPreviewJitter } from '@/components/scene/PostProcessing';
import { setJitterMsaa } from '@/components/scene/jitterPass';

/**
 * Automation hook. Driving visual tests through UI clicks is brittle: moving one button breaks
 * scripts. Expose a small, named API that writes directly to editor state for rendering and visual
 * regression checks. It does not affect the UI and lives only under window.__mockuptop.
 */
export function AutomationHook() {
  useEffect(() => {
    const api = {
      state: () => useEditor.getState(),
      camera: (patch: Record<string, number>) => useEditor.getState().patchCamera(patch),
      shot: (patch: Record<string, unknown>) =>
        useEditor.getState().patchShot(patch as never),
      device: (deviceId: string) => useEditor.getState().patchShot({ deviceId }),
      finish: (finishId: string) => useEditor.getState().patchShot({ finishId }),
      light: (patch: Record<string, number | boolean>) => {
        const s = useEditor.getState();
        s.patchShot({ light: { ...s.active().light, ...patch } });
      },
      scene: (patch: Record<string, unknown>) => {
        const s = useEditor.getState();
        s.patchShot({ scene: { ...s.active().scene, ...patch } as never });
      },
      // Let tests reset to a known state; the startup demo means
      // the editor can no longer be assumed empty.
      reset: () => resetProject(),
      demo: () => loadDemoProject(),
      // Load a raw project object to test legacy schema migration.
      applyProject: (data: unknown) => applyProject(data),
      play: (v: boolean) => useEditor.getState().setPlaying(v),
      seek: (t: number) => useEditor.getState().setPlayhead(t),
      /*
        Expose the free-access constant to tests because it changes the ?unlock and capture-counter behavior
        completely. Duplicating that contract inside tests caused failures on a working product when the
        constant changed and tests still tried the old owner key.
      */
      freeForAll: FREE_FOR_ALL,
    };

    /*
      Expose debugging only on localhost so test and capture scripts can unlock Pro. Keep it unavailable
      in production to avoid offering a console-based unlock, even though client-side paywalls are
      inherently soft.
    */
    if (window.location.hostname === 'localhost') {
      (api as Record<string, unknown>).debug = {
        /*
          Ignore requests to disable Pro while everything is free. setProPersisted already enforces this, but
          direct setState here bypassed it.
        */
        setPro: (v: boolean) => useEditor.setState({ isPro: FREE_FOR_ALL ? true : v }),
        // Antialiasing: preview jitter sample count (including guard reductions) and a measurement override.
        jitter: () => getPreviewJitter(),
        setJitter: (n: number) => setPreviewJitter(n),
        setJitterMsaa: (n: number | null) => setJitterMsaa(n),
        bench: (frames?: number) => benchPipeline(frames),
        templateIds: () => TEMPLATES.map((t) => t.id),
        /** History depth for undo/redo tests. */
        history: () => historyDepth(),
        /** Audio-element state, since the elements are not in the DOM. */
        audioState: () => audioDebugState(),
        /** Project beat markers; see tests/test-beats.mjs. */
        beats: () => projectBeats(useEditor.getState().audioTracks),
        /** Number of thumbnails rendered for template cards. */
        thumbRenders: () => thumbRenderCount(),
        /** Layout slot-group transforms and the active scene evaluated at t. */
        slotGroups: () => debugSlotGroups(),
        /** Run Auto-motion without the UI for ruler-mark tests; regions use frame-relative coordinates. */
        composeAutoMotion: (rects: { x0: number; y0: number; x1: number; y1: number }[]) => composeAutoMotion(rects),
        /** Brand kit. */
        brandKit: () => getBrandKit(),
        saveBrandKit: (patch: Partial<BrandKit>) => saveBrandKit(patch),
        evaluatedAt: (t: number) => evaluateShot(useEditor.getState().active(), t),
        /** Evaluate any scene at local t to check split/reverse continuity. */
        evalShotAt: (id: string, t: number) => {
          const sh = useEditor.getState().shots.find((x) => x.id === id);
          return sh ? evaluateShot(sh, t) : null;
        },
        /** Text of the "Save project" file for embedded-media checks. */
        exportProjectJson: async () => (await exportProject()).text(),
        shareLink: () => encodeShareLink(),
        /** Video source time (trim + speed + loop), shared by preview and export. */
        sourceTime: (local: number, rate: number, trim: { in: number; out: number | null }, dur: number) =>
          videoSourceTime(local, rate, trim, dur),
        bgCacheSize: () => bgCacheSize(),
        /** Build a purpose pack without a dialog for visual inspection. */
        buildPack: (id: string, input: PackInput) => {
          const pack = getPack(id);
          return pack ? loadPack(pack, input) : false;
        },
        /** Render redaction regions without a dialog to measure styles. */
        redact: { bakeRedactions },
        /** Lighting look-dev: change the HDR studio definition live without recompiling. */
        setStudio: (id: string | null, def?: HdrStudio) => setStudioOverride(id, def),
        /** Material look-dev: change GLB material parameters live (lookdev.ts). */
        setLookdev: (patch: Record<string, number> | null) => setLookdev(patch),
        /** Inspect depth-of-field layers (dofPass.ts). */
        setDofDebug: (n: number) => setDofDebug(n),
        applyTemplate: (id: string) => {
          const t = TEMPLATES.find((x) => x.id === id);
          if (t) useEditor.getState().applyTemplate(t.apply);
          return !!t;
        },
        /**
         * Have scene videos finished seeking? Video seeking is asynchronous. Seeking the playhead and
         * immediately capturing a frame would capture the old video frame. The capture process waits for this
         * signal.
         */
        /** Have image textures loaded? Use videosReady for videos. */
        mediaReady: () => {
          /*
            ⚠️ Check only the currently visible scene. Requiring media from every scene never returned true in
            multi-scene projects because textures load only while their scene is visible. Capture then exhausted
            the wait loop (~1 second) on every frame: a 450-frame reel took 7+ minutes. This surfaced during a
            4K capture.
          */
          const st = useEditor.getState();
          const at = shotAtTime(st.shots, st.playhead);
          if (!at.shot || at.shot.mediaKind === 'video') return true;
          return mediaLoaded([at.shot.media]);
        },
        videosReady: () =>
          [...document.querySelectorAll('video')].every((v) => !v.seeking && v.readyState >= 2),
        /** Restore the preview after sequential capture. */
        restorePreview: (w: number, h: number) => restorePreview(w, h),
        /** Export gate: pause preview drawing while active to avoid overlay races. */
        setExporting: (v: boolean) => useEditor.getState().setExporting(v),
        /**
         * Capture one frame through the full pipeline at the target resolution. Automation can drive the
         * playhead to produce deterministic frame sequences. ⚠️ The old claim that recordFrames froze text
         * layers is obsolete. The cause was a canvas texture not being uploaded to the GPU after resizing (see
         * Stage.tsx), not recordFrames. Text was verified with PRODUCT_EXPORT=1, including the product export
         * pipeline.
         */
        captureFrame: async (opts: {
          width: number;
          height: number;
          quality?: number;
          keepSize?: boolean;
          /** PNG preserves transparency. */
          mime?: 'image/png' | 'image/jpeg';
        }) => {
          const blob = await captureFrame({
            width: opts.width,
            height: opts.height,
            mime: opts.mime ?? 'image/jpeg',
            quality: opts.quality ?? 0.92,
            keepSize: opts.keepSize,
          });
          const b64 = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
            fr.onerror = reject;
            fr.readAsDataURL(blob);
          });
          return b64;
        },
        /**
         * Frame-by-frame recording uses the Export button's pipeline. The real-time captureStream path in
         * record below does not advance text layers with multi-scene playback: hardware shows the right screen
         * while text stays on one scene. Paused frames and sampled state are correct; only real-time recording
         * fails. Driving time through seek avoids this and makes output independent of machine speed.
         * Automation should use this path.
         */
        recordFrames: async (opts: {
          durationSec: number;
          width: number;
          height: number;
          fps?: number;
          bitrate?: number;
          cover?: boolean;
          /** SSAA: the panel's Quality=High path, exposed for measurement. */
          supersample?: boolean;
        }) => {
          const st = useEditor.getState();
          st.setPlaying(false);
          st.setPlayhead(0);
          if (opts.cover !== false) st.setExporting(true);
          try {
            const blob = await recordFrames({
              durationSec: opts.durationSec,
              fps: opts.fps ?? 30,
              width: opts.width,
              height: opts.height,
              /*
                Previously fixed at 22 Mbps, giving 4K60 one eighth the bits per pixel of 1080p30. Use the panel's
                High formula: 0.3 bits/pixel, clamped to 4–100 Mbps.
              */
              bitrate:
                opts.bitrate ??
                Math.round(
                  Math.min(
                    100_000_000,
                    Math.max(4_000_000, 0.3 * opts.width * opts.height * (opts.fps ?? 30)),
                  ),
                ),
              motionBlur: 0,
              supersample: opts.supersample === true,
              seek: (t) => useEditor.getState().setPlayhead(t),
            });
            const b64 = await new Promise<string>((resolve, reject) => {
              const fr = new FileReader();
              fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
              fr.onerror = reject;
              fr.readAsDataURL(blob);
            });
            return { base64: b64, mime: blob.type };
          } finally {
            useEditor.getState().setExporting(false);
          }
        },
        /** Record the canvas at the given size and duration; return base64 and MIME type. */
        record: async (opts: {
          durationMs: number;
          width: number;
          height: number;
          fps?: number;
          bitrate?: number;
          mime?: string;
        }) => {
          const blob = await recordCanvas({
            mime: opts.mime,
            durationMs: opts.durationMs,
            fps: opts.fps ?? 30,
            width: opts.width,
            height: opts.height,
            bitrate: opts.bitrate ?? 3_000_000,
            motionBlur: 0,
          });
          const b64 = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
            fr.onerror = reject;
            fr.readAsDataURL(blob);
          });
          return { base64: b64, mime: blob.type };
        },
      };
    }

    (window as unknown as Record<string, unknown>).__mockuptop = api;
  }, []);

  return null;
}
