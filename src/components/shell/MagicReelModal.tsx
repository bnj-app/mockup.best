'use client';

import { useEffect, useRef, useState } from 'react';
import { loadMagicReel } from '@/store/project';
import { toast } from '@/components/shell/Toast';
import { track } from '@/lib/analytics';

/**
 * MAGIC REEL wizard: drop 1-4 screenshots to create a 20-second showcase reel
 * with camera choreography and timed text (see config/reel.ts).

 * Uses UpgradeModal's contract: portal into body to avoid the backdrop-filter
 * containing-block pitfall, role="dialog" for Escape layer checks, Escape to
 * close, and consumed clicks inside the content.

 * Intentional v1 limits: images only, no screen recordings, and 16:9 framing.
 * Portrait adaptation needs the complete PZ/PT mechanism; partial integration
 * would make text overlap the device.
 */

type Picked = { url: string; name: string };
const MAX_IMAGES = 4;

export function MagicReelModal({ onClose }: { onClose: () => void }) {
  const [images, setImages] = useState<Picked[]>([]);
  const [captions, setCaptions] = useState<string[]>(['', '', '']);
  const [brand, setBrand] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next = [...images];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      if (next.length >= MAX_IMAGES) break;
      next.push({ url: URL.createObjectURL(f), name: f.name });
    }
    setImages(next);
  };

  const removeAt = (i: number) => {
    /*
       Do not revoke the object URL: that would invalidate the URL passed to the
       builder. It is released with the page; the retained memory is minor.
       */
    setImages(images.filter((_, j) => j !== i));
  };

  const build = () => {
    if (!images.length) return;
    const okBuilt = loadMagicReel({ images, captions, brand });
    if (!okBuilt) {
      toast('Could not build the reel');
      return;
    }
    track('magic_reel_build', { images: images.length });
    toast(
      images.length > 1
        ? 'Magic Reel ready — playing. Tweak any scene, then export.'
        : 'Reel ready — add more screenshots next time for feature scenes.',
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[950] grid place-items-center"
      style={{ background: 'rgba(10,10,14,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Magic Reel"
        className="w-[420px] overflow-hidden"
        style={{
          background: 'var(--mp-dropdown)',
          border: '1px solid var(--mp-border)',
          borderRadius: 'var(--mp-radius-lg)',
          boxShadow: 'var(--mp-shadow-dropdown)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-3 p-4">
          <div>
            <span className="mp-label block" style={{ color: 'var(--mp-text-primary)', fontSize: 13, fontWeight: 700 }}>
              ✨ Magic Reel
            </span>
            <span className="mp-label mt-1 block" style={{ color: 'var(--mp-text-tertiary)' }}>
              Drop up to {MAX_IMAGES} screenshots — get a ready-to-export promo reel with camera
              choreography and captions. First screenshot opens and closes the reel.
            </span>
          </div>

          {/* Image selection: hidden multiple-file input and card grid. */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            data-magic-input
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="grid grid-cols-4 gap-1.5">
            {images.map((img, i) => (
              <div
                key={img.url}
                className="relative overflow-hidden"
                style={{ borderRadius: 'var(--mp-radius)', border: '1px solid var(--mp-border)', aspectRatio: '9/16' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.name} className="h-full w-full object-cover" />
                {i === 0 ? (
                  <span
                    className="mp-label absolute left-1 top-1 px-1"
                    style={{ background: 'var(--mp-accent)', color: '#fff', borderRadius: 4, fontSize: 8 }}
                  >
                    MAIN
                  </span>
                ) : null}
                <button
                  aria-label={`Remove ${img.name}`}
                  className="absolute right-1 top-1 grid h-4 w-4 place-items-center"
                  style={{ background: 'rgba(10,10,14,0.7)', color: '#fff', borderRadius: 4, fontSize: 9 }}
                  onClick={() => removeAt(i)}
                >
                  ✕
                </button>
              </div>
            ))}
            {images.length < MAX_IMAGES ? (
              <button
                onClick={() => fileRef.current?.click()}
                className="mp-label grid place-items-center"
                style={{
                  aspectRatio: '9/16',
                  borderRadius: 'var(--mp-radius)',
                  border: '1px dashed var(--mp-border)',
                  color: 'var(--mp-text-tertiary)',
                }}
              >
                + Add
              </button>
            ) : null}
          </div>

          {/* Feature titles: one scene per image, starting with the second. */}
          {images.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              {images.slice(1).map((img, j) => (
                <input
                  key={img.url}
                  value={captions[j] ?? ''}
                  onChange={(e) => {
                    const next = [...captions];
                    next[j] = e.target.value;
                    setCaptions(next);
                  }}
                  placeholder={`Caption for scene ${j + 2} (optional, ≤ 4 words)`}
                  className="mp-label w-full px-2.5"
                  style={{
                    height: 'var(--mp-row-h)',
                    borderRadius: 'var(--mp-radius)',
                    background: 'var(--mp-surface)',
                    border: '1px solid var(--mp-border)',
                    color: 'var(--mp-text-primary)',
                  }}
                />
              ))}
            </div>
          ) : null}

          <input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Your app name — closing line (optional)"
            className="mp-label w-full px-2.5"
            style={{
              height: 'var(--mp-row-h)',
              borderRadius: 'var(--mp-radius)',
              background: 'var(--mp-surface)',
              border: '1px solid var(--mp-border)',
              color: 'var(--mp-text-primary)',
            }}
          />

          <button
            disabled={!images.length}
            className="mp-label w-full py-2.5"
            style={{
              borderRadius: 'var(--mp-radius)',
              background: images.length ? 'var(--mp-accent)' : 'var(--mp-surface)',
              color: images.length ? '#fff' : 'var(--mp-text-tertiary)',
              fontWeight: 600,
            }}
            onClick={build}
          >
            {images.length
              ? `Build my reel — ${images.length > 1 ? 3 + (images.length - 1) * 4 + 5 : 8}s`
              : 'Add at least one screenshot'}
          </button>
          <button className="mp-label w-full py-1" style={{ color: 'var(--mp-text-tertiary)' }} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
