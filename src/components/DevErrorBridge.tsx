'use client';

import { useEffect } from 'react';

/**
 * Development bridge: write uncaught browser errors to console.error.
 * Next's dev server forwards browser console output to the terminal,
 * making errors available in server logs to readers without browser access,
 * including remote agents.
 *
 * Attached only in development.
 */
export function DevErrorBridge() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;

    const onError = (e: ErrorEvent) => {
      console.error('[MOCKUPTOP-ERROR]', e.message, '@', e.filename, e.lineno, e.error?.stack ?? '');
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      console.error('[MOCKUPTOP-REJECTION]', r?.message ?? String(r), r?.stack ?? '');
    };
    const onContextLost = (e: Event) => {
      console.error('[MOCKUPTOP-WEBGL] context lost', (e as WebGLContextEvent).statusMessage ?? '');
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('webglcontextlost', onContextLost, true);

    // Layout and WebGL diagnostics reveal screen state without browser access.
    const report = () => {
      const box = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return `${sel}=YOK`;
        const r = el.getBoundingClientRect();
        return `${sel}=${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.x)},${Math.round(r.y)}`;
      };

      /*
        ⚠️ Do not call canvas.getContext() here.
        This report runs after 500 ms while R3F creates its renderer
        asynchronously. Calling getContext('webgl2') first can create a
        context with default attributes; three then receives that same context,
        ignoring preserveDrawingBuffer: true and powerPreference: 'high-performance'.
        In development this lost the preserved buffer, making canvas tests
        read zeros and pass or fail silently, or return identical measurements.
        Read CameraRig's localhost-only __gl instead; report "not yet available"
        when it is absent.
      */
      const canvas = document.querySelector('canvas');
      let gl = 'canvas YOK';
      if (canvas) {
        const r = canvas.getBoundingClientRect();
        const renderer = (window as unknown as { __gl?: { getContext: () => WebGLRenderingContext } }).__gl;
        const ctx = renderer?.getContext();
        gl = ctx
          ? `canvas=${canvas.width}x${canvas.height} css=${Math.round(r.width)}x${Math.round(r.height)} ctx=OK preserve=${ctx.getContextAttributes()?.preserveDrawingBuffer}`
          : `canvas=${canvas.width}x${canvas.height} renderer henuz yok`;
      }

      // Frame count reveals whether rendering has stalled.
      let frames = 0;
      const tick = () => {
        frames += 1;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setTimeout(() => {
        console.warn(
          `[MOCKUPTOP-DIAG] viewport=${innerWidth}x${innerHeight} dpr=${devicePixelRatio} ` +
            `fps~${frames} | ${box('main')} | ${box('header')} | ${box('aside')} | ${gl}`,
        );
      }, 1000);
    };

    /*
      Use warn for diagnostics: Next 16 browserToTerminal forwards warnings
      too, preserving their visibility. Tests treat console.error as a finding;
      2–4 diagnostic errors per startup obscured actual failures.
      Real errors, rejections, and context loss still use error above.
    */
    console.warn('[MOCKUPTOP-BOOT] client mounted');
    setTimeout(report, 500);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('webglcontextlost', onContextLost, true);
    };
  }, []);

  return null;
}
