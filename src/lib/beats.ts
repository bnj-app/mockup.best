/**
 * BEAT DETECTION - entirely client-side.
 *
 * 1. Audio is downsampled to 11 025 Hz mono (OfflineAudioContext resamples
 *    and mixes channels): sufficient for beats, with 4x cheaper FFTs.
 * 2. ONSET STRENGTH: short-time Fourier transform (512-sample Hann window,
 *    128-sample hop, approximately 11.6 ms), log-magnitude spectral flux.
 *    Only increases count: note/beat onsets add energy. Subtract the local
 *    mean and clamp negative values to zero.
 * 3. TEMPO: autocorrelate the onset envelope over 60-200 BPM with a log-normal
 *    weight centered on 120 BPM. Octave errors (64 mistaken for 128) are
 *    the most common failure.
 * 4. BEATS: dynamic programming (Ellis 2007) places each beat about one
 *    period after the previous beat and near a strong onset. Tempo is assumed constant;
 *    phase and small timing shifts are free. Weak beats in leading/trailing
 *    silence are discarded.
 *
 * The pure computation (`analyzeSamples`) uses no browser APIs and can be
 * tested directly with a sample array.
 */

export type BeatInfo = {
  /** Estimated tempo (beats per minute). */
  bpm: number;
  /** Beat times on the file's own timeline (seconds, ascending). */
  beats: number[];
};

const SR = 11025;
const N = 512;
const HOP = 128;

/** In-place iterative radix-2 FFT (separate re/im arrays). */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Onset strength envelope: one value per frame (frame t = t*HOP/SR seconds, centered window). */
export function onsetEnvelope(x: Float32Array, sr = SR, raw = false): Float32Array {
  const frames = Math.max(0, Math.floor(x.length / HOP));
  const env = new Float32Array(frames);
  if (frames < 2) return env;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  /*
    LOG-SPACED BANDS (a rough mel approximation). Summing flux over raw FFT
    bins gives each bin equal weight: broadband hiss (offbeat hi-hats) over
    250 bins overwhelmed a kick drum spanning 6-8 bins, locking the tracker
    BETWEEN beats. A synthetic 128 BPM track had the correct tempo but a
    half-period phase error. Bands give each octave roughly equal weight.
  */
  const edges: number[] = [];
  const nb = N / 2;
  for (let i = 0; i <= 28; i++) {
    const f = 30 * Math.pow(sr / 2 / 30, i / 28);
    const k = Math.min(nb, Math.max(1, Math.round((f * N) / sr)));
    if (!edges.length || k > edges[edges.length - 1]) edges.push(k);
  }
  const bands = edges.length - 1;
  let prev = new Float32Array(bands);
  let cur = new Float32Array(bands);
  for (let t = 0; t < frames; t++) {
    // The window CENTERS the frame: frame t is at t*HOP (zero-padded at both ends).
    const c = t * HOP - N / 2;
    for (let i = 0; i < N; i++) {
      const j = c + i;
      re[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0;
    for (let b = 0; b < bands; b++) {
      let m = 0;
      for (let k = edges[b]; k < edges[b + 1]; k++) m += Math.hypot(re[k], im[k]);
      const v = Math.log1p(100 * (m / (edges[b + 1] - edges[b])));
      cur[b] = v;
      if (t > 0) {
        const d = v - prev[b];
        if (d > 0) flux += d;
      }
    }
    env[t] = flux;
    const sw = prev;
    prev = cur;
    cur = sw;
  }
  // Subtract the local mean (~0.4 s) so sustained sounds (pads, noise) do not raise the envelope.
  const half = Math.round((0.2 * sr) / HOP);
  const out = new Float32Array(frames);
  let acc = 0;
  let lo = 0;
  let hi = -1;
  for (let t = 0; t < frames; t++) {
    while (hi < Math.min(frames - 1, t + half)) acc += env[++hi];
    while (lo < t - half) acc -= env[lo++];
    out[t] = Math.max(0, env[t] - acc / (hi - lo + 1));
  }
  if (raw) return out;
  // Scale by the standard deviation to make thresholds independent of volume.
  let s2 = 0;
  for (let t = 0; t < frames; t++) s2 += out[t] * out[t];
  const sd = Math.sqrt(s2 / frames) || 1;
  for (let t = 0; t < frames; t++) out[t] /= sd;
  return out;
}

/** Autocorrelation period (fractional frames). */
function estimatePeriod(env: Float32Array, fr: number): number {
  const minLag = Math.floor((fr * 60) / 200);
  const maxLag = Math.min(env.length - 1, Math.ceil((fr * 60) / 60));
  const score = new Float32Array(maxLag + 2);
  let best = -1;
  let bestS = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let t = lag; t < env.length; t++) s += env[t] * env[t - lag];
    s /= env.length - lag;
    const bpm = (60 * fr) / lag;
    // Prior centered on 120 BPM with a one-octave standard deviation (librosa default).
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120), 2));
    score[lag] = s * w;
    if (score[lag] > bestS) {
      bestS = score[lag];
      best = lag;
    }
  }
  if (best <= minLag || best >= maxLag) return best;
  // Parabolic interpolation: the period is not an integer frame count (128 BPM is about 40.4 frames).
  const a = score[best - 1];
  const b = score[best];
  const c = score[best + 1];
  const den = a - 2 * b + c;
  return den < 0 ? best + (0.5 * (a - c)) / den : best;
}

/** Dynamic-programming beat tracking. Returns beat frame indices. */
function trackBeats(env: Float32Array, period: number): number[] {
  const n = env.length;
  // Gaussian smoothing at 1/32 of the period tolerates onset peaks shifting by a frame or two.
  const sig = Math.max(1, period / 32);
  const r = Math.ceil(sig * 3);
  const local = new Float32Array(n);
  for (let t = 0; t < n; t++) {
    let s = 0;
    for (let k = -r; k <= r; k++) {
      const j = t + k;
      if (j >= 0 && j < n) s += env[j] * Math.exp(-0.5 * (k / sig) * (k / sig));
    }
    local[t] = s;
  }
  const cum = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const tight = 100;
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = -Infinity;
    let arg = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const lg = Math.log((t - p) / period);
      const v = cum[p] - tight * lg * lg;
      if (v > best) {
        best = v;
        arg = p;
      }
    }
    cum[t] = local[t] + (arg >= 0 ? best : 0);
    back[t] = arg;
  }
  // Last beat: highest cumulative score within the final period.
  let end = n - 1;
  for (let t = Math.max(0, n - Math.ceil(period)); t < n; t++) if (cum[t] > cum[end]) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]) beats.push(t);
  beats.reverse();
  // Trim leading/trailing beats in silence (librosa: half the smoothed envelope's RMS).
  let s2 = 0;
  for (let t = 0; t < n; t++) s2 += local[t] * local[t];
  const thr = 0.5 * Math.sqrt(s2 / Math.max(1, n));
  let a = 0;
  let b = beats.length;
  while (a < b && local[beats[a]] < thr) a++;
  while (b > a && local[beats[b - 1]] < thr) b--;
  return beats.slice(a, b);
}

/** Tempo and beats from mono samples (11 025 Hz recommended). `beats` is empty if no clear beat exists. */
/**
 * PERIODICITY GATE: maximum autocorrelation of the mean-centered onset
 * envelope over 60-200 BPM, relative to zero lag. Dividing the envelope by
 * its standard deviation inflated numerical residue in beatless audio
 * (steady tones, pads, noise) to unit variance, causing dynamic programming
 * to find false beats: a steady tone produced 14. Measurements over 8-25 s:
 * tone 0.004, white noise 0.105, slowly swelling chord 0.096, irregular
 * chopping sounds 0.071; music and rhythm recordings 0.27-0.94. Threshold: 0.16.
 */
const PERIODICITY_MIN = 0.16;

function periodicity(env: Float32Array, fr: number): number {
  const n = env.length;
  let m = 0;
  for (let t = 0; t < n; t++) m += env[t];
  m /= n;
  let r0 = 0;
  for (let t = 0; t < n; t++) r0 += (env[t] - m) * (env[t] - m);
  r0 /= n;
  if (!(r0 > 1e-12)) return 0;
  let best = 0;
  const maxLag = Math.min(n - 1, Math.ceil(fr));
  for (let lag = Math.floor((fr * 60) / 200); lag <= maxLag; lag++) {
    let c = 0;
    for (let t = lag; t < n; t++) c += (env[t] - m) * (env[t - lag] - m);
    best = Math.max(best, c / (n - lag));
  }
  return best / r0;
}

export function analyzeSamples(x: Float32Array, sr = SR): BeatInfo {
  const fr = sr / HOP;
  const env = onsetEnvelope(x, sr, true);
  if (env.length < fr * 2) return { bpm: 0, beats: [] };
  if (periodicity(env, fr) < PERIODICITY_MIN) return { bpm: 0, beats: [] };
  let s2 = 0;
  for (let t = 0; t < env.length; t++) s2 += env[t] * env[t];
  const sd = Math.sqrt(s2 / env.length) || 1;
  for (let t = 0; t < env.length; t++) env[t] /= sd;
  const period = estimatePeriod(env, fr);
  if (!(period > 0)) return { bpm: 0, beats: [] };
  const frames = trackBeats(env, period);
  /*
    +1 hop correction: flux peaks as an onset enters the window, before it
    reaches the center. Synthetic tracks showed a systematic -10 to -14 ms
    offset (one hop = 11.6 ms). After correction: +/-3 ms.
  */
  const beats = frames.map((t) => Math.round((((t + 1) * HOP) / sr) * 1000) / 1000);
  if (beats.length < 4) return { bpm: 0, beats: [] };
  /*
    Derive BPM from the least-squares slope of beat times: integer frame
    intervals (128 BPM = 40.4 frames, alternating 40/41) made the median
    interval report 129 BPM.
  */
  const n = beats.length;
  const mx = (n - 1) / 2;
  const my = beats.reduce((s, b) => s + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  beats.forEach((b, i) => {
    sxy += (i - mx) * (b - my);
    sxx += (i - mx) * (i - mx);
  });
  return { bpm: Math.round((60 / (sxy / sxx)) * 10) / 10, beats };
}

/** Downsample decoded audio to 11 025 Hz mono and analyze it. */
export async function analyzeBuffer(audio: AudioBuffer): Promise<BeatInfo> {
  const len = Math.ceil(audio.duration * SR);
  if (len < SR) return { bpm: 0, beats: [] };
  const Ctx =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new Ctx(1, len, SR);
  const src = ctx.createBufferSource();
  src.buffer = audio;
  src.connect(ctx.destination);
  src.start();
  const mono = await ctx.startRendering();
  return analyzeSamples(mono.getChannelData(0), SR);
}
