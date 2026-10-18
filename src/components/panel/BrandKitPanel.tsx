'use client';

import { useState } from 'react';
import { Chevron, FileButton } from '@/components/panel/Controls';
import { ColorInput } from '@/components/panel/ColorInput';
import { FontPicker } from '@/components/panel/TextPanel';
import { downscaleLogo, hasBrandKit, saveBrandKit, useBrandKit, type BrandKit } from '@/config/brandKit';
import { useEditor } from '@/store/editor';
import { toast } from '@/components/shell/Toast';

/**
 * Brand kit panel at the start of Text, initially collapsed.
 * The kit belongs to the browser (config/brandKit.ts) and is available in
 * every project, supplying defaults for new text and "+ Brand logo".
 */
export function BrandKitPanel() {
  const kit = useBrandKit();
  const [open, setOpen] = useState(false);
  const write = (patch: Partial<BrandKit>) => {
    if (!saveBrandKit(patch)) toast('Browser storage is full — brand kit not saved');
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="brand-kit">
      <button
        onClick={() => setOpen((v) => !v)}
        className="mp-label flex items-center justify-between px-1 py-1"
        aria-expanded={open}
        data-testid="brand-kit-toggle"
      >
        <span style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>BRAND KIT</span>
        <span className="flex items-center gap-1.5">
          {kit.colors.map((c) => (
            <span key={c} className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />
          ))}
          <Chevron open={open} />
        </span>
      </button>
      {open ? (
        <>
          <div className="flex items-center gap-1.5">
            {kit.logo ? (
              /* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimize */
              <img
                src={kit.logo}
                alt="Brand logo"
                className="h-8 w-8 object-contain"
                style={{ background: 'var(--mp-surface)', borderRadius: 6 }}
              />
            ) : null}
            <FileButton
              accept="image/*"
              ariaLabel="Set brand logo"
              className="mp-label flex-1 cursor-pointer py-1.5 text-center"
              style={{ background: 'var(--mp-surface-active)', borderRadius: 'var(--mp-radius)' }}
              onPick={(f) => {
                void downscaleLogo(f)
                  .then((logo) => write({ logo }))
                  .catch(() => toast('Could not read that image'));
              }}
            >
              {kit.logo ? 'Change logo' : 'Set logo'}
            </FileButton>
            {kit.logo ? (
              <button
                onClick={() => write({ logo: null })}
                className="mp-label px-1"
                style={{ color: 'var(--mp-text-tertiary)' }}
                aria-label="Remove brand logo"
                title="Remove"
              >
                ✕
              </button>
            ) : null}
          </div>
          {kit.colors.map((c, i) => (
            <div key={i} className="flex items-center justify-between gap-1 px-1">
              <span className="mp-label">{i === 0 ? 'Text color' : `Color ${i + 1}`}</span>
              <span className="flex items-center gap-1">
                <ColorInput
                  label={`Brand color ${i + 1}`}
                  value={c}
                  onChange={(hex) => write({ colors: kit.colors.map((x, j) => (j === i ? hex : x)) })}
                />
                <button
                  onClick={() => write({ colors: kit.colors.filter((_, j) => j !== i) })}
                  className="mp-label px-1"
                  style={{ color: 'var(--mp-text-tertiary)' }}
                  aria-label={`Remove brand color ${i + 1}`}
                >
                  ✕
                </button>
              </span>
            </div>
          ))}
          {kit.colors.length < 3 ? (
            <button
              onClick={() => write({ colors: [...kit.colors, kit.colors.length ? '#14161a' : '#5b6cff'] })}
              className="mp-label py-1.5"
              style={{ background: 'var(--mp-surface)', borderRadius: 'var(--mp-radius)' }}
            >
              + Brand color
            </button>
          ) : null}
          <FontPicker label="Heading font" value={kit.headingFont ?? 'Anton'} onChange={(headingFont) => write({ headingFont })} />
          <FontPicker label="Body font" value={kit.bodyFont ?? 'Space Grotesk'} onChange={(bodyFont) => write({ bodyFont })} />
          <button
            disabled={!hasBrandKit(kit)}
            onClick={() => {
              const n = useEditor.getState().applyBrandKit(kit);
              toast(n ? `Brand applied to ${n} item${n === 1 ? '' : 's'} in this scene` : 'Nothing to apply in this scene');
            }}
            data-testid="apply-brand"
            className="mp-label py-1.5"
            style={{
              background: 'var(--mp-accent)',
              color: '#fff',
              borderRadius: 'var(--mp-radius)',
              opacity: hasBrandKit(kit) ? 1 : 0.5,
            }}
          >
            Apply brand to this scene
          </button>
          <span className="mp-label px-1" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9, lineHeight: 1.4 }}>
            Saved in this browser. New texts use these fonts and the first color.
          </span>
        </>
      ) : null}
    </div>
  );
}
