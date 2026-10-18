'use client';

/**
 * Interface sounds: a short completion tone after export and a shorter, lower blip for invalid
 * actions. Both are synthesized with WebAudio: network requests and caching for two tiny MP3s would
 * cost more than they save. Persist the preference so users who dislike interface sounds need not
 * disable them again.
 */
const KEY = 'mockuptop:sounds:v1';

/**
 * Hydration-safe read: server and first client render both return true; apply the real preference
 * after hydration. Reading localStorage in a useState initializer caused server/client differences
 * for users who disabled sound, breaking React hydration (#418).
 */
export function subscribeSounds(cb: () => void) {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
}

export function soundsEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundsEnabled(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Without storage, the preference lasts only for this tab; harmless.
  }
}

let ctx: AudioContext | null = null;

function tone(freqs: number[], dur: number, gainPeak: number) {
  if (!soundsEnabled()) return;
  try {
    if (!ctx) ctx = new AudioContext();
    void ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = ctx!.createOscillator();
      const g = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      // An envelope is required: abruptly starting/stopping a tone causes clicks.
      const t0 = now + i * dur * 0.5;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(ctx!.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    });
  } catch {
    // If audio cannot start due to permissions/policy, silently skip this decorative sound.
  }
}

/** Export complete: two ascending notes. */
export function playDone() {
  tone([660, 990], 0.18, 0.06);
}

/** Invalid action: one short, low note. */
export function playBlip() {
  tone([220], 0.09, 0.05);
}
