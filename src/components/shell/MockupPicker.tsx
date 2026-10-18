'use client';
import { openGoalPack } from '@/components/shell/GoalPackModal';

import { useState, useSyncExternalStore } from 'react';
import { FileButton } from '@/components/panel/Controls';
import { useEditor } from '@/store/editor';
import { getDevice } from '@/config/devices';

/**
 * EMPTY PROJECT PICKER.

 * Before showing twenty controls, ask which device should display the media.
 * Once a device is selected, Border, Blur and Light settings have clear context.

 * Shown only without media, and never again after selection or dismissal.
 * Repeated welcome screens interrupt users rather than helping them.
 */
const TILES = ['flat', 'phone', 'laptop', 'display'] as const;
/** Persist whether the picker has been dismissed; see below. */
const SEEN_KEY = 'mockuptop:picker-seen:v1';

export function MockupPicker({ onUpload }: { onUpload: (file: File) => void }) {
  /*
    ⚠️ Two pitfalls:

    1) mediaName also counts as media. Autosave deliberately omits media
       because data URLs exceed localStorage quota, but retains the file name.
       Checking only x.media marked existing projects as empty after reopening,
       repeatedly placing this dialog over the middle of the frame.

    2) Dismissal must survive refresh. Component state alone did not preserve
       the promise to show it only once; store the flag in localStorage.

    Hydration: decide AFTER mount so the server and first client frame match,
    avoiding React #418.
  */
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const hasMedia = useEditor((s) => s.shots.some((x) => x.media || x.mediaName));
  const patchShot = useEditor((s) => s.patchShot);
  const [dismissed, setDismissed] = useState(false);

  const seen =
    mounted &&
    (() => {
      try {
        return window.localStorage.getItem(SEEN_KEY) === '1';
      } catch {
        return false;
      }
    })();

  const close = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Without storage, at least suppress it for the rest of this session.
    }
    setDismissed(true);
  };

  if (!mounted || hasMedia || dismissed || seen) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
      <div
        className="pointer-events-auto flex flex-col items-center gap-3 px-5 py-4"
        style={{
          background: 'var(--mp-dropdown)',
          border: '1px solid var(--mp-border)',
          borderRadius: 'var(--mp-radius-lg)',
          boxShadow: 'var(--mp-shadow-dropdown)',
        }}
      >
        <span className="mp-label" style={{ color: 'var(--mp-text-focus)' }}>
          Choose a mockup
        </span>

        <div className="flex gap-2">
          {TILES.map((id) => {
            const d = getDevice(id);
            if (!d) return null;
            // Use the actual body ratio for the silhouette; blank gray cards do not identify devices.
            const a = d.body.w / d.body.h;
            let w = Math.min(44, 34 * a);
            let h = w / a;
            if (h > 34) {
              h = 34;
              w = 34 * a;
            }
            return (
              <button
                key={id}
                onClick={() => {
                  patchShot({ deviceId: d.id, finishId: d.finishes[0].id });
                  close();
                }}
                className="grid w-[76px] place-items-center gap-1.5 py-2.5"
                style={{ background: 'var(--mp-surface)', borderRadius: 'var(--mp-radius)' }}
              >
                <span
                  style={{
                    width: w,
                    height: h,
                    borderRadius: Math.max(
                      2,
                      Math.min(w, h) * (d.body.radius / Math.min(d.body.w, d.body.h)),
                    ),
                    background: 'linear-gradient(150deg, rgba(28,32,44,0.9), rgba(28,32,44,0.6))',
                    border: '1px solid rgba(255,255,255,0.4)',
                  }}
                />
                <span className="mp-label" style={{ fontSize: 9 }}>
                  {d.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <FileButton
            accept="image/*,video/*"
            className="mp-topbtn cursor-pointer"
            onPick={(f) => {
              onUpload(f);
              close();
            }}
          >
            Upload media
          </FileButton>
          <button className="mp-topbtn" onClick={close}>
            Skip
          </button>
        </div>
        {/* Alternative entry point for users starting with a goal (config/packs.ts). */}
        <button
          className="mp-label underline"
          style={{ color: 'var(--mp-text-tertiary)' }}
          onClick={() => {
            close();
            openGoalPack();
          }}
          data-picker-goal
        >
          or start from a goal — launch video, store set, portfolio
        </button>
      </div>
    </div>
  );
}
