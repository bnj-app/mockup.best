'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, type ScreenMedia } from '@/store/editor';
import { matchFiles, screenKey, screenNameFromFile } from '@/config/screens';
import { toast } from '@/components/shell/Toast';
import { redactToUrl, type RedactRect } from '@/config/redact';
import { track } from '@/lib/analytics';

/**
 * Update screens: drop new screenshots in bulk to refresh all scenes sharing their names. Flow:
 * select/drop files → suggest name matches → review old/new previews and adjust each choice → Apply
 * in one set (one undo step). Unmatched files are ignored or appended as new scenes. Open with
 * window.dispatchEvent(new CustomEvent('mockuptop:update-screens', { detail: { files } }));
 * hamburger, Source panel, and multi-file drops share this entry point. Portal into body to avoid
 * the header backdrop-filter pitfall.
 */

type Picked = { file: File; url: string; key: string; kind: 'image' | 'video' };
/** Scenes showing this screen (count once if main and extra devices share a scene). */
type Screen = {
  key: string;
  name: string;
  scenes: Set<string>;
  media: string | null;
  kind: 'image' | 'video';
  /** Redactions baked into this screen, available for reapplication to new images. */
  redactions?: RedactRect[];
};

export const UPDATE_SCREENS_EVENT = 'mockuptop:update-screens';
export function openUpdateScreens(files?: File[]) {
  window.dispatchEvent(new CustomEvent(UPDATE_SCREENS_EVENT, { detail: { files } }));
}

const isMedia = (f: File) => f.type.startsWith('image/') || f.type.startsWith('video/');
const toPicked = (list: File[]): Picked[] =>
  list.filter(isMedia).map((file) => ({
    file,
    url: URL.createObjectURL(file),
    key: screenKey(screenNameFromFile(file.name)),
    kind: file.type.startsWith('video/') ? ('video' as const) : ('image' as const),
  }));

/** Named project screens: main scenes + extra devices, in scene order. */
function collectScreens(shots: ReturnType<typeof useEditor.getState>['shots']): Screen[] {
  const map = new Map<string, Screen>();
  const add = (
    shotId: string,
    name: string | null | undefined,
    media: string | null,
    kind: 'image' | 'video',
    redactions: RedactRect[] | undefined,
  ) => {
    const key = screenKey(name);
    if (!key || !name) return;
    const cur = map.get(key);
    if (cur) {
      cur.scenes.add(shotId);
      if (!cur.media && media) Object.assign(cur, { media, kind });
      if (!cur.redactions?.length && redactions?.length) cur.redactions = redactions;
    } else map.set(key, { key, name, scenes: new Set([shotId]), media, kind, redactions });
  };
  for (const s of shots) {
    add(s.id, s.screenName, s.media, s.mediaKind, s.redactions);
    for (const e of s.extras) add(s.id, e.screenName, e.media, e.mediaKind, e.redactions);
  }
  return [...map.values()];
}

function Thumb({ url, kind, missing }: { url: string | null; kind: 'image' | 'video'; missing?: boolean }) {
  return (
    <div
      className="mp-label grid shrink-0 place-items-center overflow-hidden"
      style={{
        width: 30,
        height: 44,
        borderRadius: 5,
        border: missing ? '1px dashed rgba(255,170,60,0.8)' : '1px solid var(--mp-border)',
        background: 'var(--mp-surface)',
        fontSize: 8,
        color: 'var(--mp-text-tertiary)',
      }}
    >
      {url ? (
        kind === 'video' ? (
          <video src={url} muted className="h-full w-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-full w-full object-cover" />
        )
      ) : missing ? (
        '?'
      ) : null}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  height: 26,
  maxWidth: 150,
  borderRadius: 'var(--mp-radius)',
  background: 'var(--mp-surface)',
  border: '1px solid var(--mp-border)',
  color: 'var(--mp-text-primary)',
  fontSize: 10,
  padding: '0 4px',
};

function UpdateScreensModal({ initial, onClose }: { initial: File[]; onClose: () => void }) {
  const shots = useEditor((s) => s.shots);
  const screens = useMemo(() => collectScreens(shots), [shots]);
  // Use opening files (multi-drop) as initial state rather than setting state in an effect.
  const [files, setFiles] = useState<Picked[]>(() => toPicked(initial));
  /** Screen key → file index (-1 = keep current). Only manually changed choices. */
  const [manual, setManual] = useState<Record<string, number>>({});
  /** Unmatched file index → 'new' or 'ignore' (manual). */
  const [extraChoice, setExtraChoice] = useState<Record<number, 'new' | 'ignore'>>({});
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const applied = useRef(false);

  const addFiles = (list: File[]) => {
    const fresh = toPicked(list);
    if (fresh.length) setFiles((prev) => [...prev, ...fresh]);
  };

  /*
    Revoke created URLs when closing without applying. ⚠️ Do not use effect cleanup: development
    React sets up effects twice, revoking dropped URLs during opening and causing redaction
    reapplication to fail image decoding.
  */
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  const close = useCallback(() => {
    if (!applied.current) for (const f of filesRef.current) URL.revokeObjectURL(f.url);
    onClose();
  }, [onClose]);

  /*
    Isolate keyboard input: editor Delete/Space shortcuts must not delete/play scenes while the
    modal is open. Capture non-input keys before they reach the editor, preserving button defaults.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      e.stopPropagation();
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const auto = useMemo(
    () => matchFiles(screens.map((s) => s.key), files.map((f) => ({ key: f.key, name: f.file.name }))),
    [screens, files],
  );
  const choice = (key: string) => (manual[key] !== undefined ? manual[key] : (auto[key] ?? -1));
  const usedFiles = new Set(screens.map((s) => choice(s.key)).filter((i) => i >= 0));
  const loose = files.map((_, i) => i).filter((i) => !usedFiles.has(i));
  const anyMatch = Object.keys(auto).length > 0;
  const extraOf = (i: number) => extraChoice[i] ?? (anyMatch || screens.length ? 'ignore' : 'new');

  const updating = screens.filter((s) => choice(s.key) >= 0);
  const scenesTouched = new Set(updating.flatMap((s) => [...s.scenes])).size;
  const newCount = loose.filter((i) => extraOf(i) === 'new').length;

  /*
    Reapply existing redactions to replacement screen images, not video. Baking is asynchronous and
    precedes updateScreens so the store update remains one set and one undo step.
  */
  const redactable = updating.filter((s) => s.redactions?.length && files[choice(s.key)]?.kind === 'image');
  const [reapply, setReapply] = useState(true);
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    setBusy(true);
    const toMedia = (p: Picked): ScreenMedia => ({ url: p.url, kind: p.kind, name: p.file.name });
    const assign: Record<string, ScreenMedia> = {};
    const originalsKept = new Set<string>();
    for (const s of updating) {
      const f = files[choice(s.key)];
      if (reapply && s.redactions?.length && f.kind === 'image') {
        try {
          assign[s.key] = { ...toMedia(f), url: await redactToUrl(f.url, s.redactions), redactions: s.redactions };
          originalsKept.add(f.url);
          continue;
        } catch {
          toast(`Could not re-apply hidden areas on ${s.name} — check it before sharing`);
        }
      }
      assign[s.key] = toMedia(f);
    }
    const newScenes = loose.filter((i) => extraOf(i) === 'new').map((i) => toMedia(files[i]));
    const r = useEditor.getState().updateScreens({ assign, newScenes });
    applied.current = true;
    // Revoke unused file URLs; keep baked images' originals for further editing in this tab.
    const kept = new Set([...Object.values(assign), ...newScenes].map((m) => m.url));
    for (const f of files) if (!kept.has(f.url) && !originalsKept.has(f.url)) URL.revokeObjectURL(f.url);
    track('screens_update', { screens: r.screens, scenes: r.scenes, added: r.added });
    toast(
      `Updated ${r.screens} screen${r.screens === 1 ? '' : 's'} in ${r.scenes} scene${r.scenes === 1 ? '' : 's'}` +
        (r.added ? ` · ${r.added} new scene${r.added === 1 ? '' : 's'}` : '') +
        ' — Ctrl+Z to undo',
    );
    onClose();
  };

  const canApply = updating.length > 0 || newCount > 0;

  return (
    <div
      className="fixed inset-0 z-[950] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,10,14,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Update screens"
        className="flex max-h-[86vh] w-full max-w-[480px] flex-col overflow-hidden"
        style={{
          background: 'var(--mp-dropdown)',
          border: '1px solid var(--mp-border)',
          borderRadius: 'var(--mp-radius-lg)',
          boxShadow: 'var(--mp-shadow-dropdown)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1 p-4 pb-3">
          <span className="mp-label" style={{ color: 'var(--mp-text-primary)', fontSize: 13, fontWeight: 700 }}>
            Update screens
          </span>
          <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', lineHeight: 1.5 }}>
            Drop the new screenshots of your app. Scenes showing a screen with the same name get the new
            image — camera moves, text and timing stay as they are.
          </span>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          data-update-screens-input
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <div className="px-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOver(false);
              addFiles(Array.from(e.dataTransfer.files ?? []));
            }}
            className="mp-label w-full py-3 text-center"
            style={{
              borderRadius: 'var(--mp-radius)',
              border: `1px dashed ${over ? 'var(--mp-accent)' : 'var(--mp-border-hover)'}`,
              background: over ? 'var(--mp-surface-active)' : 'var(--mp-surface)',
              color: 'var(--mp-text-secondary)',
            }}
          >
            {files.length ? `${files.length} file${files.length === 1 ? '' : 's'} — add more` : 'Choose or drop files'}
          </button>
        </div>

        <div className="mp-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-4 py-3">
          {screens.length ? (
            <>
              <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
                SCREENS IN THIS PROJECT
              </span>
              {screens.map((s) => {
                const c = choice(s.key);
                const next = c >= 0 ? files[c] : null;
                return (
                  <div
                    key={s.key}
                    className="flex items-center gap-2 px-2 py-1.5"
                    style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface)' }}
                    data-screen-row={s.key}
                  >
                    <Thumb url={s.media} kind={s.kind} missing={!s.media} />
                    <span style={{ color: 'var(--mp-text-tertiary)', fontSize: 11 }}>→</span>
                    <Thumb url={next?.url ?? null} kind={next?.kind ?? 'image'} />
                    <div className="min-w-0 flex-1">
                      <div className="mp-label truncate" style={{ color: 'var(--mp-text-primary)' }}>
                        {s.name}
                      </div>
                      <div className="mp-label" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
                        {s.scenes.size} scene{s.scenes.size === 1 ? '' : 's'}
                        {!s.media ? ' · file missing' : ''}
                      </div>
                    </div>
                    <select
                      aria-label={`New file for ${s.name}`}
                      value={c}
                      onChange={(e) => setManual({ ...manual, [s.key]: Number(e.target.value) })}
                      className="mp-label"
                      style={selectStyle}
                    >
                      <option value={-1}>Keep current</option>
                      {files.map((f, i) => (
                        <option key={f.url} value={i}>
                          {f.file.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </>
          ) : (
            <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', lineHeight: 1.5 }}>
              No named screens yet. Every screen is named after its file when you upload it, and you can rename
              it under Source → Screen name. New files below can be added as scenes.
            </span>
          )}

          {loose.length ? (
            <>
              <span className="mp-label mt-2" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
                NOT MATCHED
              </span>
              {loose.map((i) => {
                const f = files[i];
                return (
                  <div
                    key={f.url}
                    className="flex items-center gap-2 px-2 py-1.5"
                    style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface)' }}
                    data-loose-file={f.file.name}
                  >
                    <Thumb url={f.url} kind={f.kind} />
                    <span className="mp-label min-w-0 flex-1 truncate" style={{ color: 'var(--mp-text-primary)' }}>
                      {f.file.name}
                    </span>
                    <select
                      aria-label={`What to do with ${f.file.name}`}
                      value={extraOf(i)}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'new' || v === 'ignore') setExtraChoice({ ...extraChoice, [i]: v });
                        else setManual({ ...manual, [v.slice(7)]: i });
                      }}
                      className="mp-label"
                      style={selectStyle}
                    >
                      <option value="ignore">Ignore</option>
                      <option value="new">Add as new scene</option>
                      {screens.map((s) => (
                        <option key={s.key} value={`screen:${s.key}`}>
                          Use for {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </>
          ) : null}
        </div>

        <div className="flex flex-col gap-1 p-4 pt-2">
          {redactable.length ? (
            <label className="mp-label flex cursor-pointer items-center gap-2 pb-1" style={{ color: 'var(--mp-text-secondary)' }}>
              <input
                type="checkbox"
                checked={reapply}
                onChange={(e) => setReapply(e.target.checked)}
                data-reapply-redactions
              />
              Re-apply hidden areas on {redactable.length} screen{redactable.length === 1 ? '' : 's'}
            </label>
          ) : null}
          <button
            disabled={!canApply || busy}
            data-update-screens-apply
            className="mp-label w-full py-2.5"
            style={{
              borderRadius: 'var(--mp-radius)',
              background: canApply ? 'var(--mp-accent)' : 'var(--mp-surface)',
              color: canApply ? '#fff' : 'var(--mp-text-tertiary)',
              fontWeight: 600,
            }}
            onClick={apply}
          >
            {busy
              ? 'Updating…'
              : !files.length
              ? 'Add your new screenshots'
              : canApply
                ? [
                    updating.length
                      ? `Update ${updating.length} screen${updating.length === 1 ? '' : 's'} (${scenesTouched} scene${scenesTouched === 1 ? '' : 's'})`
                      : '',
                    newCount ? `add ${newCount} scene${newCount === 1 ? '' : 's'}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'No screen selected'}
          </button>
          <button className="mp-label w-full py-1" style={{ color: 'var(--mp-text-tertiary)' }} onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Mount once in the editor; listen for the event and open the modal. */
export function UpdateScreensHost() {
  const [open, setOpen] = useState<{ files: File[]; n: number } | null>(null);
  useEffect(() => {
    let n = 0;
    const onOpen = (e: Event) => {
      const files = (e as CustomEvent<{ files?: File[] }>).detail?.files ?? [];
      n += 1;
      setOpen({ files, n });
    };
    window.addEventListener(UPDATE_SCREENS_EVENT, onOpen);
    return () => window.removeEventListener(UPDATE_SCREENS_EVENT, onOpen);
  }, []);
  if (!open) return null;
  return createPortal(
    <UpdateScreensModal key={open.n} initial={open.files} onClose={() => setOpen(null)} />,
    document.body,
  );
}
