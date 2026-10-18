import type { Quad } from './homography';

/**
 * Asset: a square photo with an alpha screen cutout, plus calibration.
 *
 * `quad` stores normalized photo coordinates (0..1) in top-left, top-right,
 * bottom-right, bottom-left order. Avoid pixel coordinates so one manifest
 * works for both 1800px previews and 3600px exports.
 */
export type PhotoAsset = {
  id: string;
  kind: 'hand' | 'scene';
  /** Human-readable label for internal records, not displayed in the UI. */
  label: string;
  /** public/hand/preview/<file>.webp + public/hand/thumb/<file>.webp */
  file: string;
  quad: Quad;
  /** Screen corner radius as a fraction of its short edge; 0 is square. */
  screenRadius: number;
  /** Keeps a white status bar readable over dark photos. */
  statusBar: 'black' | 'white' | 'none';
  /** Generation record: source prompt and iteration. */
  gen?: { model: string; round: number; prompt: string };
};

export const ASSET_SIZE = { preview: 1800, thumb: 400 } as const;

export function assetUrl(a: PhotoAsset, size: 'preview' | 'thumb') {
  return `/${a.kind}/${size}/${a.file}.webp`;
}

/**
 * Fetch the manifest at runtime, not build time, so calibration updates
 * do not require restarting the dev server.
 */
export async function loadManifest(): Promise<PhotoAsset[]> {
  const res = await fetch('/assets/manifest.json', { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}
