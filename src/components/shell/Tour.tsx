'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileButton } from '@/components/panel/Controls';
import { useEditor } from '@/store/editor';
import { isPhoneLike } from '@/components/shell/PhoneGate';

/**
 * First-visit tour and bottom hint strip.
 * An eight-step tour and upload hint guide users who would otherwise face an empty editor.
 * Targets use `data-tour` attributes rather than DOM structure, so moving buttons does not
 * silently break the tour. Always use named hooks, as with automation scripts.
 */
const STEPS: { sel: string; title: string; text: string }[] = [
  {
    sel: '[data-tour="source"]',
    title: 'Upload your screen',
    text: 'Drop a screenshot or video here — or paste with Ctrl+V. It lands on the device instantly.',
  },
  {
    sel: '[data-tour="mockup"]',
    title: 'Pick a device',
    text: 'Glass phones, tablets, laptops, displays. Layouts put multiple devices in one scene.',
  },
  {
    sel: 'canvas',
    title: 'Frame your shot',
    text: 'Drag to orbit, scroll to zoom, Space+drag to pan, Alt+drag to rotate the device. The camera panel gives you precise control.',
  },
  {
    sel: '[data-tour="record"]',
    title: 'Animate it',
    text: 'Hit Record, move the camera, and keyframes land on the timeline. Or grab a motion preset.',
  },
  {
    sel: '[data-tour="templates"]',
    title: 'Start from a template',
    text: 'Full scenes — device, lighting, background and camera — in one click. Your media stays.',
  },
  {
    sel: '[data-tour="export"]',
    title: 'Export',
    text: 'PNG or JPG at any size up to 4K, every App Store size in one batch, video on Pro.',
  },
];

const SEEN_KEY = 'mockuptop:tour-seen:v1';

export function Tour() {
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Start automatically on the first visit; repeat via Help → Restart tour.
  useEffect(() => {
    let seen = true;
    try {
      seen = !!window.localStorage.getItem(SEEN_KEY);
    } catch {
      // Without storage, skip autostart so the tour does not reappear every visit.
    }
    let timer: number | undefined;
    /*
      Wait 8 s rather than 1.2: the opening demo is the landing experience, and its first two
      scenes (phone reveal and music dive) showcase the product. Starting the tour at 1.2 s
      darkened the whole scene and obscured that moment. Show it first, then explain.
    */
    /*
      No automatic tour on phones: steps describe desktop controls (Ctrl+V, right panel,
      timeline), most of which are hidden on phones. PhoneGate welcomes mobile visitors; Help can
      still launch the tour manually.
    */
    if (!seen && !isPhoneLike()) timer = window.setTimeout(() => setStep(0), 8000);
    const onRestart = () => setStep(0);
    window.addEventListener('mockuptop:tour', onRestart);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mockuptop:tour', onRestart);
    };
  }, []);

  const finish = useCallback(() => {
    setStep(null);
    try {
      window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // If saving fails, the tour will reappear next visit; acceptable.
    }
  }, []);

  /*
    Escape ends the tour. Its full-screen dimming layer intercepts clicks, leaving Skip as the
    only exit before this handler. Match modals, dropdowns and context menus by supporting Escape.
  */
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, finish]);

  // Track the target bounds when the step or window size changes.
  // If the target is absent from the DOM (e.g. Record while the timeline is closed),
  // SKIP the step so the tour cannot get stuck invisibly.
  useEffect(() => {
    if (step === null) return;
    const el = document.querySelector(STEPS[step].sel);
    if (!el) {
      // Defer to a microtask: synchronous setState in the effect body triggers lint.
      const t = window.setTimeout(() => {
        if (step + 1 < STEPS.length) setStep(step + 1);
        else finish();
      }, 0);
      return () => window.clearTimeout(t);
    }
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step, finish]);

  if (step === null || !rect) return null;
  const s = STEPS[step];

  // Place the card below the target, or above if it does not fit.
  const below = rect.bottom + 150 < window.innerHeight;
  const cardTop = below ? rect.bottom + 10 : undefined;
  const cardBottom = below ? undefined : window.innerHeight - rect.top + 10;
  const cardLeft = Math.max(12, Math.min(window.innerWidth - 292, rect.left));

  return (
    <div className="fixed inset-0 z-[940]" onClick={finish}>
      {/* Spotlight: leave the target bright and dim everything else. */}
      <div
        className="absolute"
        style={{
          left: rect.left - 6,
          top: rect.top - 6,
          width: rect.width + 12,
          height: rect.height + 12,
          borderRadius: 10,
          boxShadow: '0 0 0 9999px rgba(8,9,12,0.55)',
          border: '1.5px solid var(--mp-accent)',
          pointerEvents: 'none',
        }}
      />
      <div
        className="absolute w-[280px] p-3"
        style={{
          top: cardTop,
          bottom: cardBottom,
          left: cardLeft,
          background: 'var(--mp-dropdown)',
          border: '1px solid var(--mp-border)',
          borderRadius: 'var(--mp-radius-lg)',
          boxShadow: 'var(--mp-shadow-dropdown)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="mp-label block" style={{ color: 'var(--mp-text-primary)', fontSize: 12 }}>
          {s.title}
        </span>
        <span className="mp-label mt-1 block leading-relaxed">{s.text}</span>
        <div className="mt-2.5 flex items-center justify-between">
          <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }}>
            {step + 1} / {STEPS.length}
          </span>
          <span className="flex gap-1.5">
            <button className="mp-label px-2 py-1" style={{ color: 'var(--mp-text-tertiary)' }} onClick={finish}>
              Skip
            </button>
            {step > 0 ? (
              <button
                className="mp-label px-2 py-1"
                style={{ background: 'var(--mp-surface-active)', borderRadius: 6 }}
                onClick={() => setStep(step - 1)}
              >
                Back
              </button>
            ) : null}
            <button
              className="mp-label px-2.5 py-1"
              style={{ background: 'var(--mp-accent)', color: '#fff', borderRadius: 6 }}
              onClick={() => (step + 1 < STEPS.length ? setStep(step + 1) : finish())}
            >
              {step + 1 < STEPS.length ? 'Next' : 'Done'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Bottom hint strip: a one-sentence prompt that remains until media is uploaded, then disappears.
 */
export function HintStrip({ onUpload }: { onUpload: (file: File) => void }) {
  const hasMedia = useEditor((s) => s.shots.some((x) => x.media));
  const [dismissed, setDismissed] = useState(false);

  if (hasMedia || dismissed) return null;
  return (
    <div
      className="mp-label pointer-events-auto absolute bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 py-1.5 pl-3.5 pr-1.5"
      style={{
        background: 'var(--mp-dropdown)',
        border: '1px solid var(--mp-border)',
        borderRadius: 999,
        boxShadow: 'var(--mp-shadow-dropdown)',
      }}
    >
      <span style={{ color: 'var(--mp-text-primary)' }}>
        Upload media to get started — or paste / drop.
      </span>
      <FileButton
        accept="image/*,video/*"
        className="cursor-pointer px-2.5 py-1"
        style={{ background: 'var(--mp-accent)', color: '#fff', borderRadius: 999 }}
        onPick={onUpload}
      >
        Upload
      </FileButton>
      <button
        onClick={() => setDismissed(true)}
        className="px-1.5"
        style={{ color: 'var(--mp-text-tertiary)' }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
