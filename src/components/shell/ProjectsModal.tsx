'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '@/store/editor';
import { exportProject } from '@/store/project';
import { shelfCurrentId, subscribeShelfCurrent } from '@/store/shelfState';
import {
  clearDeviceData,
  deleteProject,
  deviceMediaEnabled,
  deviceUsage,
  duplicateProject,
  listProjects,
  openProject,
  renameProject,
  saveProjectAs,
  setDeviceMediaEnabled,
  type ShelfProject,
} from '@/store/shelf';
import { downloadBlob } from '@/components/scene/exportBridge';
import { BRAND } from '@/config/brand';
import { toast } from '@/components/shell/Toast';
import { track } from '@/lib/analytics';

/**
 * PROJECTS: this device's project shelf (store/shelf.ts).

 * The scope is explicit: "in this browser". Clearing browser data removes
 * projects, so offer a file backup (Save project) beside storage usage.
 * Use inline Yes/No deletion confirmation; browser confirm() blocks automation
 * and locks focus.
 */

export const PROJECTS_EVENT = 'mockuptop:projects';
export function openProjects() {
  window.dispatchEvent(new Event(PROJECTS_EVENT));
}

const fmtBytes = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
const fmtDate = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};

const inputStyle: React.CSSProperties = {
  height: 'var(--mp-row-h)',
  borderRadius: 'var(--mp-radius)',
  background: 'var(--mp-surface)',
  border: '1px solid var(--mp-border)',
  color: 'var(--mp-text-primary)',
};

/** Suggested name: first named screen, or the date. */
function suggestName(): string {
  const s = useEditor.getState();
  const first = s.shots.find((x) => x.screenName)?.screenName;
  const d = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return first ? `${first.replace(/-/g, ' ')} — ${d}` : `Project — ${d}`;
}

function ProjectRow({
  p,
  current,
  thumb,
  onChanged,
  onOpened,
}: {
  p: ShelfProject;
  current: boolean;
  thumb: string | null;
  onChanged: () => void;
  onOpened: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(p.name);
  const [confirmDel, setConfirmDel] = useState(false);
  const btn = 'mp-label px-2 py-1';
  const btnStyle: React.CSSProperties = { borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface-active)' };
  return (
    <div
      className="flex items-center gap-2.5 p-2"
      style={{
        borderRadius: 'var(--mp-radius)',
        background: 'var(--mp-surface)',
        outline: current ? '1px solid var(--mp-accent)' : undefined,
      }}
      data-project-row={p.name}
    >
      <div
        className="shrink-0 overflow-hidden"
        style={{ width: 64, height: 40, borderRadius: 5, background: 'var(--mp-surface-active)', border: '1px solid var(--mp-border)' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter') {
                await renameProject(p.id, name);
                setRenaming(false);
                onChanged();
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setRenaming(false);
                setName(p.name);
              }
            }}
            onBlur={async () => {
              await renameProject(p.id, name);
              setRenaming(false);
              onChanged();
            }}
            className="mp-label w-full px-2"
            style={inputStyle}
            aria-label="Project name"
          />
        ) : (
          <div className="mp-label truncate" style={{ color: 'var(--mp-text-primary)' }}>
            {p.name}
            {current ? <span style={{ color: 'var(--mp-accent)' }}> · open</span> : null}
          </div>
        )}
        <div className="mp-label" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
          {p.scenes} scene{p.scenes === 1 ? '' : 's'} · {fmtDate(p.updatedAt)} · {fmtBytes(p.bytes)}
        </div>
      </div>
      {confirmDel ? (
        <div className="flex shrink-0 items-center gap-1">
          <span className="mp-label" style={{ color: 'var(--mp-text-secondary)', fontSize: 9 }}>
            Delete?
          </span>
          <button
            className={btn}
            style={{ ...btnStyle, background: '#d64545', color: '#fff' }}
            onClick={async () => {
              await deleteProject(p.id);
              track('shelf_delete');
              onChanged();
            }}
          >
            Delete
          </button>
          <button className={btn} style={btnStyle} onClick={() => setConfirmDel(false)}>
            Keep
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          {!current ? (
            <button
              className={btn}
              style={{ ...btnStyle, background: 'var(--mp-accent)', color: '#fff' }}
              data-project-open
              onClick={async () => {
                const ok = await openProject(p.id);
                track('shelf_open', { ok });
                toast(ok ? `Opened “${p.name}” — Ctrl+Z goes back` : 'Could not open this project');
                if (ok) onOpened();
              }}
            >
              Open
            </button>
          ) : null}
          <button className={btn} style={btnStyle} onClick={() => setRenaming(true)} title="Rename">
            Rename
          </button>
          <button
            className={btn}
            style={btnStyle}
            title="Duplicate"
            onClick={async () => {
              await duplicateProject(p.id);
              onChanged();
            }}
          >
            Copy
          </button>
          <button className={btn} style={btnStyle} title="Delete" onClick={() => setConfirmDel(true)} data-project-delete>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function ProjectsModal({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useState<ShelfProject[] | null>(null);
  const [usage, setUsage] = useState<{ bytes: number; quota: number | null } | null>(null);
  const [name, setName] = useState(suggestName);
  const [busy, setBusy] = useState(false);
  const [keepMedia, setKeepMedia] = useState(deviceMediaEnabled);
  const [confirmClear, setConfirmClear] = useState(false);
  const currentId = useSyncExternalStore(subscribeShelfCurrent, shelfCurrentId, () => null);

  const refresh = useCallback(async () => {
    const [list, u] = await Promise.all([listProjects(), deviceUsage()]);
    setProjects(list);
    setUsage(u);
  }, []);
  useEffect(() => {
    // Initial list: IndexedDB resolves asynchronously, then updates state; no synchronous setState in the effect.
    let off = false;
    void Promise.all([listProjects(), deviceUsage()]).then(([list, u]) => {
      if (off) return;
      setProjects(list);
      setUsage(u);
    });
    return () => {
      off = true;
    };
  }, []);

  // Thumbnail Blob URLs are released when the dialog closes.
  const thumbs = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects ?? []) if (p.thumb) m.set(p.id, URL.createObjectURL(p.thumb));
    return m;
  }, [projects]);
  useEffect(() => () => thumbs.forEach((u) => URL.revokeObjectURL(u)), [thumbs]);

  // Isolate keyboard input (see RedactModal) so Delete/Space cannot reach the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      e.stopPropagation();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const current = projects?.find((p) => p.id === currentId) ?? null;

  const save = async () => {
    setBusy(true);
    try {
      const rec = await saveProjectAs(name);
      track('shelf_save', { scenes: rec.scenes });
      toast(`Saved “${rec.name}” on this device — changes keep saving to it`);
      await refresh();
    } catch {
      toast('Could not save — browser storage may be full');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[950] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,10,14,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Projects"
        className="flex max-h-[86vh] w-full max-w-[520px] flex-col overflow-hidden"
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
            Projects on this device
          </span>
          <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', lineHeight: 1.5 }}>
            Saved in this browser with their screenshots, videos and music — nothing is uploaded. Clearing site
            data removes them, so download a backup for anything you can’t lose.
          </span>
        </div>

        <div className="flex gap-1.5 px-4">
          {current ? (
            <div
              className="mp-label flex flex-1 items-center px-2.5"
              style={{ ...inputStyle, color: 'var(--mp-text-secondary)' }}
              data-shelf-current
            >
              Open project: {current.name} — saving automatically
            </div>
          ) : (
            <input
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && void save()}
              className="mp-label min-w-0 flex-1 px-2.5"
              style={inputStyle}
              aria-label="Name for this project"
              data-shelf-name
            />
          )}
          <button
            disabled={busy}
            onClick={save}
            className="mp-label shrink-0 px-3"
            style={{ height: 'var(--mp-row-h)', borderRadius: 'var(--mp-radius)', background: 'var(--mp-accent)', color: '#fff', fontWeight: 600 }}
            data-shelf-save
          >
            {busy ? 'Saving…' : current ? 'Save as copy' : 'Save'}
          </button>
        </div>

        <div className="mp-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-4 py-3">
          {projects === null ? (
            <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }}>
              Loading…
            </span>
          ) : projects.length ? (
            projects.map((p) => (
              <ProjectRow
                key={p.id + p.updatedAt}
                p={p}
                current={p.id === currentId}
                thumb={thumbs.get(p.id) ?? null}
                onChanged={refresh}
                onOpened={onClose}
              />
            ))
          ) : (
            <span className="mp-label py-3 text-center" style={{ color: 'var(--mp-text-tertiary)', lineHeight: 1.5 }}>
              No saved projects yet. Name this one and press Save — you can come back to it any time, files included.
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2 p-4 pt-2" style={{ borderTop: '1px solid var(--mp-border)' }}>
          <div className="mp-label flex items-center justify-between gap-2" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
            <span data-shelf-usage>
              {usage ? `Using ${fmtBytes(usage.bytes)} on this device` : ' '}
              {usage?.quota ? ` of ${fmtBytes(usage.quota)} available` : ''}
            </span>
            <button
              className="mp-label underline"
              style={{ fontSize: 9 }}
              onClick={async () => {
                const blob = await exportProject();
                downloadBlob(blob, `${BRAND.fileSlug}-project.json`);
              }}
            >
              Download backup of the open project
            </button>
          </div>
          <label className="mp-label flex cursor-pointer items-center gap-2" style={{ color: 'var(--mp-text-secondary)' }}>
            <input
              type="checkbox"
              checked={keepMedia}
              data-shelf-keep-media
              onChange={async (e) => {
                setKeepMedia(e.target.checked);
                await setDeviceMediaEnabled(e.target.checked);
                await refresh();
              }}
            />
            Keep the open project’s files after a refresh
          </label>
          <div className="flex items-center justify-between">
            {confirmClear ? (
              <span className="mp-label flex items-center gap-2" style={{ color: 'var(--mp-text-secondary)', fontSize: 9 }}>
                Remove every saved project and file from this browser?
                <button
                  className="mp-label px-2 py-1"
                  style={{ borderRadius: 'var(--mp-radius)', background: '#d64545', color: '#fff' }}
                  onClick={async () => {
                    await clearDeviceData();
                    setConfirmClear(false);
                    toast('Saved projects and files removed from this browser');
                    await refresh();
                  }}
                >
                  Remove all
                </button>
                <button className="mp-label underline" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="mp-label underline" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }} onClick={() => setConfirmClear(true)}>
                Remove all saved data
              </button>
            )}
            <button className="mp-label px-2 py-1" style={{ color: 'var(--mp-text-tertiary)' }} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectsHost() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const onOpen = () => setN((v) => v + 1);
    window.addEventListener(PROJECTS_EVENT, onOpen);
    return () => window.removeEventListener(PROJECTS_EVENT, onOpen);
  }, []);
  const [closed, setClosed] = useState(0);
  if (n === 0 || closed === n) return null;
  return createPortal(<ProjectsModal key={n} onClose={() => setClosed(n)} />, document.body);
}
