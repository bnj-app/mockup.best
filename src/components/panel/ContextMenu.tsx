'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Context menu.
 * Why: provide powerful actions such as reversing scenes, clearing tracks, closing gaps and
 * replacing images without cluttering panels with buttons. A shared menu keeps these features
 * discoverable with consistent behavior.
 * A portal is required: timeline and top bar use `backdrop-filter`, creating stacking contexts.
 * Leaving the menu inside those containers can place it beneath the canvas.
 */

export type MenuItem = {
  label: string;
  onSelect: () => void;
  /** Destructive action, shown in red. */
  danger?: boolean;
  disabled?: boolean;
};

export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  /** Ready-to-use handler to attach to an element. */
  const open = (items: MenuItem[]) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  return { menu, open, close: () => setMenu(null) };
}

export function ContextMenu({
  menu,
  onClose,
}: {
  menu: { x: number; y: number; items: MenuItem[] } | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!menu) return;
    const away = () => onClose();
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // `capture`: the menu's own clicks are separated below by `stopPropagation`;
    // this listener closes the menu on every outside click.
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    window.addEventListener('resize', away);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('resize', away);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  /*
    Keep the fixed-width menu on screen by shifting it inward near the right/bottom edges. An
    invisible first render to measure and reposition it would be excessive for a menu this small.
  */
  const W = 190;
  const H = menu.items.length * 28 + 8;
  const x = Math.min(menu.x, window.innerWidth - W - 8);
  const y = Math.min(menu.y, window.innerHeight - H - 8);

  return createPortal(
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-[900] py-1"
      style={{
        left: x,
        top: y,
        width: W,
        background: 'var(--mp-dropdown)',
        border: '1px solid var(--mp-border)',
        borderRadius: 'var(--mp-radius-lg)',
        boxShadow: 'var(--mp-shadow-dropdown)',
      }}
    >
      {menu.items.map((item) => (
        <button
          key={item.label}
          disabled={item.disabled}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          className="mp-label flex h-7 w-full items-center px-3 text-left disabled:opacity-40"
          style={{ color: item.danger ? '#ff6b57' : undefined }}
          onMouseEnter={(e) => {
            if (!item.disabled) e.currentTarget.style.background = 'var(--mp-surface-active)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
