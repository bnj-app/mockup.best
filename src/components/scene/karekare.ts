'use client';

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

/**
 * Karekare: frame-by-frame video export engine (WebCodecs).

 * The name is Turkish for "frame by frame".

 * Why: canvas.captureStream + MediaRecorder records in real time. Dropped
 * preview frames enter the file directly; at high quality and 4K the encoder
 * can fall behind, while duration remains tied to wall-clock time.
 * Users notice only after downloading.

 * This path controls time: set the playhead to i / fps, render the scene,
 * then send the frame to VideoEncoder. Slower machines take longer to export,
 * but frame count, duration and content remain identical.

 * LIMITATION: this version encodes video only. With project audio, the caller
 * falls back to the real-time path (see exportBridge), preferring audio with
 * real-time recording over a silent file.
 */

export type FrameExportOptions = {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  bitrate: number;
  /** Seek to the given time in seconds and render; return when the frame is ready. */
  renderFrame: (timeSec: number) => Promise<void> | void;
  /** Source canvas from which frames are captured. */
  canvas: HTMLCanvasElement;
  /** Progress callback, 0..1. */
  onProgress?: (ratio: number) => void;
  /** Mixed audio; omitted audio produces a silent video. */
  audio?: AudioBuffer | null;
  /** AAC bitrate (bps). Default 128k; App Store previews require 256k. */
  audioBitrate?: number;
};

/*
  H.264 level table (ITU-T H.264 Table A-1): maximum macroblocks/second,
  frame size in macroblocks, and Main bitrate in kbps (High x1.25).
*/
const AVC_LEVELS: [hex: string, mbps: number, fs: number, brKbps: number][] = [
  ['1f', 108_000, 3_600, 14_000], // 3.1
  ['20', 216_000, 5_120, 20_000], // 3.2
  ['28', 245_760, 8_192, 20_000], // 4.0
  ['2a', 522_240, 8_704, 50_000], // 4.2
  ['32', 589_824, 22_080, 135_000], // 5.0
  ['33', 983_040, 36_864, 240_000], // 5.1
  ['34', 2_073_600, 36_864, 240_000], // 5.2
  ['3c', 4_177_920, 139_264, 240_000], // 6.0
  ['3d', 8_355_840, 139_264, 480_000], // 6.1
  ['3e', 16_711_680, 139_264, 800_000], // 6.2
];

/** Smallest level supporting the dimensions, fps and bitrate (High profile). */
export function avcLevel(w: number, h: number, fps: number, bitrate: number): string {
  const mbW = Math.ceil(w / 16);
  const mbH = Math.ceil(h / 16);
  const fs = mbW * mbH;
  const mbps = fs * fps;
  const kbps = bitrate / 1000;
  for (const [hex, maxMbps, maxFs, maxBr] of AVC_LEVELS) {
    // Edge limit: each side <= sqrt(8 x MaxFS) macroblocks.
    const edge = Math.sqrt(8 * maxFs);
    if (fs <= maxFs && mbps <= maxMbps && kbps <= maxBr * 1.25 && mbW <= edge && mbH <= edge) return hex;
  }
  return '3e';
}

/**
 * Select the requested AAC bitrate or the first supported lower rate.

 * Measured on Chrome/Windows: the AAC encoder accepts only 96/128/160/192 kbps.
 * For 256k, isConfigSupported returns false and encoding throws "Unsupported bitrate".
 * App Store previews require 256k: use it where supported, otherwise 192k on Windows.
 */
async function pickAudioBitrate(
  base: { codec: string; numberOfChannels: number; sampleRate: number },
  wanted: number,
): Promise<number> {
  for (const b of [wanted, 192_000, 160_000, 128_000]) {
    if (b > wanted) continue;
    try {
      if ((await AudioEncoder.isConfigSupported({ ...base, bitrate: b })).supported) return b;
    } catch {
      // Treat as unsupported and try the next lower rate.
    }
  }
  return 128_000;
}

/** Does the browser support this export path? */
export function canUseWebCodecs(): boolean {
  return (
    typeof window !== 'undefined' &&
    'VideoEncoder' in window &&
    'VideoFrame' in window &&
    typeof HTMLCanvasElement !== 'undefined'
  );
}

export async function exportFrameByFrame(opts: FrameExportOptions): Promise<Blob> {
  const { width, height, fps, durationSec, bitrate, renderFrame, canvas } = opts;

  /*
    Dimensions must be even: H.264 4:2:0 rejects odd sizes and the encoder
    fails silently. Round odd dimensions down by one.
  */
  const w = Math.floor(width / 2) * 2;
  const h = Math.floor(height / 2) * 2;

  const audio = opts.audio ?? null;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: w, height: h },
    ...(audio
      ? {
          audio: {
            codec: 'aac' as const,
            numberOfChannels: Math.min(2, audio.numberOfChannels),
            sampleRate: audio.sampleRate,
          },
        }
      : null),
    fastStart: 'in-memory',
  });

  let encoderError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e;
    },
  });

  /*
    PROFILE SELECTION: a low-cost quality improvement.

    The fixed avc1.42003e profile was BASELINE, without CABAC or B-frames.
    At the same bitrate it produces visibly more blocking and gradient banding
    than High, especially on the flat gradient backgrounds common in mockup videos.
    Compatibility was the only reason for Baseline; High is now standard on
    QuickTime, Windows, iOS and Android.

    Try High -> Main -> Baseline, selecting the first supported profile.
    If isConfigSupported does not respond, fall back to the previous behavior.
  */
  /*
    LEVEL must account for fps and bitrate, not just dimensions. Previously,
    >1080p selected 5.1 and other sizes 4.0. With the default 60 fps, 1080p60
    therefore advertised level 4.0 in SPS (ffprobe: level=40). Level 4.0 allows
    245,760 macroblocks/s, while 1080p60 needs 489,600 (level 4.2).
    Tolerant players accept it, but strict hardware decoders and some transcoders
    may reject the stream. Keep the old level as a last-resort candidate if
    an encoder rejects the calculated level.
  */
  const level = avcLevel(w, h, fps, bitrate);
  const legacy = w * h > 1920 * 1088 ? '33' : '28';
  const candidates = [
    `avc1.6400${level}`,
    `avc1.4d00${level}`,
    ...(legacy !== level ? [`avc1.6400${legacy}`, `avc1.4d00${legacy}`] : []),
    'avc1.42003e',
  ];
  const baseCfg = {
    width: w,
    height: h,
    bitrate,
    framerate: fps,
    avc: { format: 'avc' as const },
    /*
      Variable bitrate avoids allocating the same bits to static resting frames
      as moving frames, leaving more capacity for motion. latencyMode: 'quality'
      allows better encoder decisions at the cost of frame latency, acceptable
      for offline export.
    */
    bitrateMode: 'variable' as const,
    latencyMode: 'quality' as const,
  };
  let picked = candidates[candidates.length - 1];
  if (typeof VideoEncoder.isConfigSupported === 'function') {
    for (const codec of candidates) {
      try {
        const res = await VideoEncoder.isConfigSupported({ ...baseCfg, codec });
        if (res?.supported) {
          picked = codec;
          break;
        }
      } catch {
        /* Try the next candidate. */
      }
    }
  }
  encoder.configure({ ...baseCfg, codec: picked });

  const total = Math.max(1, Math.round(durationSec * fps));
  const frameDurUs = Math.round(1_000_000 / fps);

  for (let i = 0; i < total; i += 1) {
    if (encoderError) break;
    await renderFrame(i / fps);

    const frame = new VideoFrame(canvas, {
      timestamp: i * frameDurUs,
      duration: frameDurUs,
    });
    // Keyframe every 2 seconds for smooth seeking.
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();

    /*
      Bound the queue: submitting thousands of frames without waiting can retain
      hundreds of MB of VideoFrames and crash the tab. Pause when two frames behind.
    */
    /*
      Queue limit increased from 2 to 6: at 2, rendering and encoding were almost
      serial, each waiting while the other worked. Six frames allow overlap
      without accumulating thousands of frames in memory, noticeably speeding export.
    */
    if (encoder.encodeQueueSize > 6) {
      await new Promise<void>((resolve) => {
        const wait = () => {
          if (encoder.encodeQueueSize <= 6) resolve();
          else setTimeout(wait, 4);
        };
        wait();
      });
    }
    opts.onProgress?.((i + 1) / total);
  }

  /*
    ERROR ORDER: breaking on encoderError and then calling flush() made the
    failed encoder throw its own error, hiding the clearer message below.
    Users saw a raw browser DOMException instead.
  */
  try {
    await encoder.flush();
  } catch (err) {
    if (!encoderError) encoderError = err;
  }
  try {
    encoder.close();
  } catch {
    // Ignore if already closed.
  }
  if (encoderError) throw new Error('Video encoding failed');

  /*
    AUDIO: encode after video. Feeding both encoders simultaneously complicates
    queue management unnecessarily, since audio is already buffered.
    Sequential encoding is simpler and safer.

    If audio encoding fails, still deliver the video: a silent file lets users
    keep the visuals instead of losing the entire export.
  */
  if (audio) {
    try {
      const channels = Math.min(2, audio.numberOfChannels);
      const aEnc = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: () => {},
      });
      const base = { codec: 'mp4a.40.2', numberOfChannels: channels, sampleRate: audio.sampleRate };
      aEnc.configure({ ...base, bitrate: await pickAudioBitrate(base, opts.audioBitrate ?? 128_000) });

      /*
        AudioData expects interleaved f32, while AudioBuffer stores separate channels.
        Passing it directly mixes up channels and produces crackling;
        interleave the samples manually.
      */
      const frames = audio.length;
      const inter = new Float32Array(frames * channels);
      for (let c = 0; c < channels; c += 1) {
        const data = audio.getChannelData(c);
        for (let i = 0; i < frames; i += 1) inter[i * channels + c] = data[i];
      }

      // 1024-sample chunks: the typical AAC frame size expected by the encoder.
      const CHUNK = 1024;
      for (let i = 0; i < frames; i += CHUNK) {
        const n = Math.min(CHUNK, frames - i);
        const slice = inter.subarray(i * channels, (i + n) * channels);
        const ad = new AudioData({
          format: 'f32',
          sampleRate: audio.sampleRate,
          numberOfFrames: n,
          numberOfChannels: channels,
          timestamp: Math.round((i / audio.sampleRate) * 1_000_000),
          data: slice,
        });
        aEnc.encode(ad);
        ad.close();
      }
      await aEnc.flush();
      aEnc.close();
    } catch {
      // Audio encoding failed; still deliver the video.
    }
  }

  muxer.finalize();
  const { buffer } = muxer.target as ArrayBufferTarget;
  return new Blob([buffer], { type: 'video/mp4' });
}
