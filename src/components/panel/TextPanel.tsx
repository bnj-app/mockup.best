'use client';

import { useEffect, useRef, useState } from 'react';
import { Slider } from '@/components/panel/Slider';
import { FileButton, Segmented, Select, revealInScroller } from '@/components/panel/Controls';
import { useEditor, type TextAnim } from '@/store/editor';
import { FONTS, FONT_CATEGORIES, ensureFont, type FontCategory } from '@/config/fonts';
import { useBrandKit } from '@/config/brandKit';

/**
 * Font picker.
 *
 * Category tabs make a 50-font list manageable. Render each row in its own
 * font so users can choose by appearance rather than name.
 */
export function FontPicker({ value, onChange, label = 'Font' }: { value: string; onChange: (f: string) => void; label?: string }) {
  const [cat, setCat] = useState<FontCategory>(
    FONTS.find((f) => f.family === value)?.category ?? 'display',
  );
  /*
    Start collapsed: a permanently open 170px font list pushed essential
    position and size controls too far down the Text panel. Click to expand.
  */
  const [open, setOpen] = useState(false);
  const list = FONTS.filter((f) => f.category === cat);

  // Load listed fonts for preview before users select them.
  useEffect(() => {
    if (open) list.slice(0, 14).forEach((f) => void ensureFont(f.family));
  }, [list, open]);

  useEffect(() => {
    void ensureFont(value);
  }, [value]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between px-2.5"
        style={{
          height: 'var(--mp-row-h)',
          borderRadius: 'var(--mp-radius)',
          background: 'var(--mp-surface)',
        }}
      >
        <span className="mp-label">{label}</span>
        <span
          className="truncate pl-2"
          style={{ fontFamily: `"${value}", sans-serif`, fontSize: 13, color: 'var(--mp-text-primary)' }}
        >
          {value} ▾
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1">
        {FONT_CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            className="mp-label flex-1 py-1"
            style={{
              borderRadius: 6,
              background: cat === c.id ? 'var(--mp-surface-active)' : 'transparent',
              color: cat === c.id ? 'var(--mp-text-primary)' : 'var(--mp-text-tertiary)',
              fontSize: 9,
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div
        className="mp-scroll flex flex-col gap-0.5 overflow-y-auto pr-1"
        style={{ maxHeight: 168 }}
      >
        {list.map((f) => (
          <button
            key={f.family}
            onClick={() => {
              void ensureFont(f.family);
              onChange(f.family);
              setOpen(false);
            }}
            className="truncate px-2 py-1.5 text-left"
            style={{
              borderRadius: 6,
              background: value === f.family ? 'var(--mp-surface-active)' : 'transparent',
              fontFamily: `"${f.family}", sans-serif`,
              fontSize: 15,
              lineHeight: 1.25,
              color: value === f.family ? 'var(--mp-text-primary)' : 'var(--mp-text-secondary)',
            }}
          >
            {f.family}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TextPanel() {
  const shot = useEditor((s) => s.active());
  const activeTextId = useEditor((s) => s.activeTextId);
  const selectText = useEditor((s) => s.selectText);
  const addText = useEditor((s) => s.addText);
  const patchText = useEditor((s) => s.patchText);
  const removeText = useEditor((s) => s.removeText);
  const shotDuration = shot.duration;

  const [moreOpen, setMoreOpen] = useState(false);
  /*
    New text is ready to type. Previously users had to find the new field,
    click it, and delete "Your text". Focus and select the placeholder on
    insertion so typing replaces it. Reveal the field within its scroller
    when added below the panel viewport; see the revealInScroller pitfall
    rather than using scrollIntoView.
  */
  const textBoxRef = useRef<HTMLTextAreaElement>(null);
  const addAndFocus = (kind: 'text' | 'ticker') => {
    addText(kind);
    requestAnimationFrame(() => {
      const el = textBoxRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.select();
      revealInScroller(el);
    });
  };
  const languages = useEditor((s) => s.languages);
  const brandLogo = useBrandKit().logo;
  const items = shot.texts;
  const active = items.find((t) => t.id === activeTextId) ?? items[items.length - 1] ?? null;
  // Flags selecting control groups; rationale is documented below.
  const isText = active?.kind === 'text';
  const isTicker = active?.kind === 'ticker';
  const isLogo = active?.kind === 'logo';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <button
          onClick={() => addAndFocus('text')}
          className="mp-label flex-1 py-2"
          style={{ background: 'var(--mp-surface-active)', borderRadius: 'var(--mp-radius)' }}
        >
          + Text
        </button>
        <button
          onClick={() => addAndFocus('ticker')}
          className="mp-label flex-1 py-2"
          style={{ background: 'var(--mp-surface-active)', borderRadius: 'var(--mp-radius)' }}
        >
          + Ticker
        </button>
        {/*
          Logos share text's position, size, rotation, opacity, and timing;
          only rendering differs. Create the item after file selection,
          avoiding an empty, invisible logo in the frame.
        */}
        <FileButton
          accept="image/*"
          className="mp-label flex-1 cursor-pointer py-2 text-center"
          style={{ background: 'var(--mp-surface-active)', borderRadius: 'var(--mp-radius)' }}
          onPick={(f) => {
            addText('logo');
            const url = URL.createObjectURL(f);
            const s = useEditor.getState();
            const list = s.active().texts;
            const last = list[list.length - 1];
            if (last) s.patchText(last.id, { src: url, text: f.name });
          }}
        >
          + Logo
        </FileButton>
        {/* Insert the brand kit logo in one click when available. */}
        {brandLogo ? (
          <button
            onClick={() => {
              addText('logo');
              const s = useEditor.getState();
              const list = s.active().texts;
              const last = list[list.length - 1];
              if (last) s.patchText(last.id, { src: brandLogo, text: 'Brand logo' });
            }}
            className="mp-label flex-1 py-2"
            style={{ background: 'var(--mp-surface-active)', borderRadius: 'var(--mp-radius)' }}
          >
            + Brand logo
          </button>
        ) : null}
      </div>

      {items.length ? (
        <div className="flex flex-col gap-0.5">
          {items.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-1 px-2"
              style={{
                height: 'var(--mp-row-h)',
                borderRadius: 'var(--mp-radius)',
                background:
                  t.id === active?.id ? 'var(--mp-surface-active)' : 'var(--mp-surface)',
              }}
            >
              <button
                onClick={() => patchText(t.id, { visible: !t.visible })}
                className="mp-label"
                style={{ color: t.visible ? 'var(--mp-text-primary)' : 'var(--mp-text-tertiary)' }}
                title={t.visible ? 'Hide' : 'Show'}
              >
                {t.visible ? '◉' : '○'}
              </button>
              <button
                onClick={() => selectText(t.id)}
                className="mp-label flex-1 truncate text-left"
              >
                {t.kind === 'ticker' ? '⟵ ' : ''}
                {t.text.split('\n')[0] || 'Empty'}
              </button>
              <button
                onClick={() => removeText(t.id)}
                className="mp-label"
                style={{ color: 'var(--mp-text-tertiary)' }}
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {active ? (
        <div className="mt-1 flex flex-col gap-1.5">
          {/*
            Which controls apply to each item type?
            A two-way kind === 'text' split sent logos into the ticker branch,
            exposing inactive speed/band/font/color/weight controls while
            hiding the rotation control that actually affected rendering.
            These three flags follow scene/overlay.ts:
            - logo (110–123): src, size, opacity, x, y, rotation.
            - ticker (168–211): text, font, weight, color, opacity, size, y,
              tracking, strokeWidth, lineHeight (band height), speed,
              bandColor, bandOpacity. It ignores x because the band spans
              the frame; shadows are initialized only in the text branch.
            - text (132–167): all controls.
            Update these flags with new rendering fields to avoid inactive
            controls or settings that users cannot access.
          */}
          <textarea
            ref={textBoxRef}
            // No visible label; this supplies the layer-list row name.
            aria-label="Layer text"
            /*
              Keep this for logos too: it names their layer-list rows even
              though it is not rendered. Without it, users could only
              distinguish two logos by their filenames.
            */
            value={active.text}
            onChange={(e) => patchText(active.id, { text: e.target.value })}
            rows={active.kind === 'text' ? 3 : active.kind === 'ticker' ? 2 : 1}
            className="mp-label w-full resize-none p-2 outline-none"
            style={{
              background: 'var(--mp-surface)',
              borderRadius: 'var(--mp-radius)',
              color: 'var(--mp-text-primary)',
              textTransform: 'none',
              fontSize: 11,
              lineHeight: 1.4,
            }}
          />

          {/*
            Translations: show one field per additional project language.
            Empty fields use base text; the scene follows the preview language.
          */}
          {!isLogo && languages.length ? (
            <div className="flex flex-col gap-1">
              {languages.map((l) => (
                <label key={l} className="flex items-start gap-1.5">
                  <span className="mp-label w-8 pt-1.5 text-right" style={{ color: 'var(--mp-text-tertiary)' }}>
                    {l}
                  </span>
                  <textarea
                    value={active.i18n?.[l] ?? ''}
                    placeholder={active.text}
                    data-lang={l}
                    onChange={(e) => patchText(active.id, { i18n: { ...(active.i18n ?? {}), [l]: e.target.value } })}
                    rows={active.kind === 'text' ? 2 : 1}
                    className="mp-label min-w-0 flex-1 resize-none p-1.5 outline-none"
                    style={{
                      background: 'var(--mp-surface)',
                      borderRadius: 'var(--mp-radius)',
                      color: 'var(--mp-text-primary)',
                      textTransform: 'none',
                      fontSize: 11,
                      lineHeight: 1.4,
                    }}
                  />
                </label>
              ))}
            </div>
          ) : null}

          {/* Font/color/weight apply only to text; logos render as images. */}
          {isLogo ? null : (
            <>
              <FontPicker value={active.font} onChange={(font) => patchText(active.id, { font })} />

              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={active.color}
                  onChange={(e) => patchText(active.id, { color: e.target.value })}
                  className="h-8 w-10 cursor-pointer border-0 bg-transparent p-0"
                  aria-label="Text color"
                  title="Text color"
                />
                <div className="flex-1">
                  <Segmented
                    ariaLabel="Font weight"
                    value={String(active.weight) as '400' | '700' | '900'}
                    onChange={(w) => patchText(active.id, { weight: Number(w) })}
                    options={[
                      { value: '400', label: 'Reg' },
                      { value: '700', label: 'Bold' },
                      { value: '900', label: 'Black' },
                    ]}
                  />
                </div>
              </div>
            </>
          )}

          {isText ? (
            <Segmented
              ariaLabel="Text alignment"
              value={active.align}
              onChange={(align) => patchText(active.id, { align })}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' },
              ]}
            />
          ) : null}

          {/*
            Timing: items appear within their own window rather than throughout
            the scene. Clamp End only for display; preserve its stored value
            so shortening the scene does not lose timing data.
            All three types share this window. Logos ignore anim.rise:
            overlay.ts:122 continues before vertical movement, making
            "Rise" behave like a fade for logos.
          */}
          <span className="mp-label mt-1" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
            TIMING
          </span>
          <div className="flex gap-1.5">
            <div className="min-w-0 flex-1">
              <Slider
                label="Start"
                value={active.start}
                min={0}
                max={Math.max(0.1, shotDuration)}
                step={0.1}
                precision={1}
                onChange={(start) =>
                  patchText(active.id, {
                    start: Math.min(start, (active.end ?? shotDuration) - 0.1),
                  })
                }
              />
            </div>
            <div className="min-w-0 flex-1">
              <Slider
                label="End"
                value={active.end ?? shotDuration}
                min={0}
                max={Math.max(0.1, shotDuration)}
                step={0.1}
                precision={1}
                onChange={(end) => patchText(active.id, { end: Math.max(end, active.start + 0.1) })}
              />
            </div>
          </div>
          {/* Layer: in front of or behind the device, including logos. */}
          <Segmented
            ariaLabel="Text layer"
            value={active.layer ?? 'front'}
            options={[
              { value: 'front', label: 'In front' },
              { value: 'behind', label: 'Behind device' },
            ]}
            onChange={(layer) => patchText(active.id, { layer })}
          />
          <div className="flex gap-1.5">
            <div className="min-w-0 flex-1">
              <Select
                label="In"
                value={active.enter}
                options={TEXT_ANIMS}
                onChange={(enter: TextAnim) => patchText(active.id, { enter })}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Select
                label="Out"
                value={active.exit}
                options={TEXT_ANIMS}
                onChange={(exit: TextAnim) => patchText(active.id, { exit })}
              />
            </div>
          </div>

          <Slider
            label="Size"
            value={active.size}
            min={0.01}
            max={0.3}
            step={0.001}
            precision={3}
            onChange={(size) => patchText(active.id, { size })}
          />
          {/*
            Place X/Y side by side to save a row. Hide X for tickers:
            the band spans the frame and rendering reads only item.y
            (overlay.ts:181). Horizontal position comes from scrolling
            animation, so an X slider would have no effect.
          */}
          <div className="flex gap-1.5">
            {isTicker ? null : (
              <div className="min-w-0 flex-1">
                <Slider
                  label="X"
                  value={active.x}
                  min={0}
                  max={1}
                  onChange={(x) => patchText(active.id, { x })}
                />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <Slider
                label="Y"
                value={active.y}
                min={0}
                max={1}
                onChange={(y) => patchText(active.id, { y })}
              />
            </div>
          </div>
          {/*
            Collapse fine adjustments: 10+ stacked sliders overwhelmed Text.
            Text/font/size/position are common; shadow/stroke/rotation are occasional.
          */}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className="mp-label flex w-full items-center justify-between px-2.5"
            style={{
              height: 'var(--mp-row-h)',
              borderRadius: 'var(--mp-radius)',
              background: 'var(--mp-surface)',
            }}
          >
            <span>Fine tuning</span>
            <span style={{ color: 'var(--mp-text-tertiary)' }}>{moreOpen ? '▴' : '▾'}</span>
          </button>

          {moreOpen ? (
            <>
              {/* Letter spacing is read only for text (overlay.ts:130). */}
              {isLogo ? null : (
                <Slider
                  label="Tracking"
                  value={active.tracking}
                  min={-0.1}
                  max={0.4}
                  onChange={(tracking) => patchText(active.id, { tracking })}
                />
              )}
              {/* Opacity affects all three rendering types. */}
              <Slider
                label="Opacity"
                value={active.opacity}
                min={0}
                max={1}
                onChange={(opacity) => patchText(active.id, { opacity })}
              />
              {/*
                Shadows apply only to text: ctx.shadow* is initialized only
                in that branch (overlay.ts:147–154), so ticker and logo
                shadow sliders would have no effect.
              */}
              {isText ? (
                <Slider
                  label="Shadow"
                  value={active.shadow}
                  min={0}
                  max={1}
                  onChange={(shadow) => patchText(active.id, { shadow })}
                />
              ) : null}
              {/* Stroke is drawn in both text and ticker branches (:156, :200). */}
              {isLogo ? null : (
                <Slider
                  label="Outline"
                  value={active.strokeWidth}
                  min={0}
                  max={0.12}
                  step={0.001}
                  precision={3}
                  onChange={(strokeWidth) => patchText(active.id, { strokeWidth })}
                />
              )}

              {/*
                Rotation applies to text and logos (:138 and :118).
                Hiding it for logos concealed their working fine adjustment.
              */}
              {isTicker ? null : (
                <Slider
                  label="Rotation"
                  value={active.rotation}
                  min={-45}
                  max={45}
                  step={1}
                  precision={0}
                  onChange={(rotation) => patchText(active.id, { rotation })}
                />
              )}
              {/*
                Line height controls text leading and ticker band height
                (overlay.ts:180), so it affects both types.
              */}
              {isLogo ? null : (
                <Slider
                  label="Line height"
                  value={active.lineHeight}
                  min={0.8}
                  max={2.2}
                  onChange={(lineHeight) => patchText(active.id, { lineHeight })}
                />
              )}

              {/* Ticker-only: scroll speed and band background. */}
              {isTicker ? (
                <>
                  <Slider
                    label="Speed"
                    value={active.speed}
                    min={0}
                    max={0.6}
                    onChange={(speed) => patchText(active.id, { speed })}
                  />
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={active.bandColor}
                      onChange={(e) => patchText(active.id, { bandColor: e.target.value })}
                      className="h-8 w-10 cursor-pointer border-0 bg-transparent p-0"
                      aria-label="Band color"
                      title="Band color"
                    />
                    <div className="flex-1">
                      <Slider
                        label="Band"
                        value={active.bandOpacity}
                        min={0}
                        max={1}
                        onChange={(bandOpacity) => patchText(active.id, { bandOpacity })}
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const TEXT_ANIMS: { value: TextAnim; label: string }[] = [
  { value: 'fade', label: 'Fade' },
  { value: 'rise', label: 'Rise' },
  { value: 'words-left', label: 'Words ←' },
  { value: 'words-right', label: 'Words →' },
  { value: 'knock-left', label: 'Knock ←' },
  { value: 'knock-right', label: 'Knock →' },
  { value: 'cycle', label: 'Word cycle' },
  { value: 'type', label: 'Typewriter' },
  { value: 'count', label: 'Count up' },
  { value: 'none', label: 'None' },
];
