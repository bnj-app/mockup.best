'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '@/store/editor';
import { LAUNCH_ZIP_NAME, launchFileCount } from '@/config/launch';
import { checkLaunchPackage, exportLaunchPackage, type LaunchCheck, type LaunchProgress } from '@/lib/launchExport';
import { downloadBlob } from '@/components/scene/exportBridge';
import { playBlip, playDone } from '@/components/shell/sounds';
import { track } from '@/lib/analytics';

/**
 * EXPORT LAUNCH PACKAGE: check, choose languages, make every file into one ZIP (lib/launchExport.ts)
 * with real progress and Cancel. Also lists the package's outputs: a click selects that scene.
 * Opened from the Launch Factory dialog and from Export when the project is a launch package.
 */

export const LAUNCH_EXPORT_EVENT = 'mockuptop:launch-export';
export function openLaunchExport() {
  window.dispatchEvent(new Event(LAUNCH_EXPORT_EVENT));
}

function LaunchExportPanel({ onClose }: { onClose: () => void }) {
  const launch = useEditor((s) => s.launch);
  const baseLang = useEditor((s) => s.baseLang);
  const languages = useEditor((s) => s.languages);
  const [extra, setExtra] = useState<string[]>([]);
  const [imagesOnly, setImagesOnly] = useState(false);
  const [check, setCheck] = useState<LaunchCheck | null>(null);
  const [progress, setProgress] = useState<LaunchProgress | null>(null);
  const [result, setResult] = useState<{ zip: Blob; files: number; seconds: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const running = !!progress;
  const langs = [baseLang, ...languages.filter((l) => extra.includes(l))];
  const langKey = langs.join(',');

  useEffect(() => {
    let live = true;
    void checkLaunchPackage(langKey.split(',')).then((c) => {
      if (!live) return;
      setCheck(c);
      if (!c.videoOk) setImagesOnly(true);
    });
    return () => {
      live = false;
    };
  }, [langKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape' && !abort.current) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Closing the panel while a package is being made cancels it.
  useEffect(() => () => abort.current?.abort(), []);

  if (!launch) return null;
  const perLang = launchFileCount(launch.outputs.filter((o) => !imagesOnly || o.target !== 'video'));
  const fileCount = perLang * langs.length + 1;

  const start = async () => {
    if (running || !check || check.problems.length) return;
    const ac = new AbortController();
    abort.current = ac;
    setError(null);
    setResult(null);
    setProgress({ phase: 'images', fraction: 0, detail: 'Preparing' });
    const t0 = performance.now();
    try {
      const r = await exportLaunchPackage({ langs, imagesOnly, signal: ac.signal, onProgress: setProgress });
      if (ac.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const seconds = (performance.now() - t0) / 1000;
      setResult({ ...r, seconds });
      downloadBlob(r.zip, LAUNCH_ZIP_NAME);
      track('export_launch_package', { files: r.files, langs: langs.length, imagesOnly, s: Math.round(seconds) });
      playDone();
    } catch (e) {
      if ((e as Error).name === 'AbortError') setError('Cancelled — nothing was downloaded.');
      else {
        playBlip();
        setError(e instanceof Error ? e.message : 'Export failed');
        track('export_failed', { kind: 'launch-package' });
      }
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };

  const goTo = (shotId: string | undefined) => {
    if (!shotId || running) return;
    const st = useEditor.getState();
    if (!st.shots.some((s) => s.id === shotId)) return;
    st.setPlaying(false);
    st.selectShot(shotId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[950] flex items-center justify-center p-4" style={{ background: 'rgba(10,10,14,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !running && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Export launch package"
        data-launch-panel
        className="mp-scroll flex max-h-[90vh] w-full max-w-[460px] flex-col gap-3 overflow-y-auto p-4"
        style={{ background: 'var(--mp-dropdown)', border: '1px solid var(--mp-border)', borderRadius: 'var(--mp-radius-lg)', boxShadow: 'var(--mp-shadow-dropdown)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <span className="mp-label" style={{ color: 'var(--mp-text-primary)', fontSize: 13, fontWeight: 700 }}>
            Export launch package
          </span>
          <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', lineHeight: 1.5 }}>
            {fileCount} files in one ZIP: {imagesOnly ? 'every image' : 'every image and the promo video'}
            {langs.length > 1 ? `, in ${langs.length} languages` : ''}, with a manifest. Store images are alpha-free PNG.
          </span>
        </div>

        {check?.problems.map((p) => (
          <span key={p} className="mp-label" style={{ color: 'var(--mp-danger, #c62828)', lineHeight: 1.5 }} data-launch-problem>
            {p}
          </span>
        ))}
        {check?.warnings.map((w) => (
          <span key={w} className="mp-label" style={{ color: 'var(--mp-warning, #b26a00)', lineHeight: 1.5 }} data-launch-warning>
            {w}
          </span>
        ))}

        {languages.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mp-label" style={{ color: 'var(--mp-text-secondary)' }}>
              Languages: {baseLang.toUpperCase()}
            </span>
            {languages.map((l) => (
              <label key={l} className="mp-label flex items-center gap-1" style={{ color: 'var(--mp-text-secondary)' }}>
                <input type="checkbox" disabled={running} checked={extra.includes(l)} onChange={(e) => setExtra((x) => (e.target.checked ? [...x, l] : x.filter((k) => k !== l)))} />
                {l.toUpperCase()}
              </label>
            ))}
          </div>
        ) : null}
        <label className="mp-label flex items-center gap-2" style={{ color: 'var(--mp-text-secondary)' }}>
          <input type="checkbox" disabled={running || (check ? !check.videoOk : true)} checked={imagesOnly} onChange={(e) => setImagesOnly(e.target.checked)} data-launch-images-only />
          Images only (skip the video)
        </label>

        {progress ? (
          <div className="flex flex-col gap-1.5" data-launch-progress>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--mp-surface-active)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(progress.fraction * 100)}%`, height: '100%', background: 'var(--mp-accent)', transition: 'width 0.2s' }} />
            </div>
            <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }}>
              {progress.detail}
            </span>
            <button className="mp-label w-full py-2" style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface-active)' }} onClick={() => abort.current?.abort()} data-launch-cancel>
              Cancel
            </button>
          </div>
        ) : result ? (
          <div className="flex flex-col gap-1.5" data-launch-done>
            <span className="mp-label" style={{ color: 'var(--mp-text-primary)' }}>
              {result.files} files ready ({(result.zip.size / 1048576).toFixed(1)} MB, {Math.round(result.seconds)} s). The download has started.
            </span>
            <div className="flex gap-1.5">
              <button className="mp-label flex-1 py-2" style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface-active)' }} onClick={() => downloadBlob(result.zip, LAUNCH_ZIP_NAME)}>
                Download again
              </button>
              <button className="mp-label flex-1 py-2" style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-accent)', color: '#fff', fontWeight: 600 }} onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <button
            disabled={!check || !!check.problems.length}
            onClick={start}
            className="mp-label w-full py-2.5"
            style={{ borderRadius: 'var(--mp-radius)', background: check && !check.problems.length ? 'var(--mp-accent)' : 'var(--mp-surface)', color: check && !check.problems.length ? '#fff' : 'var(--mp-text-tertiary)', fontWeight: 600 }}
            data-launch-start
          >
            {check ? `Make ${fileCount} files` : 'Checking…'}
          </button>
        )}
        {error ? (
          <span className="mp-label" style={{ color: 'var(--mp-text-secondary)' }} data-launch-error>
            {error}
          </span>
        ) : null}

        <div className="flex flex-col gap-1">
          <span className="mp-label" style={{ color: 'var(--mp-text-secondary)' }}>
            Launch outputs — click to edit its scene
          </span>
          {launch.outputs.map((o) => (
            <button
              key={o.id}
              disabled={running}
              onClick={() => goTo(o.shotIds[0])}
              className="mp-label flex items-center justify-between px-2 py-1.5 text-left"
              style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface)' }}
              data-launch-output={o.id}
            >
              <span style={{ color: 'var(--mp-text-primary)' }}>{o.label}</span>
              <span style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>{o.files.map((f) => `${f.w}×${f.h}`).join(' · ')}</span>
            </button>
          ))}
        </div>
        <button className="mp-label w-full py-1" style={{ color: 'var(--mp-text-tertiary)' }} disabled={running} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export function LaunchExportHost() {
  const [open, setOpen] = useState(0);
  useEffect(() => {
    const onOpen = () => setOpen((n) => n + 1);
    window.addEventListener(LAUNCH_EXPORT_EVENT, onOpen);
    return () => window.removeEventListener(LAUNCH_EXPORT_EVENT, onOpen);
  }, []);
  if (!open) return null;
  return createPortal(<LaunchExportPanel key={open} onClose={() => setOpen(0)} />, document.body);
}
