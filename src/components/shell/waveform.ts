'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { analyzeBuffer, type BeatInfo } from '@/lib/beats';
import { useEditor, type AudioTrack } from '@/store/editor';

/**
 * Audio waveform: peak bars inside the clip. Decode each file once with decodeAudioData, reduce it
 * to BUCKETS bins and cache by URL. Decoding can be expensive for long MP3s, so the component does
 * not wait; redraw when peaks arrive. Beat detection shares the decoded data: publish peaks first,
 * then analyze beats (lib/beats.ts, ~0.5 s on the main thread for a 3-minute track), keeping the
 * waveform independent of that wait.
 */
const BUCKETS = 240;
const cache = new Map<string, number[] | 'loading' | 'failed'>();
const beatCache = new Map<string, BeatInfo | 'loading' | 'failed'>();
const listeners = new Set<() => void>();
let ver = 0;

function bump() {
  ver++;
  for (const l of listeners) l();
}

async function decode(url: string) {
  beatCache.set(url, 'loading');
  let audio: AudioBuffer;
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    const ctx = new Ctx(1, 2, 44100);
    audio = await ctx.decodeAudioData(buf);
    const ch = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / BUCKETS));
    const peaks: number[] = [];
    let max = 0;
    for (let i = 0; i < BUCKETS; i++) {
      let p = 0;
      const end = Math.min(ch.length, (i + 1) * step);
      for (let j = i * step; j < end; j += 8) p = Math.max(p, Math.abs(ch[j]));
      peaks.push(p);
      max = Math.max(max, p);
    }
    cache.set(url, peaks.map((p) => (max > 0 ? p / max : 0)));
  } catch {
    cache.set(url, 'failed');
    beatCache.set(url, 'failed');
    bump();
    return;
  }
  bump();
  try {
    beatCache.set(url, await analyzeBuffer(audio));
  } catch {
    beatCache.set(url, 'failed');
  }
  bump();
}

/** Start decoding once. Called by both the waveform component and beat reader. */
function ensureDecoded(url: string) {
  if (cache.get(url) === undefined) {
    cache.set(url, 'loading');
    void decode(url);
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useWaveform(url: string | null): number[] | null {
  useSyncExternalStore(subscribe, () => ver, () => 0);
  if (!url) return null;
  ensureDecoded(url);
  const e = cache.get(url);
  return Array.isArray(e) ? e : null;
}

export type ProjectBeats = {
  /** 'none' = no audio track; 'nobeat' = audio present, but no clear beats. */
  state: 'none' | 'loading' | 'ready' | 'nobeat';
  /** Tempo of the first track with beats. */
  bpm: number;
  /** Beats from all tracks in project time (seconds, sorted, unique). */
  beats: number[];
};

/**
 * Project beats: each track's beat time is start + b. If duration is known after loadedmetadata,
 * discard beats outside it. Merge beats from different tracks less than 30 ms apart.
 */
export function projectBeats(tracks: AudioTrack[]): ProjectBeats {
  const withUrl = tracks.filter((a) => !!a.url);
  if (!withUrl.length) return { state: 'none', bpm: 0, beats: [] };
  let loading = false;
  let bpm = 0;
  const all: number[] = [];
  for (const a of withUrl) {
    ensureDecoded(a.url!);
    const e = beatCache.get(a.url!);
    if (e === undefined || e === 'loading') {
      loading = true;
      continue;
    }
    if (e === 'failed' || !e.beats.length) continue;
    if (!bpm) bpm = e.bpm;
    for (const b of e.beats) if (!(a.duration > 0) || b < a.duration) all.push(a.start + b);
  }
  all.sort((p, q) => p - q);
  const beats: number[] = [];
  for (const b of all) if (!beats.length || b - beats[beats.length - 1] > 0.03) beats.push(b);
  if (beats.length) return { state: 'ready', bpm, beats };
  return { state: loading ? 'loading' : 'nobeat', bpm: 0, beats: [] };
}

/** React hook: recompute when tracks or analysis change. */
export function useProjectBeats(): ProjectBeats {
  const v = useSyncExternalStore(subscribe, () => ver, () => 0);
  const tracks = useEditor((s) => s.audioTracks);
  // v is the analysis version: recompute after cache changes even with the same track list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => projectBeats(tracks), [tracks, v]);
}
