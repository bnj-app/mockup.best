/**
 * Status bar color.
 *
 * Black "9:41" is unreadable on dark screenshots, nearly disappearing on
 * dark purple UI. Like a phone, choose light or dark based on content:
 * sample the brightness of the media's top strip.
 *
 * Preview and export share this function to stay consistent.
 */
export function statusTint(src: CanvasImageSource | null): '#000000' | '#ffffff' {
  if (!src) return '#000000';
  const v = src as HTMLVideoElement;
  const i = src as HTMLImageElement;
  const w = v.videoWidth || i.naturalWidth || (src as HTMLCanvasElement).width;
  const h = v.videoHeight || i.naturalHeight || (src as HTMLCanvasElement).height;
  if (!w || !h) return '#000000';

  // Downsample the top 12% into a small canvas and measure average luminance.
  const S = 24;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '#000000';
  try {
    ctx.drawImage(src, 0, 0, w, Math.max(1, Math.round(h * 0.12)), 0, 0, S, S);
    const d = ctx.getImageData(0, 0, S, S).data;
    let sum = 0;
    for (let p = 0; p < d.length; p += 4) {
      sum += 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
    }
    return sum / (S * S) < 140 ? '#ffffff' : '#000000';
  } catch {
    return '#000000';
  }
}
