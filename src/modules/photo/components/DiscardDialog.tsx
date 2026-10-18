'use client';

import { useEffect } from 'react';

/**
 * "Discard changes?" confirmation. Escape opens it when no other modal or popover is open; "Discard"
 * resets the editor to defaults. Measurements: 512x148, radius 10, background #f5f5f5, padding 24. H2
 * "Discard changes?" 18px/600; P "This cannot be undone." 14px/400. "Keep editing": 118x36, background
 * #f5f5f5, text rgba(51,51,51,.75), radius 8. "Discard": 83x36, red background, white text, radius 8.
 */
export function DiscardDialog({
  open,
  onKeep,
  onDiscard,
}: {
  open: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  /**
   * Escape means "Keep editing". The dialog's `role="dialog"` blocks the Editor's global Escape handler.
   * Without a local handler, this dialog did not respond to Escape, unlike LoginModal and EmojiPicker.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onKeep();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onKeep]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center p-4"
      style={{ background: 'rgba(0,0,0,.35)' }}
      onClick={onKeep}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Discard changes?"
        onClick={(e) => e.stopPropagation()}
        className="w-full"
        style={{ maxWidth: 512, background: '#f5f5f5', borderRadius: 10, padding: 24 }}
      >
        <h2 className="text-[18px] font-semibold">Discard changes?</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onKeep}
            className="mp-ctl inline-flex h-9 items-center justify-center px-4 text-sm font-medium cursor-pointer"
            style={{ borderRadius: 8 }}
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="inline-flex h-9 items-center justify-center px-4 text-sm font-medium cursor-pointer"
            style={{ borderRadius: 8, background: '#e5484d', color: '#fff' }}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
