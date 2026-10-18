/**
 * Device layout: MEASURED rule.
 * `zoom` is the ratio of device height to canvas height: at 1x the device fills the canvas
 * height, at 0.5x it fills half, at 2x it overflows at twice the height. Measurements on a 686 px
 * canvas:
 * 0.5→h .500 top .249 · 0.75→.751/.125 · 0.9→.899/.050 · 1→1.000/0
 * 1.25→1.251/.117 · 1.5→1.500/.117 · 1.75→1.751/.117 · 2→2.000/.117
 * Vertically center at zoom ≤ 1; at zoom > 1, pin the top at 11.7% so the screen top and status
 * bar stay in frame when enlarged. Always center horizontally.
 */

export const OVERSIZE_TOP = 0.117;

export function deviceLayout(size: number, dw: number, dh: number, zoom: number) {
  const h = size * zoom;
  const scale = h / dh;
  const w = dw * scale;
  const x = (size - w) / 2;
  const y = zoom <= 1 ? (size - h) / 2 : size * OVERSIZE_TOP;
  return { x, y, w, h, scale };
}
