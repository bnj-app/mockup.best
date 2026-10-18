'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPack, PACKS, suggestSlot, type Pack, type PackId, type PackMedia } from '@/config/packs';
import { loadPack } from '@/store/project';
import { toast } from '@/components/shell/Toast';
import { track } from '@/lib/analytics';

/**
 * START FROM A GOAL: choose a goal, drop screens, get a ready project (config/packs.ts). Three
 * steps: goal → screens and short copy → output list.
 * Entry points: hamburger, Templates menu, empty-project picker and `/editor/?start=<pack>` deep
 * links, which open the selected pack.
 */

export const GOAL_EVENT = 'mockuptop:goal-pack';
export const OPEN_EXPORT_EVENT = 'mockuptop:open-export';
export function openGoalPack(pack?: PackId) {
  window.dispatchEvent(new CustomEvent(GOAL_EVENT, { detail: { pack } }));
}

const inputStyle: React.CSSProperties = {
  height: 'var(--mp-row-h)',
  borderRadius: 'var(--mp-radius)',
  background: 'var(--mp-surface)',
  border: '1px solid var(--mp-border)',
  color: 'var(--mp-text-primary)',
};

const PACK_ICON: Record<PackId, string> = {
  'feature-launch': '▶',
  'app-store': '▦',
  portfolio: '◧',
};

function SlotTile({
  label,
  hint,
  media,
  required,
  onPick,
  onClear,
}: {
  label: string;
  hint: string;
  media?: PackMedia;
  required?: boolean;
  onPick: (f: File) => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1" data-pack-slot={label}>
      <button
        type="button"
        onClick={() => ref.current?.click()}
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
          const f = e.dataTransfer.files?.[0];
          if (f) onPick(f);
        }}
        className="relative grid w-full place-items-center overflow-hidden"
        style={{
          aspectRatio: '3 / 4',
          borderRadius: 'var(--mp-radius)',
          border: `1px ${media ? 'solid' : 'dashed'} ${over ? 'var(--mp-accent)' : 'var(--mp-border-hover)'}`,
          background: over ? 'var(--mp-surface-active)' : 'var(--mp-surface)',
        }}
        aria-label={`${label}${media ? ` — ${media.name}` : ''}`}
      >
        {media ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.url} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="mp-label px-1 text-center" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9, lineHeight: 1.4 }}>
            + {required ? 'Add' : 'Optional'}
          </span>
        )}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
      <div className="flex min-w-0 items-center justify-between gap-1">
        <span className="mp-label truncate" style={{ color: 'var(--mp-text-secondary)', fontSize: 9 }} title={hint}>
          {label}
          {required ? ' *' : ''}
        </span>
        {media ? (
          <button className="mp-label" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }} onClick={onClear} aria-label={`Remove ${label}`}>
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}

function GoalPackModal({ initial, onClose }: { initial: PackId | null; onClose: () => void }) {
  const [pack, setPack] = useState<Pack | null>(() => getPack(initial));
  const [media, setMedia] = useState<Record<string, PackMedia>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [color, setColor] = useState<string>(() => getPack(initial)?.defaultColor ?? '#4f5bd5');
  const [done, setDone] = useState(false);

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

  const choose = (p: Pack) => {
    setPack(p);
    setColor(p.defaultColor);
    setMedia({});
    setTexts({});
  };

  const put = (slot: string, f: File) => {
    if (!f.type.startsWith('image/')) {
      toast('Packs use screenshots (images) — add videos to a scene afterwards');
      return;
    }
    setMedia((m) => ({ ...m, [slot]: { url: URL.createObjectURL(f), name: f.name, kind: 'image' } }));
  };

  // If multiple files are dropped into the dialog, match slots by name, otherwise use the first empty slot.
  const dropMany = (files: File[]) => {
    if (!pack) return;
    const taken = new Set(Object.keys(media));
    const next = { ...media };
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const slot = suggestSlot(pack, f.name, taken);
      if (!slot) break;
      taken.add(slot);
      next[slot] = { url: URL.createObjectURL(f), name: f.name, kind: 'image' };
    }
    setMedia(next);
  };

  const ready = !!pack && pack.slots.every((s) => !s.required || media[s.name]);

  const build = () => {
    if (!pack || !ready) return;
    const ok = loadPack(pack, { media, texts, color });
    if (!ok) {
      toast('Could not build this pack');
      return;
    }
    track('goal_pack_build', { pack: pack.id, screens: Object.keys(media).length });
    setDone(true);
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
        aria-label="Start from a goal"
        className="mp-scroll flex max-h-[90vh] w-full max-w-[540px] flex-col overflow-y-auto"
        style={{
          background: 'var(--mp-dropdown)',
          border: '1px solid var(--mp-border)',
          borderRadius: 'var(--mp-radius-lg)',
          boxShadow: 'var(--mp-shadow-dropdown)',
        }}
        onClick={(e) => e.stopPropagation()}
        /*
          stopPropagation is required: the portal lives in body, but React events bubble through
          the component tree. Drops also reached the editor's <main> onDrop, opening "Update
          screens" behind the dialog and adding scenes.
        */
        onDragOver={(e) => {
          e.stopPropagation();
          if (pack && !done) e.preventDefault();
        }}
        onDrop={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (!pack || done) return;
          dropMany(Array.from(e.dataTransfer.files ?? []));
        }}
      >
        <div className="flex flex-col gap-1 p-4 pb-3">
          <span className="mp-label" style={{ color: 'var(--mp-text-primary)', fontSize: 13, fontWeight: 700 }}>
            {done ? `${pack?.title} is ready` : pack ? pack.title : 'Start from a goal'}
          </span>
          <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', lineHeight: 1.5 }}>
            {done
              ? 'Every scene is editable. Here is what to export for this goal:'
              : pack
                ? pack.tagline
                : 'Pick what you are making. You get the scenes, the text spots and the right export list — drop your screens in and adjust anything after.'}
          </span>
        </div>

        {!pack ? (
          <div className="flex flex-col gap-1.5 px-4 pb-4">
            {PACKS.map((p) => (
              <button
                key={p.id}
                onClick={() => choose(p)}
                className="flex items-start gap-3 p-3 text-left"
                style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface)', border: '1px solid var(--mp-border)' }}
                data-pack-card={p.id}
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center"
                  style={{ borderRadius: 8, background: 'var(--mp-surface-active)', color: 'var(--mp-text-primary)', fontSize: 15 }}
                  aria-hidden
                >
                  {PACK_ICON[p.id]}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="mp-label" style={{ color: 'var(--mp-text-primary)', fontWeight: 700 }}>
                    {p.title}
                  </span>
                  <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', lineHeight: 1.45 }}>
                    {p.tagline}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : done ? (
          <div className="flex flex-col gap-1.5 px-4 pb-4">
            {pack.outputs.map((o) => (
              <div key={o.label} className="flex flex-col gap-0.5 p-2.5" style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface)' }}>
                <span className="mp-label" style={{ color: 'var(--mp-text-primary)' }}>
                  {o.label}
                </span>
                <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
                  {o.where}
                </span>
              </div>
            ))}
            <span className="mp-label pt-1" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9, lineHeight: 1.5 }}>
              Screens are named ({pack.slots.map((s) => s.name).slice(0, 3).join(', ')}…). When your app changes, drop the new
              screenshots on Menu → Update screens and every scene updates at once.
            </span>
            <div className="flex gap-1.5 pt-1">
              <button
                className="mp-label flex-1 py-2.5"
                style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-accent)', color: '#fff', fontWeight: 600 }}
                onClick={() => {
                  onClose();
                  window.dispatchEvent(new Event(OPEN_EXPORT_EVENT));
                }}
                data-pack-export
              >
                Open Export
              </button>
              <button className="mp-label flex-1 py-2.5" style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface-active)' }} onClick={onClose}>
                Edit scenes first
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-4 pb-4">
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(5, pack.slots.length)}, minmax(0, 1fr))` }}>
              {pack.slots.map((s) => (
                <SlotTile
                  key={s.name}
                  label={s.label}
                  hint={s.hint}
                  required={s.required}
                  media={media[s.name]}
                  onPick={(f) => put(s.name, f)}
                  onClear={() =>
                    setMedia((m) => {
                      const next = { ...m };
                      delete next[s.name];
                      return next;
                    })
                  }
                />
              ))}
            </div>
            <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
              Tip: drop several screenshots on this window at once — files named like the slots (screen-2.png) go to that slot.
            </span>

            <div className="flex flex-col gap-1.5">
              {pack.fields
                .filter((f) => !pack.slots.some((s) => s.name === f.id) || media[f.id])
                .map((f) => (
                  <input
                    key={f.id}
                    value={texts[f.id] ?? ''}
                    maxLength={f.max}
                    placeholder={`${f.label} — ${f.placeholder}`}
                    onChange={(e) => setTexts({ ...texts, [f.id]: e.target.value })}
                    className="mp-label w-full px-2.5"
                    style={inputStyle}
                    aria-label={f.label}
                    data-pack-field={f.id}
                  />
                ))}
              <label className="mp-label flex items-center gap-2 px-2.5" style={inputStyle}>
                <span className="flex-1" style={{ color: 'var(--mp-text-secondary)' }}>
                  Brand color
                </span>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  aria-label="Brand color"
                  style={{ width: 28, height: 18, border: 0, background: 'transparent', padding: 0 }}
                />
                <span style={{ color: 'var(--mp-text-tertiary)' }}>{color}</span>
              </label>
            </div>

            <button
              disabled={!ready}
              onClick={build}
              className="mp-label w-full py-2.5"
              style={{
                borderRadius: 'var(--mp-radius)',
                background: ready ? 'var(--mp-accent)' : 'var(--mp-surface)',
                color: ready ? '#fff' : 'var(--mp-text-tertiary)',
                fontWeight: 600,
              }}
              data-pack-build
            >
              {ready ? `Build ${pack.title.toLowerCase()} — replaces the open project (Ctrl+Z undoes)` : `Add the ${pack.slots.find((s) => s.required)?.label.toLowerCase()} first`}
            </button>
            <button className="mp-label w-full py-1" style={{ color: 'var(--mp-text-tertiary)' }} onClick={() => (initial ? onClose() : setPack(null))}>
              {initial ? 'Cancel' : '← Other goals'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function GoalPackHost() {
  const [open, setOpen] = useState<{ pack: PackId | null; n: number } | null>(null);
  useEffect(() => {
    let n = 0;
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ pack?: PackId }>).detail?.pack ?? null;
      n += 1;
      setOpen({ pack: getPack(id)?.id ?? null, n });
    };
    window.addEventListener(GOAL_EVENT, onOpen);
    return () => window.removeEventListener(GOAL_EVENT, onOpen);
  }, []);
  if (!open) return null;
  return createPortal(<GoalPackModal key={open.n} initial={open.pack} onClose={() => setOpen(null)} />, document.body);
}
