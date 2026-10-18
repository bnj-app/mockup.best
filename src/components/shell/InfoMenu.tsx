'use client';

import { BRAND } from '@/config/brand';
import { GUIDE_URL, LEGAL } from '@/config/legal';

/**
 * Info panel. Keep version information, shortcuts and legal links in one place so users can learn
 * what the product is, who made it and how to use it without leaving.
 */

/*
  Mirror the keyboard handler in app/page.tsx. Undo/redo, K, Delete, copy and split already worked
  but were undocumented here, making them undiscoverable. Add every new shortcut to this list too.
*/
const SHORTCUTS: [string, string][] = [
  ['Play / pause', 'Space'],
  ['Undo', 'Ctrl Z'],
  ['Redo', 'Ctrl Shift Z'],
  ['Timeline', 'T'],
  ['Panel', 'P'],
  ['Record keyframes', 'R'],
  ['Keyframe animated props', 'K'],
  ['Select all keyframes', 'Ctrl Alt A'],
  ['Delete keyframes / scene', 'Del'],
  ['Copy / paste', 'Ctrl C · Ctrl V'],
  ['Split scene', 'Ctrl Shift D'],
  ['Go to start', 'Home'],
  ['Step 0.1s', '← →'],
  ['Step 0.5s', 'Shift ← →'],
  ['Capture image', 'Ctrl S'],
  ['This list', '?'],
  ['Orbit camera', 'Drag'],
  ['Pan', 'Space + Drag  ·  Ctrl + Drag'],
  ['Rotate device', 'Alt + Drag'],
  ['Zoom', 'Scroll'],
];

export function InfoMenu({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="mp-scroll absolute left-0 top-full z-[700] mt-2 w-72 overflow-y-auto p-3"
      style={{
        maxHeight: '72vh',
        background: 'var(--mp-dropdown)',
        border: '1px solid var(--mp-border)',
        borderRadius: 'var(--mp-radius-lg)',
        boxShadow: 'var(--mp-shadow-dropdown)',
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="mp-mono text-[11px] font-bold tracking-[0.12em]">{BRAND.wordmark}</span>
        <button onClick={onClose} aria-label="Close" className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }}>
          ✕
        </button>
      </div>

      <p className="mp-label mb-3" style={{ color: 'var(--mp-text-tertiary)', textTransform: 'none' }}>
        {BRAND.tagline}
      </p>

      <div className="mp-label mb-3 flex items-center justify-between">
        <span style={{ color: 'var(--mp-text-tertiary)' }}>Version</span>
        <span style={{ color: 'var(--mp-text-primary)' }}>1.0</span>
      </div>

      <div className="mp-label mb-1.5" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
        Shortcuts
      </div>
      <div
        className="mb-3 flex flex-col gap-0.5 p-2"
        style={{ background: 'var(--mp-surface)', borderRadius: 'var(--mp-radius)' }}
      >
        {SHORTCUTS.map(([label, key]) => (
          <div key={label} className="mp-label flex items-center justify-between">
            <span style={{ color: 'var(--mp-text-secondary)' }}>{label}</span>
            <span
              className="px-1.5 py-0.5"
              style={{
                background: 'var(--mp-surface-active)',
                borderRadius: 4,
                color: 'var(--mp-text-primary)',
                fontSize: 9,
              }}
            >
              {key}
            </span>
          </div>
        ))}
      </div>

      <div className="mp-label flex items-center gap-3" style={{ color: 'var(--mp-text-tertiary)' }}>
        <a href={GUIDE_URL} target="_blank" rel="noreferrer" className="hover:underline">
          Guides
        </a>
        <a href={LEGAL.privacy} target="_blank" rel="noreferrer" className="hover:underline">
          Privacy
        </a>
        <a href={LEGAL.terms} target="_blank" rel="noreferrer" className="hover:underline">
          Terms
        </a>
        <span className="ml-auto">© {new Date().getFullYear()}</span>
      </div>
    </div>
  );
}
