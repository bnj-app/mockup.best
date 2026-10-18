'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Media drop choice. Drag-and-drop in a video editor is ambiguous: replace existing media or add a
 * scene? Ask explicitly. Skip the question for an empty scene, where placing the media is the only
 * meaningful action.
 */
export function DropChoice({
  fileName,
  onReplace,
  onNewScene,
  onCancel,
}: {
  fileName: string;
  onReplace: () => void;
  onNewScene: () => void;
  onCancel: () => void;
}) {
  /*
    Escape cancels. Other layers (UpgradeModal, DiscardDialog, dropdowns) already handle Escape, but
    this dialog did not. Users who drop a file accidentally especially need an easy way out.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-[960] grid place-items-center"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        // The role is required, as in UpgradeModal, for screen readers
        // and overlay-detection tests.
        role="dialog"
        aria-modal="true"
        aria-label="Add media"
        className="flex w-[300px] flex-col gap-2.5 p-3.5"
        style={{
          background: 'var(--mp-dropdown)',
          border: '1px solid var(--mp-border)',
          borderRadius: 'var(--mp-radius-lg)',
          boxShadow: 'var(--mp-shadow-dropdown)',
        }}
      >
        <span className="mp-label" style={{ color: 'var(--mp-text-focus)' }}>
          Add media
        </span>
        <span className="mp-label truncate" style={{ color: 'var(--mp-text-tertiary)' }}>
          {fileName}
        </span>
        <button className="mp-topbtn" onClick={onReplace}>
          Replace media in this scene
        </button>
        <button className="mp-topbtn" onClick={onNewScene}>
          Add as a new scene
        </button>
        <button
          className="mp-label"
          onClick={onCancel}
          style={{ color: 'var(--mp-text-tertiary)' }}
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}
