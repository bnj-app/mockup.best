import * as THREE from 'three';

/**
 * Status bar over the device screen. Why: personal screenshots often include inconsistent times,
 * carriers, and 38% battery readings. Our overlaid bar makes product images clean and consistent.
 * Generated as a separate texture and placed as a thin strip over the screen, leaving source media
 * unchanged and allowing users to disable it.
 */

export type StatusBarStyle = {
  /** Displayed time, e.g. "9:41". */
  time: string;
  /** White on dark screens, black on light screens. */
  dark: boolean;
  /** Battery charge, 0–1. */
  battery: number;
};

const cache = new Map<string, THREE.CanvasTexture>();

export function getStatusBarTexture(style: StatusBarStyle): THREE.CanvasTexture {
  const key = `${style.time}|${style.dark}|${style.battery.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // Wide and short to fit the screen's top strip.
  const W = 1024;
  const H = 120;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const ink = style.dark ? '#ffffff' : '#0a0a0c';

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = ink;

  // Time: left.
  ctx.font = `600 46px ui-rounded, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(style.time, 70, H / 2);

  // Signal bars: right block.
  const barsX = W - 300;
  for (let i = 0; i < 4; i += 1) {
    const h = 14 + i * 10;
    ctx.fillRect(barsX + i * 20, H / 2 + 22 - h, 13, h);
  }

  // Wi-Fi: three arcs.
  const wifiX = barsX + 110;
  const wifiY = H / 2 + 20;
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i += 1) {
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(wifiX, wifiY, 12 + i * 13, -Math.PI * 0.78, -Math.PI * 0.22);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(wifiX, wifiY - 2, 5, 0, Math.PI * 2);
  ctx.fill();

  // Battery: body, terminal, and fill.
  const bx = W - 130;
  const by = H / 2 - 22;
  const bw = 78;
  const bh = 44;
  ctx.lineWidth = 7;
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = ink;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 12);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.roundRect(bx + bw + 6, by + bh / 2 - 8, 8, 16, 4);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(bx + 7, by + 7, (bw - 14) * Math.min(1, Math.max(0, style.battery)), bh - 14, 7);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}
