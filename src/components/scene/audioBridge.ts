'use client';

/**
 * AUDIO BRIDGE: preview playback and export audio mixing.
 * Why a separate module: audio is accessed both from the React tree (timeline play/pause) and
 * outside it (MediaRecorder during export). Both need the same `<audio>` element.
 * CRITICAL CONSTRAINT: `createMediaElementSource` can be called only ONCE in an `<audio>`
 * element's lifetime. A second call throws InvalidStateError and silences audio. Create the
 * source node lazily with the element and never recreate it. Keep it connected to both the
 * recording destination and speakers, since connecting only to recording would silence previews.
 */

type Entry = {
  el: HTMLAudioElement;
  source?: MediaElementAudioSourceNode;
  gain?: GainNode;
};

const entries = new Map<string, Entry>();
let ctx: AudioContext | null = null;
/** Destination collecting audio tracks during export. */
let recordDest: MediaStreamAudioDestinationNode | null = null;

function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Get or create the `<audio>` element for this audio. */
export function ensureAudio(id: string, url: string): HTMLAudioElement {
  const found = entries.get(id);
  if (found) {
    if (found.el.src !== url) found.el.src = url;
    return found.el;
  }
  const el = new Audio(url);
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  entries.set(id, { el });
  return el;
}

export function removeAudio(id: string) {
  const e = entries.get(id);
  if (!e) return;
  e.el.pause();
  e.source?.disconnect();
  e.gain?.disconnect();
  entries.delete(id);
}

/**
 * Preview synchronization: drive audio from the playhead and playback state.
 * The 0.25 s tolerance is essential: setting `currentTime` every frame repeatedly seeks and
 * causes clicking. Correct only substantial drift.
 */
export function syncAudio(
  tracks: { id: string; url: string | null; start: number; volume: number }[],
  playhead: number,
  playing: boolean,
) {
  /*
    SILENCE AUDIO REMOVED FROM THE PROJECT. Elements live in this map, separately from the store
    list. Deleting a track or replacing the project (New project, file or share link) left
    elements playing here. When the list became empty this function was never called, so even
    Pause could not stop them. Reconcile the lists on every synchronization.
  */
  if (entries.size > tracks.length || tracks.some((t) => !t.url)) {
    const live = new Set(tracks.filter((t) => t.url).map((t) => t.id));
    for (const id of [...entries.keys()]) if (!live.has(id)) removeAudio(id);
  }
  for (const t of tracks) {
    if (!t.url) continue;
    const el = ensureAudio(t.id, t.url);
    const local = playhead - t.start;
    const inside = local >= 0 && (Number.isNaN(el.duration) || local <= el.duration);
    el.volume = Math.min(1, Math.max(0, t.volume));

    if (!playing || !inside) {
      if (!el.paused) el.pause();
      // Follow the playhead even while paused so playback starts at the correct
      // position after scrubbing.
      if (inside && Math.abs(el.currentTime - local) > 0.25) el.currentTime = local;
      continue;
    }
    if (Math.abs(el.currentTime - local) > 0.25) el.currentTime = local;
    if (el.paused) void el.play().catch(() => {});
  }
}

/**
 * Prepare audio for export and return its MediaStreamTrack list.
 * An empty list produces silent video, which the caller accepts as normal when the project has no
 * audio.
 */
export function audioTracksForRecording(): MediaStreamTrack[] {
  if (!entries.size) return [];
  const ac = audioContext();
  // The browser autoplay policy may have suspended the context.
  void ac.resume().catch(() => {});
  if (!recordDest) recordDest = ac.createMediaStreamDestination();

  for (const entry of entries.values()) {
    if (!entry.source) {
      try {
        entry.source = ac.createMediaElementSource(entry.el);
        entry.gain = ac.createGain();
        entry.source.connect(entry.gain);
        // Connect to BOTH speakers (preview) and the recording destination.
        entry.gain.connect(ac.destination);
        entry.gain.connect(recordDest);
      } catch {
        // Silently skip if already connected or blocked by the browser:
        // recording without audio is better than no recording.
      }
    }
  }
  return recordDest.stream.getAudioTracks();
}

/**
 * Diagnostics: current state of each audio element. Tests cannot find `new Audio()` elements in
 * the DOM because they are never attached; the initial test therefore missed its playback check.
 */
export function audioDebugState() {
  return [...entries.entries()].map(([id, e]) => ({
    id,
    paused: e.el.paused,
    currentTime: Number(e.el.currentTime.toFixed(2)),
    volume: e.el.volume,
    duration: Number.isFinite(e.el.duration) ? Number(e.el.duration.toFixed(2)) : null,
  }));
}

/**
 * Audio for FRAME-BY-FRAME export: mix all tracks into ONE buffer.
 * Real-time recording can add audio to the MediaRecorder stream. Frame-by-frame time is
 * independent of wall time, so audio must be prepared OFFLINE. `OfflineAudioContext` places each
 * track at its start time and produces a single project-length buffer ready for `AudioEncoder`.
 * Return `null` when there are no tracks; the caller produces silent video.
 */
export async function renderAudioMix(
  tracks: { url: string | null; start: number; volume: number }[],
  durationSec: number,
): Promise<AudioBuffer | null> {
  const usable = tracks.filter((t) => t.url);
  if (!usable.length || durationSec <= 0) return null;

  const rate = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(durationSec * rate), rate);
  let placed = 0;

  for (const t of usable) {
    try {
      const res = await fetch(t.url as string);
      const bytes = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(bytes);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = Math.min(1, Math.max(0, t.volume));
      src.connect(gain);
      gain.connect(ctx.destination);
      // Negative start times break `start()`; clamp to zero.
      src.start(Math.max(0, t.start));
      placed += 1;
    } catch {
      // An undecodable track must not abort recording: silent video is better
      // than no video.
    }
  }
  if (!placed) return null;
  return ctx.startRendering();
}

/** Rewind and stop audio when recording finishes. */
export function stopAllAudio() {
  for (const e of entries.values()) {
    e.el.pause();
    e.el.currentTime = 0;
  }
}
