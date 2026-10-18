'use client';

import { useEffect, useRef, useState } from 'react';
import { revokeBlob, usePhoto } from '@photo/store/photo';
import { BG_COLORS, BG_MODES, EMOJI_MAX, PRESETS, SECTION_LABEL, SHADOWS, ZOOMS, pickEmojis } from '@photo/config/ui';
import { PATTERNS } from '@photo/config/patterns';
import { EmojiPicker } from './EmojiPicker';
import { Select } from './Select';
import { Card, Row, SectionLabel, Seg } from './ui';
import { Icons } from './icons';

export function RightPanel() {
  const s = usePhoto();
  const logoRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);
  const bgVidRef = useRef<HTMLInputElement>(null);
  const [picker, setPicker] = useState(false);

  /**
   * Refresh the emoji strip with a random selection after each reload. Randomize in an effect rather
   * than the initial render: different server/client emoji selections cause React hydration errors.
   */
  useEffect(() => {
    if (!s.emojis.length) s.set({ emojis: pickEmojis(7, Date.now() % 100000) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Background/shadow/zoom/emoji controls are irrelevant in photo mode, since the photograph has its
   * own lighting and perspective. Hide every card except PRESET when a hand or scene is selected.
   */
  const photoMode = s.source?.kind === 'photo';

  return (
    // Photo mode leaves just one card; center it vertically
    // in the column instead of leaving it at the top.
    <div className={`space-y-4 ${photoMode ? 'flex flex-col justify-center min-h-full' : ''}`}>
      <Card>
        <SectionLabel icon={Icons.preset}>Preset</SectionLabel>
        <Row>
          <Select
            value={s.preset}
            options={PRESETS.map((p) => p.id)}
            onChange={(v) => {
              const p = PRESETS.find((x) => x.id === v);
              // A preset configures the complete look: background, emoji, pattern,
              // shadow and zoom together.
              s.set(
                p
                  ? {
                      preset: p.id,
                      bgColor: p.bgColor,
                      shadow: p.shadow,
                      zoom: p.zoom,
                      bgEmojis: [...p.emojis],
                      pattern: p.pattern,
                    }
                  : { preset: v },
              );
            }}
          />
        </Row>
      </Card>

      {!photoMode && (
        <>
          <Card>
            <SectionLabel icon={Icons.app}>App</SectionLabel>
            <Row>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => logoRef.current?.click()}
                  className="h-8 flex-1 rounded-md text-sm font-medium cursor-pointer"
                  style={{ background: 'var(--muted)' }}
                >
                  {s.appLogo ? 'Logo ✓' : 'App Logo'}
                </button>
                <input
                  value={s.appName}
                  onChange={(e) => s.set({ appName: e.target.value })}
                  placeholder="App Name"
                  className="h-8 flex-1 rounded-md px-2 text-sm outline-none"
                  style={{ border: '1px solid rgba(var(--ink),.12)' }}
                />
              </div>
            </Row>
            <input
              ref={logoRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                revokeBlob(s.appLogo);
                s.set({ appLogo: URL.createObjectURL(f) });
              }}
            />
          </Card>

          <Card>
            <SectionLabel icon={Icons.background}>BACKGROUND</SectionLabel>
            <Row>
              <div className="flex flex-wrap items-center gap-2">
                {BG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => s.set({ bgColor: c, bgMode: 'Image' })}
                    aria-label={`Select ${c} color`}
                    className="h-8 w-8 rounded-full cursor-pointer"
                    style={{
                      background: c,
                      outline: `1px solid ${s.bgColor === c ? 'var(--foreground)' : 'rgba(var(--ink),.15)'}`,
                      outlineOffset: 2,
                    }}
                  />
                ))}
                {/*
                  Rainbow = custom color picker. Keep the native input type="color" instead of a label with a
                  hidden input: programmatic click requires a gesture in some browsers. The input remains full-size
                  and in the tab order despite opacity-0. Put its accessible name on the input itself; aria-label
                  on the label did not reach screen readers.
                */}
                <label
                  className="h-8 w-8 rounded-full cursor-pointer block"
                  style={{
                    background:
                      'conic-gradient(#f00,#ff7f00,#ff0,#0f0,#0ff,#00f,#8b00ff,#f00)',
                    outline: '1px solid rgba(var(--ink),.15)',
                    outlineOffset: 2,
                  }}
                >
                  <input
                    type="color"
                    aria-label="Custom background color"
                    className="opacity-0 w-full h-full cursor-pointer"
                    value={s.bgColor}
                    onChange={(e) => s.set({ bgColor: e.target.value, bgMode: 'Image' })}
                  />
                </label>
              </div>
            </Row>
            <Row>
              <div className="flex gap-2">
                {BG_MODES.map((m) => (
                  <Seg
                    key={m}
                    active={s.bgMode === m}
                    onClick={() =>
                      m === 'Image'
                        ? bgRef.current?.click()
                        : m === 'Video'
                          ? bgVidRef.current?.click()
                          : s.set({ bgMode: 'None' })
                    }
                  >
                    {m}
                  </Seg>
                ))}
              </div>
            </Row>
            <input
              ref={bgRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                // The two modes clear each other; release the resource being reset too.
                revokeBlob(s.bgImage);
                revokeBlob(s.bgVideo);
                s.set({ bgImage: URL.createObjectURL(f), bgVideo: null, bgMode: 'Image' });
              }}
            />
            <input
              ref={bgVidRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                revokeBlob(s.bgVideo);
                revokeBlob(s.bgImage);
                s.set({ bgVideo: URL.createObjectURL(f), bgImage: null, bgMode: 'Video' });
              }}
            />

            {/*
                Measured behavior: with no emoji selected, omit the heading counter and hide PATTERN/ANIMATE
                entirely.
                */}
            <SectionLabel icon={Icons.emojis}>
              {s.bgEmojis.length ? `Emojis (${s.bgEmojis.length}/${EMOJI_MAX})` : 'Emojis'}
            </SectionLabel>
            <Row>
              <div className="flex items-center gap-2">
                {s.emojis.map((e, i) => {
                  const on = s.bgEmojis.includes(e);
                  const full = s.bgEmojis.length >= EMOJI_MAX && !on;
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={full}
                      // Allow at most five selected emoji; show selected items
                      // with a ring.
                      onClick={() =>
                        s.set({
                          bgEmojis: on ? s.bgEmojis.filter((x) => x !== e) : [...s.bgEmojis, e],
                        })
                      }
                      aria-label="Select emoji"
                      className="h-8 w-8 rounded-full text-base leading-none transition-all disabled:opacity-40 cursor-pointer"
                      style={{
                        background: 'var(--muted)',
                        outline: on ? '2px solid var(--foreground)' : '1px solid transparent',
                        outlineOffset: 1,
                      }}
                    >
                      {e}
                    </button>
                  );
                })}
                <div className="relative">
                  <button
                    type="button"
                    aria-label="Add custom emoji"
                    aria-expanded={picker}
                    /*
                      Toggle on mousedown: the outside-click listener also uses mousedown and treated this button as
                      outside. It closed the panel before click reopened it, so the button could never close it. Stop
                      propagation here to keep the listener from receiving the event.
                    */
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setPicker((v) => !v);
                    }}
                    // Keyboard clicks (detail === 0) do not produce mousedown.
                    onClick={(e) => {
                      if (e.detail === 0) setPicker((v) => !v);
                    }}
                    className="h-8 w-8 grid place-items-center rounded-full cursor-pointer"
                    style={{ background: picker ? 'var(--muted)' : 'transparent' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                      <path d="M8 3.4v9.2M3.4 8h9.2" />
                    </svg>
                  </button>
                  <EmojiPicker
                    // Start fresh on every opening (empty search); reset the component
                    // instead of calling setState in an effect.
                    key={picker ? 'open' : 'closed'}
                    open={picker}
                    onClose={() => setPicker(false)}
                    onPick={(e) => {
                      // Measured behavior: append the chosen emoji to the row,
                      // mark it selected, and keep the panel open.
                      const row = s.emojis.includes(e) ? s.emojis : [...s.emojis.slice(1), e];
                      const sel = s.bgEmojis.includes(e)
                        ? s.bgEmojis
                        : [...s.bgEmojis, e].slice(-EMOJI_MAX);
                      s.set({ emojis: row, bgEmojis: sel });
                    }}
                  />
                </div>
              </div>
            </Row>

            {s.bgEmojis.length > 0 && (
            <>
            <Row>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {Icons.pattern}
                  <p className={SECTION_LABEL}>Pattern</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className={SECTION_LABEL}>Animate</p>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={s.animate}
                    onClick={() => s.set({ animate: !s.animate })}
                    className="relative h-5 w-9 rounded-full transition-colors cursor-pointer"
                    style={{ background: s.animate ? 'var(--foreground)' : 'rgba(var(--ink),.2)' }}
                  >
                    <span
                      className="absolute top-[2px] h-4 w-4 rounded-full bg-white transition-all"
                      style={{ left: s.animate ? 18 : 2 }}
                    />
                  </button>
                </div>
              </div>
            </Row>
            <Row>
              <div className="grid grid-cols-2 gap-2">
                {PATTERNS.map((p) => (
                  <Seg key={p} active={s.pattern === p} onClick={() => s.set({ pattern: p })}>
                    {p}
                  </Seg>
                ))}
              </div>
            </Row>
            </>
            )}
          </Card>

          <Card>
            <SectionLabel icon={Icons.shadow}>SHADOW</SectionLabel>
            <Row>
              <div className="flex gap-2">
                {SHADOWS.map((sh) => (
                  <Seg key={sh} active={s.shadow === sh} onClick={() => s.set({ shadow: sh })}>
                    {sh}
                  </Seg>
                ))}
              </div>
            </Row>
          </Card>

          <Card>
            <SectionLabel icon={Icons.zoom}>ZOOM</SectionLabel>
            <Row>
              <div className="grid grid-cols-4 gap-2">
                {ZOOMS.map((z) => (
                  <Seg key={z} active={s.zoom === z} onClick={() => s.set({ zoom: z })}>
                    {z}x
                  </Seg>
                ))}
              </div>
            </Row>
          </Card>
        </>
      )}
    </div>
  );
}
