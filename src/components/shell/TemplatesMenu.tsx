'use client';

import { openGoalPack } from '@/components/shell/GoalPackModal';
import { getBackground, toCss } from '@/config/backgrounds';
import { getDevice } from '@/config/devices';
import { TEMPLATES, TEMPLATE_GROUPS } from '@/config/templates';
import { useEditor } from '@/store/editor';
import { useEffect, useState } from 'react';
import { deleteUserTemplate, saveUserTemplate, useUserTemplates } from '@/config/userTemplates';
import { toast } from '@/components/shell/Toast';
import { cachedThumb, cancelTemplateThumbs, renderTemplateThumbs } from '@/components/shell/templateThumbs';

/**
 * Template card preview.
 * Rendering real 3D previews in small cards would require 12 separate scenes and slow startup.
 * Instead, draw each template's own background with a device silhouette so background, device and
 * angle are immediately visible at negligible cost.
 */
function Preview({ id, backgroundId, deviceId, tiltY, roll, video = true, thumb = null }: {
  id: string;
  backgroundId: string;
  deviceId: string;
  tiltY: number;
  roll: number;
  /** User templates have no prebuilt video preview; avoid two pointless 404 requests. */
  video?: boolean;
  /** A frame rendered with the user's OWN screen (templateThumbs) takes priority when available. */
  thumb?: string | null;
}) {
  const bg = getBackground(backgroundId);
  const device = getDevice(deviceId);
  /*
    Use the REAL device aspect ratio for the silhouette. Two fixed portrait/landscape shapes made
    watch templates resemble phones. Read ratio and corner radius from config so watches look
    square and rounded, laptops wide, and phones tall and narrow.
  */
  const aspect = device.body.w / device.body.h;
  // Fit proportionally into a 58×48 box.
  let w = Math.min(58, 48 * aspect);
  let h = w / aspect;
  if (h > 48) {
    h = 48;
    w = 48 * aspect;
  }
  w = Math.round(w);
  h = Math.round(h);
  const cornerRatio = device.body.radius / Math.min(device.body.w, device.body.h);
  const radius = Math.max(3, Math.min(w, h) * cornerRatio);

  return (
    <span
      className="relative block h-20 w-full overflow-hidden"
      style={{ background: toCss(bg), borderRadius: 6 }}
    >
      <span
        className="mp-tpl-float absolute left-1/2 top-1/2 block"
        style={{
          width: w,
          height: h,
          marginLeft: -w / 2,
          marginTop: -h / 2,
          borderRadius: radius,
          background: 'rgba(15,17,21,0.82)',
          border: '1px solid rgba(255,255,255,0.35)',
          boxShadow: '0 6px 14px rgba(0,0,0,0.28)',
          // Suggest the angle with subtle perspective: real rotation is hard to read
          // on a tiny card, while a slight tilt conveys enough information.
          transform: `perspective(160px) rotateY(${Math.max(-32, Math.min(32, tiltY)) * 0.6}deg) rotate(${roll}deg)`,
        }}
      />
      {/*
        REAL video previews: short loops generated offline under public/templates/. Once loaded,
        video overlays the silhouette. If missing or unplayable (older browser or missing codec),
        remove it and keep the silhouette so the card is never blank.
      */}
      {video && !thumb ? (
      <video
        className="absolute inset-0 h-full w-full object-cover"
        style={{ opacity: 0, transition: 'opacity .25s' }}
        muted
        loop
        autoPlay
        playsInline
        onLoadedData={(e) => {
          e.currentTarget.style.opacity = '1';
        }}
        onError={(e) => {
          e.currentTarget.remove();
        }}
      >
        <source src={`/templates/${id}.mp4`} type="video/mp4" />
        <source src={`/templates/${id}.webm`} type="video/webm" />
      </video>
      ) : null}
      {thumb ? (
        /* eslint-disable-next-line @next/next/no-img-element -- object URL, nothing to optimize */
        <img src={thumb} alt="" data-thumb={id} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      ) : null}
    </span>
  );
}

export function TemplatesMenu({
  onClose,
  onMagicReel,
  highlight,
}: {
  onClose: () => void;
  onMagicReel: () => void;
  /** Deep-linked card (`?template=<id>`): visible and highlighted, but not applied until clicked. */
  highlight?: string | null;
}) {
  const applyTemplate = useEditor((s) => s.applyTemplate);
  const mine = useUserTemplates();
  const [name, setName] = useState('');
  /*
    PREVIEW WITH YOUR OWN SCREEN: while the menu is open and the active scene has media, render
    cards sequentially with the user's screen. Cancel synchronously on unmount or template
    selection.
  */
  const media = useEditor((s) => s.active().media);
  const mediaKind = useEditor((s) => s.active().mediaKind);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!media) return;
    const items = [
      ...mine.map((t) => ({ id: t.id, apply: t.apply })),
      ...TEMPLATES.map((t) => ({ id: t.id, apply: t.apply })),
    ];
    void renderTemplateThumbs(items, (id, url) => setThumbs((m) => ({ ...m, [id]: url })));
    return () => cancelTemplateThumbs();
  }, [media, mediaKind, mine]);
  const thumbFor = (id: string) => {
    if (!media) return null;
    return thumbs[id] ?? cachedThumb(useEditor.getState().active(), id);
  };
  const apply = (patch: (typeof TEMPLATES)[number]['apply']) => {
    cancelTemplateThumbs();
    applyTemplate(patch);
    onClose();
  };

  return (
    <div
      className="mp-scroll absolute left-0 top-full z-[700] mt-2 w-[440px] overflow-y-auto p-2"
      style={{
        maxHeight: '72vh',
        background: 'var(--mp-dropdown)',
        border: '1px solid var(--mp-border)',
        borderRadius: 'var(--mp-radius-lg)',
        boxShadow: 'var(--mp-shadow-dropdown)',
      }}
    >
      {/*
        MAGIC REEL: one wide card above templates. It is not in TEMPLATES, so template-card
        selection by label excludes it. Build a complete reel project from the user's screenshots.
      */}
      <button
        onClick={() => {
          onClose();
          onMagicReel();
        }}
        data-magic-reel
        className="mp-tpl mb-2 w-full p-2 text-left transition-colors"
        style={{ background: 'var(--mp-surface)', borderRadius: 'var(--mp-radius)' }}
      >
        <span className="mp-label block" style={{ color: 'var(--mp-text-primary)', fontWeight: 700 }}>
          ✨ Magic Reel
        </span>
        <span className="mp-label mt-0.5 block" style={{ color: 'var(--mp-text-tertiary)' }}>
          Drop your screenshots — get a 20s promo with camera moves & captions
        </span>
      </button>
      <button
        onClick={() => {
          onClose();
          openGoalPack();
        }}
        data-goal-pack
        className="mp-tpl mb-2 w-full p-2 text-left transition-colors"
        style={{ background: 'var(--mp-surface)', borderRadius: 'var(--mp-radius)' }}
      >
        <span className="mp-label block" style={{ color: 'var(--mp-text-primary)', fontWeight: 700 }}>
          ◎ Start from a goal
        </span>
        <span className="mp-label mt-0.5 block" style={{ color: 'var(--mp-text-tertiary)' }}>
          Feature launch video · App Store set · Portfolio showcase — with the right exports
        </span>
      </button>
      {/*
        MY TEMPLATES: save a named setup and apply it later with one click. Store the setup in
        browser localStorage; media is not saved.
      */}
      <div className="mb-2">
        <div className="mp-label px-1 pb-1.5 pt-1" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
          My templates
        </div>
        <form
          className="mb-1.5 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            saveUserTemplate(name, useEditor.getState().active());
            setName('');
            toast('Saved to My templates');
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this setup…"
            maxLength={40}
            aria-label="Template name"
            className="mp-label min-w-0 flex-1 px-2 outline-none"
            style={{
              height: 'var(--mp-row-h)',
              borderRadius: 'var(--mp-radius)',
              background: 'var(--mp-surface)',
              color: 'var(--mp-text-primary)',
              textTransform: 'none',
            }}
          />
          <button type="submit" className="mp-topbtn" style={{ background: 'var(--mp-surface-active)' }}>
            Save current
          </button>
        </form>
        {mine.length ? (
          <div className="grid grid-cols-3 gap-1.5">
            {mine.map((t) => (
              <div key={t.id} className="relative">
                <button
                  onClick={() => apply(t.apply)}
                  className="mp-tpl w-full p-1.5 text-left transition-colors"
                  style={{ background: 'var(--mp-surface)', borderRadius: 'var(--mp-radius)' }}
                >
                  {/*
                    Use the same preview style as built-in templates: background, device
                    silhouette and angle. A background-only dark setup looked like a black
                    rectangle with no device/angle information; its card was also shorter than
                    built-in cards (h-14 / h-20).
                  */}
                  <Preview
                    id={t.id}
                    video={false}
                    thumb={thumbFor(t.id)}
                    backgroundId={t.backgroundId}
                    deviceId={t.apply.deviceId ?? 'phone'}
                    tiltY={t.apply.camera?.tiltY ?? 0}
                    roll={t.apply.camera?.roll ?? 0}
                  />
                  <span className="mp-label mt-1.5 block truncate" style={{ color: 'var(--mp-text-primary)' }}>
                    {t.name}
                  </span>
                </button>
                <button
                  aria-label={`Delete ${t.name}`}
                  title="Delete"
                  onClick={() => {
                    deleteUserTemplate(t.id);
                    // Deletion takes one click; at least identify what was removed.
                    toast(`Deleted “${t.name}”`);
                  }}
                  className="mp-label absolute right-2 top-2 grid h-5 w-5 place-items-center"
                  style={{ background: 'rgba(0,0,0,0.45)', color: '#fff', borderRadius: 999 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {media ? (
        <div className="mp-label px-1 pb-1" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
          Previewed with your screen
        </div>
      ) : null}
      {TEMPLATE_GROUPS.map((group) => {
        const list = TEMPLATES.filter((t) => t.group === group);
        if (!list.length) return null;
        return (
          <div key={group} className="mb-2">
            <div
              className="mp-label px-1 pb-1.5 pt-1"
              style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}
            >
              {group}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {list.map((t) => (
                <button
                  key={t.id}
                  onClick={() => apply(t.apply)}
                  className="mp-tpl p-1.5 text-left transition-colors"
                  data-template={t.id}
                  ref={(el) => {
                    if (el && highlight === t.id) el.scrollIntoView({ block: 'nearest' });
                  }}
                  style={{
                    background: 'var(--mp-surface)',
                    borderRadius: 'var(--mp-radius)',
                    outline: highlight === t.id ? '2px solid var(--mp-accent)' : undefined,
                  }}
                >
                  <Preview
                    id={t.id}
                    thumb={thumbFor(t.id)}
                    backgroundId={t.backgroundId}
                    deviceId={t.apply.deviceId ?? 'phone'}
                    tiltY={t.apply.camera?.tiltY ?? 0}
                    roll={t.apply.camera?.roll ?? 0}
                  />
                  <span className="mp-label mt-1.5 block truncate">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
