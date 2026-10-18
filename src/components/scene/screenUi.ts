import * as THREE from 'three';

/**
 * SCREEN UI for laptops/monitors: desktop, menu bar, Dock and browser window. Render everything
 * into one canvas texture, redrawn only when settings change. Place the screenshot on a separate
 * plane INSIDE the window (see `screenUiLayout`).
 * Copyright: no brand names or logos; use a generic circular icon, generic menu labels and
 * colored square app icons.
 */

export type ScreenUi = { menuBar: boolean; dock: boolean; browser: boolean; address: string };

export function screenUiActive(ui: ScreenUi | undefined): ui is ScreenUi {
  return !!ui && (ui.menuBar || ui.dock || ui.browser);
}

/** Layout in screen units (cm): media scale and center Y, plus the window box. */
export function screenUiLayout(ui: ScreenUi, cw: number, ch: number) {
  const menuH = ui.menuBar ? ch * 0.028 : 0;
  const dockH = ui.dock ? ch * 0.1 : 0;
  const chromeH = ui.browser ? ch * 0.052 : 0;
  const margin = ui.browser ? ch * 0.045 : ui.menuBar || ui.dock ? ch * 0.02 : 0;
  const availH = ch - menuH - dockH - 2 * margin;
  let s = Math.min((availH - chromeH) / ch, ui.browser ? (cw - margin * 3) / cw : 1);
  s = Math.max(0.3, Math.min(1, s));
  const top = ch / 2 - menuH - margin; // Top edge of the window.
  const bottom = -ch / 2 + dockH + margin;
  const winH = s * ch + chromeH;
  // Center the window vertically in the available space.
  const winTop = top - Math.max(0, (top - bottom - winH) / 2);
  const mediaTop = winTop - chromeH;
  return {
    scale: s,
    centerY: mediaTop - (s * ch) / 2,
    win: { x0: (-s * cw) / 2, x1: (s * cw) / 2, top: winTop, mediaTop, bottom: mediaTop - s * ch },
    menuH,
    dockH,
  };
}

const cache = new Map<string, THREE.CanvasTexture>();

export function screenUiTexture(ui: ScreenUi, cw: number, ch: number, bg: string | null): THREE.Texture {
  const key = `${ui.menuBar}|${ui.dock}|${ui.browser}|${ui.address}|${cw.toFixed(3)}|${ch.toFixed(3)}|${bg}`;
  const hit = cache.get(key);
  if (hit) {
    // LRU: move the used entry to the end (Map preserves insertion order).
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const W = 2400;
  const H = Math.round((W * ch) / cw);
  const k = W / cw; // cm → pixels
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  const L = screenUiLayout(ui, cw, ch);
  const py = (yCm: number) => (ch / 2 - yCm) * k; // Screen Y (positive upward) → canvas Y
  const px = (xCm: number) => (xCm + cw / 2) * k;

  // DESKTOP: the user's screen background or a soft abstract gradient.
  if (bg) {
    x.fillStyle = bg;
    x.fillRect(0, 0, W, H);
  } else {
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#7f9cf5');
    g.addColorStop(0.45, '#c3a6f0');
    g.addColorStop(1, '#f6b994');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    const r = x.createRadialGradient(W * 0.75, H * 0.2, 0, W * 0.75, H * 0.2, W * 0.6);
    r.addColorStop(0, 'rgba(255,255,255,0.45)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = r;
    x.fillRect(0, 0, W, H);
  }

  const font = (px_: number, w = 500) => `${w} ${px_}px -apple-system, "Segoe UI", Inter, Helvetica, Arial, sans-serif`;

  // BROWSER WINDOW: shadow and chrome bar, with the media plane beneath.
  if (ui.browser) {
    const wx0 = px(L.win.x0);
    const wx1 = px(L.win.x1);
    const wy0 = py(L.win.top);
    const wy1 = py(L.win.bottom);
    const rad = H * 0.012;
    x.save();
    x.shadowColor = 'rgba(0,0,0,0.35)';
    x.shadowBlur = H * 0.04;
    x.shadowOffsetY = H * 0.012;
    x.fillStyle = '#ffffff';
    roundRect(x, wx0, wy0, wx1 - wx0, wy1 - wy0, rad);
    x.fill();
    x.restore();
    const chromeH = py(L.win.mediaTop) - wy0;
    x.save();
    roundRect(x, wx0, wy0, wx1 - wx0, chromeH + rad, rad);
    x.clip();
    x.fillStyle = '#ececef';
    x.fillRect(wx0, wy0, wx1 - wx0, chromeH);
    x.restore();
    x.fillStyle = 'rgba(0,0,0,0.08)';
    x.fillRect(wx0, wy0 + chromeH - 1, wx1 - wx0, 1.5);
    // Traffic lights
    const cy = wy0 + chromeH / 2;
    const tr = chromeH * 0.13;
    ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
      x.beginPath();
      x.arc(wx0 + chromeH * 0.55 + i * tr * 3.2, cy, tr, 0, Math.PI * 2);
      x.fillStyle = col;
      x.fill();
    });
    // Back/forward
    x.strokeStyle = 'rgba(0,0,0,0.45)';
    x.lineWidth = chromeH * 0.06;
    x.lineCap = 'round';
    const ax = wx0 + chromeH * 2.6;
    for (const [dx, dir] of [
      [0, -1],
      [chromeH * 0.55, 1],
    ] as const) {
      x.beginPath();
      x.moveTo(ax + dx - dir * chromeH * 0.1, cy - chromeH * 0.16);
      x.lineTo(ax + dx + dir * chromeH * 0.1, cy);
      x.lineTo(ax + dx - dir * chromeH * 0.1, cy + chromeH * 0.16);
      x.stroke();
    }
    // Address box
    const bw = (wx1 - wx0) * 0.42;
    const bx = (wx0 + wx1) / 2 - bw / 2;
    const bh = chromeH * 0.62;
    x.fillStyle = '#ffffff';
    roundRect(x, bx, cy - bh / 2, bw, bh, bh / 2);
    x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.08)';
    x.lineWidth = 1.5;
    x.stroke();
    // Lock icon and address
    x.fillStyle = 'rgba(0,0,0,0.5)';
    const lk = bh * 0.22;
    const lx = (wx0 + wx1) / 2 - Math.min(bw * 0.4, ui.address.length * bh * 0.16) - lk * 2;
    x.fillRect(lx, cy - lk * 0.2, lk * 1.4, lk * 1.1);
    x.strokeStyle = 'rgba(0,0,0,0.5)';
    x.lineWidth = lk * 0.28;
    x.beginPath();
    x.arc(lx + lk * 0.7, cy - lk * 0.25, lk * 0.45, Math.PI, 0);
    x.stroke();
    x.fillStyle = 'rgba(0,0,0,0.72)';
    x.font = font(bh * 0.46, 500);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(ui.address || 'yourapp.com', (wx0 + wx1) / 2 + lk, cy + 1, bw - lk * 6);
    x.textAlign = 'left';
  }

  // MENU BAR: translucent white strip, generic menu labels and clock.
  if (ui.menuBar) {
    const mh = L.menuH * k;
    x.fillStyle = 'rgba(255,255,255,0.42)';
    x.fillRect(0, 0, W, mh);
    x.fillStyle = 'rgba(20,20,25,0.85)';
    x.font = font(mh * 0.55, 600);
    x.textBaseline = 'middle';
    // Generic circular icon, not a logo.
    x.beginPath();
    x.arc(mh * 0.9, mh / 2, mh * 0.24, 0, Math.PI * 2);
    x.fill();
    let mx = mh * 1.6;
    x.fillText('Browser', mx, mh / 2);
    mx += x.measureText('Browser').width + mh * 0.9;
    x.font = font(mh * 0.55, 450);
    for (const item of ['File', 'Edit', 'View', 'History', 'Window', 'Help']) {
      x.fillText(item, mx, mh / 2);
      mx += x.measureText(item).width + mh * 0.8;
    }
    x.textAlign = 'right';
    x.fillText('Tue 7 Oct  9:41', W - mh * 0.7, mh / 2);
    const tx = W - mh * 0.7 - x.measureText('Tue 7 Oct  9:41').width - mh * 0.8;
    // Battery
    x.strokeStyle = 'rgba(20,20,25,0.85)';
    x.lineWidth = mh * 0.06;
    x.strokeRect(tx - mh * 0.95, mh * 0.33, mh * 0.85, mh * 0.36);
    x.fillRect(tx - mh * 0.9, mh * 0.38, mh * 0.6, mh * 0.26);
    // Wi-Fi arcs
    for (let i = 0; i < 3; i++) {
      x.beginPath();
      x.arc(tx - mh * 1.6, mh * 0.72, mh * (0.12 + i * 0.13), -Math.PI * 0.75, -Math.PI * 0.25);
      x.stroke();
    }
    x.textAlign = 'left';
  }

  // DOCK: frosted-glass strip with colorful generic app icons.
  if (ui.dock) {
    const icon = L.dockH * k * 0.52;
    const n = 9;
    const pad = icon * 0.22;
    const dw = n * icon + (n + 1) * pad;
    const dh = icon + pad * 2;
    const dx = W / 2 - dw / 2;
    const dy = H - L.dockH * k * 0.18 - dh;
    x.fillStyle = 'rgba(255,255,255,0.32)';
    roundRect(x, dx, dy, dw, dh, dh * 0.3);
    x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.55)';
    x.lineWidth = 2;
    x.stroke();
    const cols = [
      ['#4facfe', '#00f2fe'],
      ['#f6d365', '#fda085'],
      ['#a18cd1', '#fbc2eb'],
      ['#43e97b', '#38f9d7'],
      ['#fa709a', '#fee140'],
      ['#30cfd0', '#330867'],
      ['#ff9a9e', '#fecfef'],
      ['#667eea', '#764ba2'],
      ['#d4d4d8', '#a1a1aa'],
    ];
    cols.forEach(([a, b2], i) => {
      const ix = dx + pad + i * (icon + pad);
      const iy = dy + pad;
      const g = x.createLinearGradient(ix, iy, ix + icon, iy + icon);
      g.addColorStop(0, a);
      g.addColorStop(1, b2);
      x.fillStyle = g;
      roundRect(x, ix, iy, icon, icon, icon * 0.23);
      x.fill();
      // Simple white glyph
      x.fillStyle = 'rgba(255,255,255,0.85)';
      x.beginPath();
      if (i % 3 === 0) x.arc(ix + icon / 2, iy + icon / 2, icon * 0.2, 0, Math.PI * 2);
      else if (i % 3 === 1) roundRect(x, ix + icon * 0.3, iy + icon * 0.3, icon * 0.4, icon * 0.4, icon * 0.06);
      else {
        x.moveTo(ix + icon * 0.5, iy + icon * 0.28);
        x.lineTo(ix + icon * 0.72, iy + icon * 0.7);
        x.lineTo(ix + icon * 0.28, iy + icon * 0.7);
        x.closePath();
      }
      x.fill();
    });
    // Running-app dot
    x.fillStyle = 'rgba(20,20,25,0.7)';
    x.beginPath();
    x.arc(dx + pad + icon / 2, dy + dh - pad * 0.4, icon * 0.05, 0, Math.PI * 2);
    x.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // Evict only the OLDEST entries: each address-box keystroke creates a new key;
  // clearing the entire cache also disposed textures currently displayed on other devices.
  while (cache.size >= 16) {
    const [oldKey, old] = cache.entries().next().value!;
    old.dispose();
    cache.delete(oldKey);
  }
  cache.set(key, tex);
  return tex;
}

function roundRect(x: CanvasRenderingContext2D, a: number, b: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(a + r, b);
  x.arcTo(a + w, b, a + w, b + h, r);
  x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r);
  x.arcTo(a, b, a + w, b, r);
  x.closePath();
}
