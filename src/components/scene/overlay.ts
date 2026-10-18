import * as THREE from 'three';
import type { TextItem } from '@/store/editor';

/**
 * Screen overlay: text and ticker.
 * Why a 2D canvas → texture → camera-attached plane?
 * DOM text would be easiest but absent from exports: both PNG and MP4 come directly from the
 * WebGL canvas. Actual 3D text geometry would limit font support. Drawing with any font on a 2D
 * canvas and placing its texture in front of the camera solves both: everything drawn appears in
 * exports.
 */

export type OverlayInput = {
  width: number;
  height: number;
  /** Text items and their current animation state (opacity / vertical offset). */
  items: (TextItem & {
    anim?: {
      opacity: number;
      rise: number;
      /** Entrance/exit progress (0→1) and lifetime within the window (0→1). */
      inP?: number;
      outP?: number;
      life?: number;
      /** Typewriter: visible character fraction (0→1). Counter: count progress (0→1). */
      type?: number;
      count?: number;
    };
  })[];
  /** Time in seconds, used to calculate the ticker offset. */
  time: number;
  /** Watermark applied on the free plan. */
  watermark?: string | null;
  /**
   * Scene transition. `amount` 0 = no transition, 1 = fully covered. Sliding also uses the
   * `slide` direction.
   */
  transition?: { kind: 'cut' | 'fade' | 'slide'; amount: number };
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/*
  Logo image cache. Notify on `onload`: dirty checking requires a redraw after loading or the logo
  never appears, as previously happened with fonts.
*/
const logoCache = new Map<string, HTMLImageElement>();
let onLogoLoaded: (() => void) | null = null;

export function setLogoLoadedHandler(fn: (() => void) | null) {
  onLogoLoaded = fn;
}

function logoImage(src: string): HTMLImageElement {
  const found = logoCache.get(src);
  if (found) return found;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => onLogoLoaded?.();
  img.src = src;
  logoCache.set(src, img);
  return img;
}

/** Draw the overlay. Frame-relative dimensions keep proportions identical at every resolution. */
export function drawOverlay(canvas: HTMLCanvasElement, input: OverlayInput) {
  const { width, height, items, time, watermark, transition } = input;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  // Scale by the shorter edge so text keeps the same proportions at 4K and 720p.
  const unit = Math.min(width, height);

  for (const item of items) {
    if (!item.visible) continue;
    /*
      TIME WINDOW + ENTRANCE/EXIT. The caller computes `anim` because only it knows scene-local
      time. Apply it here; skip drawing at zero opacity.
    */
    const anim = item.anim ?? { opacity: 1, rise: 0 };
    if (anim.opacity <= 0.001) continue;
    /*
      Pitfall: body and strip drawing below overwrite `globalAlpha` with item.opacity. Setting
      animation opacity only at the start hid the fade because later assignments replaced it.
      Carry animation opacity as a MULTIPLIER.
    */
    const a = (v: number) => v * anim.opacity;

    /*
      LOGO: an image item with the same time window and position/size/rotation fields; only
      drawing differs. Cache images at module level: creating a new Image each frame would
      continuously upload to the GPU.
    */
    if (item.kind === 'logo') {
      const img = item.src ? logoImage(item.src) : null;
      if (img && img.complete && img.naturalWidth) {
        const w = item.size * unit;
        const h = w * (img.naturalHeight / img.naturalWidth);
        ctx.save();
        ctx.globalAlpha = a(item.opacity);
        ctx.translate(item.x * width, item.y * height);
        if (item.rotation) ctx.rotate((item.rotation * Math.PI) / 180);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
      continue;
    }

    const fontSize = item.size * unit;
    ctx.save();
    if (anim.rise) ctx.translate(0, anim.rise * unit);
    ctx.font = `${item.weight} ${fontSize}px "${item.font}", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = `${item.tracking * fontSize}px`;

    if (item.kind === 'text') {
      ctx.textAlign = item.align;
      const x = item.x * width;
      const y = item.y * height;

      ctx.translate(x, y);
      if (item.rotation) ctx.rotate((item.rotation * Math.PI) / 180);

      /*
        WORD ANIMATIONS.
        knock-*: the entire line enters from the side with an overshooting slide.
        words-*: words slide in/out sequentially from the side.
        cycle: show words ONE AT A TIME throughout the window.
      */
      const pin = anim.inP ?? 1;
      const pout = anim.outP ?? 1;
      const backOut = (t: number) => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      };
      const ease = (t: number) => 1 - Math.pow(1 - t, 3);
      let knockX = 0;
      if (item.enter === 'knock-left') knockX -= (1 - backOut(pin)) * unit * 0.9;
      if (item.enter === 'knock-right') knockX += (1 - backOut(pin)) * unit * 0.9;
      if (item.exit === 'knock-left') knockX -= (1 - ease(pout)) * unit * 0.9;
      if (item.exit === 'knock-right') knockX += (1 - ease(pout)) * unit * 0.9;
      if (knockX) ctx.translate(knockX, 0);
      const wordsIn = item.enter === 'words-left' ? -1 : item.enter === 'words-right' ? 1 : 0;
      const wordsOut = item.exit === 'words-left' ? -1 : item.exit === 'words-right' ? 1 : 0;
      const cycle = item.enter === 'cycle' || item.exit === 'cycle';

      let textForLines = item.text;
      let cycleAlpha = 1;
      if (cycle) {
        const words = item.text.split(/\s+/).filter(Boolean);
        const life = Math.max(0, Math.min(0.9999, anim.life ?? 0));
        const k = Math.max(1, words.length);
        const idx = Math.floor(life * k);
        const sub = life * k - idx;
        textForLines = words[idx] ?? '';
        // Each word fades briefly in/out; hold the first during entrance and the last during exit.
        const fin = idx === 0 ? 1 : Math.min(1, sub / 0.12);
        const fout = idx === k - 1 ? 1 : Math.min(1, (1 - sub) / 0.12);
        cycleAlpha = Math.min(fin, fout);
      }

      /*
        TYPEWRITER + COUNTER. Fix layout using the FULL text width so centered lines do not shift
        while typing or counting. Compute the line origin from its full width, then draw the
        visible portion from that left edge.
      */
      const typing = item.enter === 'type' || item.exit === 'type';
      const counting = item.enter === 'count' || item.exit === 'count';
      const stable = (typing && (anim.type ?? 1) < 1) || (counting && (anim.count ?? 1) < 1);
      let typedBudget = typing ? Math.round((anim.type ?? 1) * textForLines.length) : Infinity;
      const shownText = counting ? countText(textForLines, ease(anim.count ?? 1)) : textForLines;
      const shownLines = shownText.split('\n');
      const caretOn = typing && (anim.type ?? 1) < 1;

      const lines = textForLines.split('\n');
      const lineHeight = fontSize * item.lineHeight;
      const totalH = lineHeight * (lines.length - 1);
      const totalWords = Math.max(1, item.text.split(/\s+/).filter(Boolean).length);
      let wordIndex = 0;

      lines.forEach((line, i) => {
        const ly = i * lineHeight - totalH / 2;

        if (stable) {
          const full = ctx.measureText(line).width;
          const x0 = item.align === 'center' ? -full / 2 : item.align === 'right' ? -full : 0;
          let vis = shownLines[i] ?? '';
          let caretHere = false;
          if (typing) {
            const before = typedBudget;
            vis = vis.slice(0, Math.max(0, before));
            typedBudget -= line.length + 1;
            caretHere = caretOn && before >= 0 && before <= line.length;
          }
          ctx.textAlign = 'left';
          if (item.shadow > 0) {
            ctx.shadowColor = `rgba(0,0,0,${item.shadow})`;
            ctx.shadowBlur = fontSize * 0.25;
            ctx.shadowOffsetY = fontSize * 0.06;
          } else {
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
          }
          if (vis && item.strokeWidth > 0) {
            ctx.lineWidth = item.strokeWidth * fontSize;
            ctx.strokeStyle = item.strokeColor;
            ctx.lineJoin = 'round';
            ctx.strokeText(vis, x0, ly);
          }
          ctx.fillStyle = item.color;
          ctx.globalAlpha = a(item.opacity);
          if (vis) ctx.fillText(vis, x0, ly);
          if (caretHere) {
            // Cursor: a thin bar in the text color immediately after the last typed character.
            const cx = x0 + (vis ? ctx.measureText(vis).width : 0) + fontSize * 0.04;
            ctx.fillRect(cx, ly - fontSize * 0.42, Math.max(1, fontSize * 0.07), fontSize * 0.84);
          }
          ctx.globalAlpha = a(1);
          ctx.textAlign = item.align;
          return;
        }

        if ((wordsIn || wordsOut) && !cycle) {
          // Word by word: lay out the line manually, with separate progress for each word.
          const parts = line.split(/(\s+)/);
          const lw = ctx.measureText(line).width;
          let cx = item.align === 'center' ? -lw / 2 : item.align === 'right' ? -lw : 0;
          ctx.textAlign = 'left';
          if (item.shadow > 0) {
            ctx.shadowColor = `rgba(0,0,0,${item.shadow})`;
            ctx.shadowBlur = fontSize * 0.25;
            ctx.shadowOffsetY = fontSize * 0.06;
          }
          for (const part of parts) {
            const pw = ctx.measureText(part).width;
            if (part.trim()) {
              const order = wordIndex / Math.max(1, totalWords - 1);
              const span = 0.55;
              const li = wordsIn ? ease(Math.max(0, Math.min(1, (pin - order * (1 - span)) / span))) : 1;
              const lo = wordsOut ? ease(Math.max(0, Math.min(1, (pout - (1 - order) * (1 - span)) / span))) : 1;
              const dx = ((wordsIn ? (1 - li) * wordsIn : 0) + (wordsOut ? (1 - lo) * wordsOut : 0)) * fontSize * 0.9;
              const al = Math.min(li, lo);
              if (al > 0.001) {
                if (item.strokeWidth > 0) {
                  ctx.lineWidth = item.strokeWidth * fontSize;
                  ctx.strokeStyle = item.strokeColor;
                  ctx.lineJoin = 'round';
                  ctx.globalAlpha = a(al);
                  ctx.strokeText(part, cx + dx, ly);
                }
                ctx.fillStyle = item.color;
                ctx.globalAlpha = a(item.opacity * al);
                ctx.fillText(part, cx + dx, ly);
              }
              wordIndex++;
            }
            cx += pw;
          }
          ctx.globalAlpha = a(1);
          ctx.textAlign = item.align;
          return;
        }

        if (item.shadow > 0) {
          ctx.shadowColor = `rgba(0,0,0,${item.shadow})`;
          ctx.shadowBlur = fontSize * 0.25;
          ctx.shadowOffsetY = fontSize * 0.06;
        } else {
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
        }

        if (item.strokeWidth > 0) {
          ctx.lineWidth = item.strokeWidth * fontSize;
          ctx.strokeStyle = item.strokeColor;
          ctx.lineJoin = 'round';
          ctx.strokeText(line, 0, ly);
        }

        ctx.fillStyle = item.color;
        ctx.globalAlpha = a(item.opacity * cycleAlpha);
        ctx.fillText(line, 0, ly);
        ctx.globalAlpha = a(1);
      });
    } else {
      /*
        TICKER: an endlessly scrolling band from right to left.
        Draw two consecutive copies so one enters from the right as the other leaves, hiding the
        seam. A single copy left a gap on every cycle.
      */
      const text = item.text.replace(/\n/g, '  ');
      const gap = fontSize * 2;
      ctx.textAlign = 'left';
      const measured = ctx.measureText(text).width + gap;
      const bandH = fontSize * item.lineHeight * 1.6;
      const bandY = item.y * height;

      if (item.bandOpacity > 0) {
        ctx.globalAlpha = a(item.bandOpacity);
        ctx.fillStyle = item.bandColor;
        roundRect(ctx, 0, bandY - bandH / 2, width, bandH, item.bandRadius * bandH);
        ctx.fill();
        ctx.globalAlpha = a(1);
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, bandY - bandH / 2, width, bandH);
      ctx.clip();

      // Scroll speed: frame widths per second.
      const offset = (time * item.speed * width) % measured;
      for (let i = -1; i <= Math.ceil(width / measured); i += 1) {
        const x = width - offset + i * measured;
        if (item.strokeWidth > 0) {
          ctx.lineWidth = item.strokeWidth * fontSize;
          ctx.strokeStyle = item.strokeColor;
          ctx.lineJoin = 'round';
          ctx.strokeText(text, x, bandY);
        }
        ctx.fillStyle = item.color;
        ctx.globalAlpha = a(item.opacity);
        ctx.fillText(text, x, bandY);
        ctx.globalAlpha = a(1);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  /*
    WATERMARK for the free plan.
    Place it at bottom right, readable but unobtrusive. Draw INSIDE the text overlay: exports come
    directly from the WebGL canvas, so a separate DOM label would leave exported images without a
    watermark.
  */
  if (watermark) {
    const size = unit * 0.026;
    const pad = unit * 0.03;
    ctx.save();
    ctx.font = `600 ${size}px ui-monospace, "Geist Mono", monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = `${size * 0.12}px`;

    const text = watermark.toUpperCase();
    const w = ctx.measureText(text).width;
    // Round to WHOLE pixels: fractional coordinates spread edges over two pixels,
    // making the badge look skewed/blurry, especially on dpr 1.25 screens.
    const bx = Math.round(width - pad - w - size * 0.7);
    const by = Math.round(height - pad - size * 1.5);

    ctx.globalAlpha = 0.42;
    ctx.fillStyle = '#000000';
    roundRect(ctx, bx, by, Math.round(w + size * 1.4), Math.round(size * 1.9), size * 0.5);
    ctx.fill();

    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, Math.round(width - pad - size * 0.7), Math.round(by + size * 1.32));
    ctx.restore();
  }

  /*
    SCENE TRANSITION: above everything, including the watermark.
    A true crossfade renders both scenes and blends them, requiring two full renders, which is
    expensive in browsers. Use a familiar cinematic dip to black for a simple, inexpensive
    transition.
  */
  if (transition && transition.kind !== 'cut' && transition.amount > 0.001) {
    ctx.save();
    if (transition.kind === 'fade') {
      ctx.globalAlpha = Math.min(1, transition.amount);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
    } else {
      // Slide: a black panel sweeps across the frame from left to right.
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width * Math.min(1, transition.amount), height);
    }
    ctx.restore();
  }

}

/**
 * Create the plane holding the overlay in front of the camera.
 * As a CHILD of the camera, it fills the screen regardless of camera direction and is unaffected
 * by scene rotations.
 */
export function makeOverlayMesh(texture: THREE.Texture) {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.renderOrder = 999;
  mesh.frustumCulled = false;
  return mesh;
}

/** Fit the plane exactly to the camera's field of view. */
export function fitOverlayToCamera(
  mesh: THREE.Mesh,
  camera: THREE.PerspectiveCamera,
  distance = 1,
) {
  const vFov = (camera.fov * Math.PI) / 180;
  const h = 2 * Math.tan(vFov / 2) * distance;
  mesh.scale.set(h * camera.aspect, h, 1);
  mesh.position.set(0, 0, -distance);
}

/**
 * COUNTER: scale each number in the text by `p`, preserving its format.
 * "10,000+" → "6,421+", "4.9" → "3.2", "1.250.000" → "801.230". A single separator type with all
 * three-digit groups means thousands; otherwise the last separator is decimal, with precision
 * preserved.
 */
export function countText(text: string, p: number): string {
  return text.replace(/\d+(?:[.,]\d+)*/g, (tok) => {
    const seps = tok.match(/[.,]/g) ?? [];
    const groups = tok.split(/[.,]/);
    let intDigits = tok;
    let decDigits = '';
    let decSep = '';
    let thouSep = '';
    if (seps.length && new Set(seps).size === 1 && groups.slice(1).every((g) => g.length === 3)) {
      thouSep = seps[0] ?? '';
      intDigits = groups.join('');
    } else if (seps.length) {
      decSep = seps[seps.length - 1] ?? '';
      const k = tok.lastIndexOf(decSep);
      decDigits = tok.slice(k + 1);
      const head = tok.slice(0, k);
      thouSep = head.match(/[.,]/)?.[0] ?? '';
      intDigits = head.replace(/[.,]/g, '');
    }
    const target = Number(intDigits + (decDigits ? '.' + decDigits : ''));
    const [ii, dd] = (target * Math.max(0, Math.min(1, p))).toFixed(decDigits.length).split('.');
    const grouped = thouSep ? ii.replace(/\B(?=(\d{3})+(?!\d))/g, thouSep) : ii;
    return dd !== undefined ? grouped + decSep + dd : grouped;
  });
}
