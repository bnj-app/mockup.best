'use client';

import { ColorInput } from '@/components/panel/ColorInput';
import { useState } from 'react';
import {
  BACKGROUNDS,
  decodeCustom,
  encodeCustom,
  getBackground,
  toCss,
  type Background,
} from '@/config/backgrounds';

/**
 * Background picker. Use a grid instead of a dropdown: backgrounds are visual choices, not names.
 * Each tile shows the actual gradient, using the same definition as the scene for an exact match.
 * The gradient editor below lets users specify brand colors regardless of how many presets are
 * available.
 */
export function BackgroundPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const custom = decodeCustom(value);
  const [editing, setEditing] = useState(!!custom);

  // Initialize the editor from the current background instead of a blank state.
  const [draft, setDraft] = useState<Background>(
    custom ?? { ...getBackground(value), id: 'draft', label: 'Custom' },
  );

  const apply = (next: Background) => {
    setDraft(next);
    onChange(encodeCustom(next));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-1.5">
        {BACKGROUNDS.map((b) => (
          <button
            key={b.id}
            onClick={() => {
              setEditing(false);
              onChange(b.id);
            }}
            title={b.label}
            className="relative aspect-square overflow-hidden"
            style={{
              background: toCss(b),
              borderRadius: 6,
              outline: value === b.id ? '2px solid var(--mp-accent)' : '1px solid var(--mp-border)',
              outlineOffset: value === b.id ? 1 : 0,
            }}
          />
        ))}

        {/* Custom background tile */}
        <button
          onClick={() => {
            setEditing(true);
            apply(draft);
          }}
          title="Custom gradient"
          className="grid aspect-square place-items-center"
          style={{
            background: custom ? toCss(custom) : 'var(--mp-surface)',
            borderRadius: 6,
            outline: custom ? '2px solid var(--mp-accent)' : '1px dashed var(--mp-border-hover)',
            color: 'var(--mp-text-tertiary)',
          }}
        >
          {custom ? null : <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>}
        </button>
      </div>

      {editing ? (
        <div
          className="flex flex-col gap-2 p-2"
          style={{ background: 'var(--mp-surface)', borderRadius: 'var(--mp-radius)' }}
        >
          <div className="flex items-center gap-2">
            <span className="mp-label flex-1">Angle</span>
            <input
              type="range"
              aria-label="Gradient angle"
              min={0}
              max={360}
              value={draft.angle}
              onChange={(e) => apply({ ...draft, angle: Number(e.target.value) })}
              className="w-28 accent-[var(--mp-accent)]"
            />
            <span className="mp-label w-8 text-right" style={{ color: 'var(--mp-text-primary)' }}>
              {draft.angle}
            </span>
          </div>

          {draft.stops.map((stop, i) => (
            <div key={i} className="flex items-center gap-2">
              <ColorInput
                label={`Color stop ${i + 1} color`}
                value={stop.color}
                onChange={(color) => {
                  const stops = draft.stops.map((s, j) => (j === i ? { ...s, color } : s));
                  apply({ ...draft, stops });
                }}
              />
              <input
                type="range"
                aria-label={`Color stop ${i + 1} position`}
                min={0}
                max={100}
                value={Math.round(stop.at * 100)}
                onChange={(e) => {
                  const stops = draft.stops.map((s, j) =>
                    j === i ? { ...s, at: Number(e.target.value) / 100 } : s,
                  );
                  apply({ ...draft, stops });
                }}
                className="flex-1 accent-[var(--mp-accent)]"
              />
              {draft.stops.length > 2 ? (
                <button
                  onClick={() => apply({ ...draft, stops: draft.stops.filter((_, j) => j !== i) })}
                  className="mp-label px-1"
                  style={{ color: 'var(--mp-text-tertiary)' }}
                  title="Remove stop"
                >
                  ✕
                </button>
              ) : (
                <span className="w-4" />
              )}
            </div>
          ))}

          {draft.stops.length < 5 ? (
            <button
              onClick={() =>
                apply({
                  ...draft,
                  stops: [...draft.stops, { at: 1, color: draft.stops[draft.stops.length - 1].color }],
                })
              }
              className="mp-label py-1"
              style={{ background: 'var(--mp-surface-active)', borderRadius: 6 }}
            >
              + color stop
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
