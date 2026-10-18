'use client';

import { useEffect, useRef, useState } from 'react';
import { BRAND } from '@/config/brand';
import { usePhoto } from '@photo/store/photo';
import { loadManifest } from '@photo/lib/assets';
import { LeftPanel } from '@photo/components/LeftPanel';
import { RightPanel } from '@photo/components/RightPanel';
import { TopBar } from '@photo/components/TopBar';
import { Stage, useStageSize } from '@photo/components/Stage';
import { download, exportPng, exportVideo, renderFrame } from '@photo/lib/exportImage';
import { Icons } from '@photo/components/icons';
import { DiscardDialog } from '@photo/components/DiscardDialog';

/**
 * Photo mockup editor, available inside Mockuptop at /photo.
 *
 * Deliberately isolated with its own store (`mockupfoto:v1`), export, and
 * panel. It shares only design tokens, the mode switch, and the Pro gate
 * with the 3D editor. Keep the 3D shot schema untouched: fields missing
 * from old autosaves once caused undefined → NaN → a scene crash.
 */
export default function PhotoEditor() {
  const s = usePhoto();
  const size = useStageSize();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [discard, setDiscard] = useState(false);

  useEffect(() => {
    /*
      Apply the shared Pro flag after mount: reading localStorage in the
      store's initial state causes server/client hydration mismatch (React #418).
      Keep persist's synchronous rehydration; moving it to mount lost settings
      (see store/photo.ts).
    */
    usePhoto.getState().hydrateShared();
    loadManifest().then(s.setAssets).catch(() => s.setAssets([]));
    // Expose the test bridge only on localhost, never in production.
    if (typeof window !== 'undefined' && location.hostname === 'localhost') {
      (window as unknown as Record<string, unknown>).__photoStore = usePhoto;
      (window as unknown as Record<string, unknown>).__photoExport = {
        renderFrame,
        exportVideo,
        download,
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Escape opens "Discard changes?" only when no other layer is open,
   * allowing modals and dropdowns to handle their own Escape events.
   *
   * Note: this guard only sees layers with roles. Without roles, the emoji
   * picker and top-bar menu closed while also opening the discard dialog.
   * Give new popup layers roles and include them in this selector.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const layerOpen = document.querySelector('[role="dialog"],[role="listbox"],[role="menu"]');
      if (layerOpen) return;
      setDiscard(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Free: 1080 with watermark. Pro: 2160 without watermark.
   * Resolution is a Pro benefit rather than a separate control.
   */
  function opts() {
    return { state: s, size: s.pro ? 2160 : 1080, watermark: !s.pro };
  }

  /**
   * Show export failures.
   *
   * With only try/finally, failures reset the button without downloading a
   * file or explaining why. This module has no 3D Toast; use a brief inline
   * message below the export bar rather than a new notification system.
   *
   * Keep console.error too: users see a short message, while the full stack
   * remains available for diagnosis.
   */
  const [exportError, setExportError] = useState<string | null>(null);
  /*
    Keep the timer in a ref so an older error cannot clear a newer one,
    and unmount cleanup prevents updates to an unmounted component.
  */
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, []);

  function showExportError(e: unknown) {
    console.error(e);
    setExportError(e instanceof Error ? e.message : 'Export failed');
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setExportError(null), 6000);
  }

  async function onImage() {
    setBusy(true);
    setExportError(null);
    try {
      await exportPng(opts(), `${BRAND.fileSlug}.png`);
    } catch (e) {
      showExportError(e);
    } finally {
      setBusy(false);
    }
  }

  async function onVideo() {
    setBusy(true);
    setProgress(0);
    setExportError(null);
    try {
      await exportVideo(opts(), `${BRAND.fileSlug}.mp4`, setProgress);
    } catch (e) {
      showExportError(e);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  const exportBar = (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center justify-center gap-3">
        <span className="flex items-center gap-2">
          {Icons.export}
          <p
            className="text-[12px] font-medium uppercase tracking-[0.6px]"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Export
          </p>
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={onImage}
          className="mp-ctl inline-flex h-8 w-[116px] items-center justify-center text-sm font-medium cursor-pointer disabled:opacity-50"
          style={{ borderRadius: 8 }}
        >
          Image
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onVideo}
          className="mp-ctl inline-flex h-8 w-[116px] items-center justify-center text-sm font-medium cursor-pointer disabled:opacity-50"
          style={{ borderRadius: 8 }}
        >
          {busy && progress > 0 ? `${Math.round(progress * 100)}%` : 'Video'}
        </button>
      </div>
      {/*
        Put errors below the bar: visible where users look without moving
        buttons. role="alert" announces them to screen readers. Desktop/mobile
        copies are both rendered, but display:none hides the inactive copy
        from assistive technology.
      */}
      {exportError ? (
        <p role="alert" className="text-[12px] font-medium" style={{ color: '#c0392b' }}>
          {exportError}
        </p>
      ) : null}
    </div>
  );

  return (
    /*
      photo-root scopes the module palette (--card/--foreground/--page) and
      .mp-ctl/.mp-ghost hover behavior. Removing it makes buttons look inactive;
      see the photo section in globals.css.
    */
    <div className="photo-root h-dvh flex flex-col overflow-hidden">
      {/* Skip link for keyboard users. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded-md focus:px-3 focus:py-2"
        style={{ background: 'var(--card)', border: '1px solid rgba(var(--ink),.2)' }}
      >
        Skip to main content
      </a>
      <TopBar />

      {/*
        Narrow screens use one column: canvas, cards, then a fixed bottom
        export bar. Wide screens (lg) use three columns with independently
        scrolling columns.
      */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden pb-24 lg:pb-0">
        {/*
          Overlay the export bar on the preview at the canvas's lower edge.
          When the bar was in normal flow, the canvas covered it, preventing
          clicks and hover feedback.
        */}
        <main
          id="main"
          className="order-1 lg:order-2 relative flex-1 min-w-0 flex items-center justify-center px-4 lg:px-10 py-4 lg:py-6"
        >
          <div className="grid place-items-center">
            <Stage size={size} />
          </div>
          <div className="hidden lg:block absolute bottom-6 left-1/2 -translate-x-1/2 z-30">{exportBar}</div>
        </main>

        <aside className="order-2 lg:order-1 w-full lg:w-[408px] lg:h-full lg:overflow-y-auto overflow-x-hidden px-4 lg:px-5 pb-4 lg:pb-20 shrink-0">
          <LeftPanel />
        </aside>

        <aside className="order-3 w-full lg:w-[408px] lg:h-full lg:overflow-y-auto overflow-x-hidden px-4 lg:px-5 pb-4 lg:pb-20 shrink-0">
          <RightPanel />
        </aside>
      </div>

      <DiscardDialog
        open={discard}
        onKeep={() => setDiscard(false)}
        onDiscard={() => {
          s.reset();
          setDiscard(false);
        }}
      />

      {/* Fix the mobile export bar to the bottom of the screen. */}
      <div
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 px-4 py-3"
        style={{
          background: 'rgba(247,247,248,.92)',
          backdropFilter: 'blur(8px)',
          borderTop: '1px solid rgba(var(--ink),.08)',
        }}
      >
        {exportBar}
      </div>
    </div>
  );
}
