'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '@/store/editor';
import { loadLaunchPackage } from '@/store/project';
import { getBackground, toCss } from '@/config/backgrounds';
import { downscaleLogo, getBrandKit } from '@/config/brandKit';
import { launchFileCount, launchOutputSpecs, type LaunchDirectionId } from '@/config/launch';
import {
  buildLaunchPackage,
  directionLook,
  LAUNCH_DIRECTIONS,
  LAUNCH_LIMITS,
  validateLaunchInput,
  validHex,
  type LaunchInput,
} from '@/lib/launchBuilder';
import { toast } from '@/components/shell/Toast';
import { track } from '@/lib/analytics';
import { openLaunchExport } from '@/components/shell/LaunchExportPanel';

/**
 * LAUNCH FACTORY: one form → a launch package (lib/launchBuilder.ts). Two steps: "Your product" (3–5
 * screens, name, value line, 3–5 features, colour, optional logo) → "Choose a direction" (three layout
 * previews, the video's screens) → the package replaces the open project (one Ctrl+Z undoes it).
 * Entry points: the goal dialog and `/editor/?start=launch-factory`.
 */

export const LAUNCH_EVENT = 'mockuptop:launch-factory';
export function openLaunchFactory() {
  window.dispatchEvent(new Event(LAUNCH_EVENT));
}

type Screen = { url: string; name: string };

const inputStyle: React.CSSProperties = {
  height: 'var(--mp-row-h)',
  borderRadius: 'var(--mp-radius)',
  background: 'var(--mp-surface)',
  border: '1px solid var(--mp-border)',
  color: 'var(--mp-text-primary)',
};
const smallBtn: React.CSSProperties = { color: 'var(--mp-text-tertiary)', fontSize: 9, lineHeight: 1 };
const FEATURE_HINTS = ['Plan the week in seconds', 'Share lists with your team', 'Works offline', 'Optional', 'Optional'];
/** Base language of the package (the ZIP's first folder); words are never translated automatically. */
const CONTENT_LANGS = ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt-BR', 'nl', 'pl', 'sv', 'da', 'nb', 'fi', 'cs', 'ru', 'uk', 'ar', 'he', 'hi', 'id', 'vi', 'th', 'ja', 'ko', 'zh-Hans'];
function langLabel(code: string): string {
  try {
    return `${new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code} (${code})`;
  } catch {
    return code;
  }
}

/** CSS layout preview of a direction: a store screenshot and a landscape image (not a 3D render). */
function DirectionPreview({ direction, color, screen, title, name }: { direction: LaunchDirectionId; color: string; screen: Screen; title: string; name: string }) {
  const look = directionLook(direction, color);
  const bg = toCss(getBackground(look.background));
  const left = look.align === 'left';
  const phone = (w: number, tilt: boolean) => (
    <div
      style={{
        width: w,
        aspectRatio: '1206 / 2622',
        borderRadius: w * 0.16,
        border: look.textBelow ? 'none' : `${Math.max(2, w * 0.05)}px solid #1d1e22`,
        overflow: 'hidden',
        background: '#000',
        transform: tilt ? 'perspective(300px) rotateY(-16deg) rotateX(4deg)' : undefined,
        boxShadow: '0 6px 14px rgba(0,0,0,0.18)',
        flexShrink: 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={screen.url} alt="" className="h-full w-full object-cover" />
    </div>
  );
  const head = (size: number) => (
    <span style={{ color: look.ink, fontWeight: look.weight, fontSize: size * look.scale, lineHeight: 1.12, textAlign: left ? 'left' : 'center', display: 'block' }}>{title}</span>
  );
  // Fixed sizes: a store screenshot (1206:2622) and a 16:9 image side by side.
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <div className="flex shrink-0 flex-col items-center justify-between overflow-hidden px-1.5 py-2" style={{ width: 64, height: 139, background: bg, borderRadius: 6 }}>
        {look.textBelow ? <span /> : <div className="w-full">{head(7)}</div>}
        {phone(38, direction === 'bold')}
        {look.textBelow ? <div className="w-full">{head(7)}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 overflow-hidden px-3" style={{ width: 248, height: 139, background: bg, borderRadius: 6 }}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span style={{ color: look.accent, fontSize: 7, fontWeight: 600 }}>{name}</span>
          <span style={{ color: look.ink, fontWeight: look.weight, fontSize: 11 * look.scale, lineHeight: 1.12 }}>{title}</span>
        </div>
        {phone(46, direction === 'bold')}
      </div>
    </div>
  );
}

function LaunchFactoryModal({ onClose }: { onClose: () => void }) {
  const [kit] = useState(getBrandKit);
  const [step, setStep] = useState<'product' | 'direction' | 'done'>('product');
  const [screens, setScreens] = useState<Screen[]>([]);
  const [appName, setAppName] = useState('');
  const [value, setValue] = useState('');
  const [features, setFeatures] = useState<string[]>(['', '', '', '', '']);
  const [color, setColor] = useState(validHex(kit.colors[0], '#4f5bd5'));
  const [useKitLogo, setUseKitLogo] = useState(!!kit.logo);
  const [logo, setLogo] = useState<string | null>(null);
  const [direction, setDirection] = useState<LaunchDirectionId>('clear');
  const [video, setVideo] = useState<number[]>([1, 2, 3]);
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState('en');
  const [overflow, setOverflow] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const font = kit.headingFont ?? 'Inter';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc closes from anywhere, form fields included; other keys keep their normal editing.
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!busy) onClose();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, busy]);

  /* Object URLs of picked screenshots: released on removal, and all of them if the dialog closes unbuilt. */
  const screensRef = useRef(screens);
  const built = useRef(false);
  useEffect(() => {
    screensRef.current = screens;
  }, [screens]);
  useEffect(
    () => () => {
      if (!built.current) screensRef.current.forEach((s) => URL.revokeObjectURL(s.url));
    },
    [],
  );

  /** Only images the browser can really decode become screens (a renamed text file is not one). */
  const [checking, setChecking] = useState(0);
  const addFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length < files.length) toast('Launch packages use screenshots (images)');
    const room = LAUNCH_LIMITS.screens[1] - screens.length;
    if (images.length > room) toast(`Up to ${LAUNCH_LIMITS.screens[1]} screenshots — the first ${room} were added`);
    const picked = images.slice(0, Math.max(0, room));
    setChecking((n) => n + 1);
    try {
      const added: Screen[] = [];
      for (const f of picked) {
        const url = URL.createObjectURL(f);
        const img = new Image();
        img.src = url;
        try {
          await img.decode();
          if (!img.naturalWidth) throw new Error('empty');
          added.push({ url, name: f.name });
        } catch {
          URL.revokeObjectURL(url);
          toast(`Could not read ${f.name} as an image`);
        }
      }
      if (added.length) setScreens((s) => [...s, ...added].slice(0, LAUNCH_LIMITS.screens[1]));
    } finally {
      setChecking((n) => n - 1);
    }
  };
  const removeScreen = (i: number) => {
    URL.revokeObjectURL(screens[i].url);
    setScreens((s) => s.filter((_, k) => k !== i));
  };
  const moveScreen = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= screens.length) return;
    setScreens((s) => {
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const input = (): LaunchInput => ({
    screens,
    appName,
    value,
    features,
    color,
    logo: logo ?? (useKitLogo ? kit.logo : null),
    font,
    videoScreens: video.map((v) => Math.min(v, Math.max(0, screens.length - 1))),
    direction,
  });
  const problem = checking ? 'Reading screenshots…' : validateLaunchInput(input());
  const filled = features.map((f) => f.trim()).filter(Boolean);
  const title = filled[0] || value || 'Your feature here';

  const create = async () => {
    if (problem || busy) return;
    setBusy(true);
    try {
      const b = await buildLaunchPackage(input());
      if (!b || !loadLaunchPackage(b, lang)) {
        toast('Could not create the launch package');
        return;
      }
      built.current = true;
      setOverflow(b.overflow);
      track('launch_factory_create', { direction, screens: screens.length, features: filled.length });
      setStep('done');
    } finally {
      setBusy(false);
    }
  };

  const outs = launchOutputSpecs();
  return (
    <div
      className="fixed inset-0 z-[950] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,10,14,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Launch Factory"
        data-launch-factory
        className="mp-scroll flex max-h-[92vh] w-full max-w-[600px] flex-col overflow-y-auto"
        style={{ background: 'var(--mp-dropdown)', border: '1px solid var(--mp-border)', borderRadius: 'var(--mp-radius-lg)', boxShadow: 'var(--mp-shadow-dropdown)' }}
        onClick={(e) => e.stopPropagation()}
        // Keep drops inside the dialog: the editor's own drop handler would add scenes behind it.
        onDragOver={(e) => {
          e.stopPropagation();
          if (step === 'product') e.preventDefault();
        }}
        onDrop={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (step === 'product') void addFiles(Array.from(e.dataTransfer.files ?? []));
        }}
      >
        <div className="flex flex-col gap-1 p-4 pb-3">
          <span className="mp-label" style={{ color: 'var(--mp-text-primary)', fontSize: 13, fontWeight: 700 }}>
            {step === 'done' ? 'Your launch package is ready' : step === 'direction' ? 'Choose a direction' : 'Launch Factory'}
          </span>
          <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', lineHeight: 1.5 }}>
            {step === 'done'
              ? `${useEditor.getState().shots.length} editable scenes: the promo video plays first, then one scene per image.`
              : step === 'direction'
                ? 'Three looks for the same story. Everything stays editable afterwards.'
                : `Your screens and words in, a whole launch set out: 6 store screenshots in iPhone and Google Play sizes, a feature graphic, 3 social images and a 20 s promo video — ${launchFileCount(outs)} files in one ZIP. Made on your device.`}
          </span>
        </div>

        {step === 'product' ? (
          <div className="flex flex-col gap-3 px-4 pb-4">
            <div className="grid grid-cols-5 gap-2">
              {screens.map((s, i) => (
                <div key={s.url} className="flex min-w-0 flex-col gap-1" data-launch-screen={i}>
                  <div className="relative overflow-hidden" style={{ aspectRatio: '9 / 19.5', borderRadius: 'var(--mp-radius)', border: '1px solid var(--mp-border-hover)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.url} alt="" className="h-full w-full object-cover" />
                    <span className="mp-label absolute left-1 top-1 px-1" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 4, fontSize: 9 }}>
                      {i === 0 ? 'Main' : i + 1}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <button className="mp-label" style={smallBtn} onClick={() => moveScreen(i, -1)} disabled={i === 0} aria-label={`Move screen ${i + 1} left`}>
                      ◀
                    </button>
                    <button className="mp-label" style={smallBtn} onClick={() => removeScreen(i)} aria-label={`Remove screen ${i + 1}`}>
                      ✕
                    </button>
                    <button className="mp-label" style={smallBtn} onClick={() => moveScreen(i, 1)} disabled={i === screens.length - 1} aria-label={`Move screen ${i + 1} right`}>
                      ▶
                    </button>
                  </div>
                </div>
              ))}
              {screens.length < LAUNCH_LIMITS.screens[1] ? (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="grid place-items-center"
                  style={{ aspectRatio: '9 / 19.5', borderRadius: 'var(--mp-radius)', border: '1px dashed var(--mp-border-hover)', background: 'var(--mp-surface)' }}
                  data-launch-add
                >
                  <span className="mp-label px-1 text-center" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9, lineHeight: 1.4 }}>
                    + Add screenshots
                  </span>
                </button>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              data-launch-files
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
              3–5 app screenshots; the first is your main screen. Drop several at once on this window.
            </span>

            <div className="flex flex-col gap-1.5">
              <input value={appName} maxLength={LAUNCH_LIMITS.appName} placeholder="App name — e.g. Orbit" onChange={(e) => setAppName(e.target.value)} className="mp-label w-full px-2.5" style={inputStyle} aria-label="App name" data-launch-field="name" />
              <input value={value} maxLength={LAUNCH_LIMITS.value} placeholder="What it does for people, in one line — e.g. Plan your week in one calm place" onChange={(e) => setValue(e.target.value)} className="mp-label w-full px-2.5" style={inputStyle} aria-label="One-line value" data-launch-field="value" />
              {features.map((f, i) => (
                <input
                  key={i}
                  value={f}
                  maxLength={LAUNCH_LIMITS.feature}
                  placeholder={`Feature ${i + 1}${i < 3 ? '' : ' (optional)'} — ${FEATURE_HINTS[i]}`}
                  onChange={(e) => setFeatures((list) => list.map((x, k) => (k === i ? e.target.value : x)))}
                  className="mp-label w-full px-2.5"
                  style={inputStyle}
                  aria-label={`Feature ${i + 1}`}
                  data-launch-field={`feature-${i + 1}`}
                />
              ))}
              <label className="mp-label flex items-center gap-2 px-2.5" style={inputStyle}>
                <span className="flex-1" style={{ color: 'var(--mp-text-secondary)' }}>
                  Language of these words
                </span>
                <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Content language" className="mp-label" style={{ background: 'transparent', color: 'var(--mp-text-primary)' }} data-launch-lang>
                  {CONTENT_LANGS.map((code) => (
                    <option key={code} value={code}>
                      {langLabel(code)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mp-label flex items-center gap-2 px-2.5" style={inputStyle}>
                <span className="flex-1" style={{ color: 'var(--mp-text-secondary)' }}>
                  Brand colour
                </span>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Brand colour" style={{ width: 28, height: 18, border: 0, background: 'transparent', padding: 0 }} />
                <span style={{ color: 'var(--mp-text-tertiary)' }}>{color}</span>
              </label>
              <div className="mp-label flex items-center gap-2 px-2.5" style={inputStyle}>
                <span className="flex-1" style={{ color: 'var(--mp-text-secondary)' }}>
                  Logo (optional)
                </span>
                {kit.logo && !logo ? (
                  <label className="flex items-center gap-1" style={{ color: 'var(--mp-text-tertiary)' }}>
                    <input type="checkbox" checked={useKitLogo} onChange={(e) => setUseKitLogo(e.target.checked)} /> brand kit logo
                  </label>
                ) : null}
                {logo ? (
                  <button className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }} onClick={() => setLogo(null)}>
                    Remove file
                  </button>
                ) : (
                  <button className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }} onClick={() => logoRef.current?.click()}>
                    Choose file…
                  </button>
                )}
                <input
                  ref={logoRef}
                  type="file"
                  accept="image/png,image/webp,image/jpeg,image/svg+xml"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    try {
                      setLogo(await downscaleLogo(f));
                    } catch {
                      toast('Could not read that logo');
                    }
                  }}
                />
              </div>
            </div>

            <button
              disabled={!!problem}
              onClick={() => setStep('direction')}
              className="mp-label w-full py-2.5"
              style={{ borderRadius: 'var(--mp-radius)', background: problem ? 'var(--mp-surface)' : 'var(--mp-accent)', color: problem ? 'var(--mp-text-tertiary)' : '#fff', fontWeight: 600 }}
              data-launch-next
            >
              {problem ?? 'Next — choose a direction'}
            </button>
            <button className="mp-label w-full py-1" style={{ color: 'var(--mp-text-tertiary)' }} onClick={onClose}>
              Cancel
            </button>
          </div>
        ) : step === 'direction' ? (
          <div className="flex flex-col gap-3 px-4 pb-4">
            <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Direction">
              {LAUNCH_DIRECTIONS.map((d) => (
                <button
                  key={d.id}
                  role="radio"
                  aria-checked={direction === d.id}
                  onClick={() => setDirection(d.id)}
                  className="flex flex-col gap-1.5 p-2 text-left"
                  style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface)', border: `1px solid ${direction === d.id ? 'var(--mp-accent)' : 'var(--mp-border)'}` }}
                  data-launch-direction={d.id}
                >
                  <span className="mp-label" style={{ color: 'var(--mp-text-primary)', fontWeight: 700 }}>
                    {d.label} <span style={{ color: 'var(--mp-text-tertiary)', fontWeight: 400 }}>· {d.hint}</span>
                  </span>
                  <DirectionPreview direction={d.id} color={color} screen={screens[0]} title={title} name={appName.trim() || 'App name'} />
                </button>
              ))}
              <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
                Layout previews — the 3D scenes are made when you create the package.
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="mp-label" style={{ color: 'var(--mp-text-secondary)' }}>
                Promo video: main screen opens and closes it; pick its three feature scenes
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {[0, 1, 2].map((k) => (
                  <select
                    key={k}
                    value={Math.min(video[k], screens.length - 1)}
                    onChange={(e) => setVideo((v) => v.map((x, i) => (i === k ? Number(e.target.value) : x)))}
                    className="mp-label px-1.5"
                    style={inputStyle}
                    aria-label={`Video feature scene ${k + 1}`}
                    data-launch-video={k}
                  >
                    {screens.map((_, i) => (
                      <option key={i} value={i}>
                        {k + 1}: {i === 0 ? 'Main screen' : `Screen ${i + 1}`} — {filled[k] ?? ''}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            </div>
            <button
              disabled={busy}
              onClick={create}
              className="mp-label w-full py-2.5"
              style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-accent)', color: '#fff', fontWeight: 600, opacity: busy ? 0.6 : 1 }}
              data-launch-create
            >
              {busy ? 'Creating…' : 'Create launch package — replaces the open project (Ctrl+Z undoes)'}
            </button>
            <button className="mp-label w-full py-1" style={{ color: 'var(--mp-text-tertiary)' }} onClick={() => setStep('product')} disabled={busy}>
              ← Back
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 px-4 pb-4">
            {[
              ['6 store screenshots', 'iPhone medium 1206×2622, iPhone large 1290×2796, Google Play 1080×1920'],
              ['Google Play feature graphic', '1024×500'],
              ['3 social images', 'Square 1080×1080, portrait 1080×1350, landscape / cover 1920×1080'],
              ['Promo video', '1920×1080, 20 s, 30 fps — plays first in the timeline'],
            ].map(([a, b]) => (
              <div key={a} className="flex flex-col gap-0.5 p-2.5" style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface)' }}>
                <span className="mp-label" style={{ color: 'var(--mp-text-primary)' }}>
                  {a}
                </span>
                <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
                  {b}
                </span>
              </div>
            ))}
            {overflow.length ? (
              <span className="mp-label p-2" style={{ color: 'var(--mp-warning, #b26a00)', lineHeight: 1.5 }} data-launch-overflow>
                Text was made smaller to fit, and may still be tight, in: {overflow.join(', ')}. Shorter words read better — edit those scenes, or go back and shorten the line.
              </span>
            ) : null}
            <div className="flex gap-1.5 pt-1">
              <button
                className="mp-label flex-1 py-2.5"
                style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-accent)', color: '#fff', fontWeight: 600 }}
                onClick={() => {
                  onClose();
                  openLaunchExport();
                }}
                data-launch-export
              >
                Export launch package
              </button>
              <button className="mp-label flex-1 py-2.5" style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface-active)' }} onClick={onClose}>
                Edit scenes first
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function LaunchFactoryHost() {
  const [open, setOpen] = useState(0);
  useEffect(() => {
    const onOpen = () => setOpen((n) => n + 1);
    window.addEventListener(LAUNCH_EVENT, onOpen);
    return () => window.removeEventListener(LAUNCH_EVENT, onOpen);
  }, []);
  if (!open) return null;
  return createPortal(<LaunchFactoryModal key={open} onClose={() => setOpen(0)} />, document.body);
}
