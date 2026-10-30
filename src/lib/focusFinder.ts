/**
 * FOCUS FINDER: where should the camera look on a screenshot?
 *
 * Runs on the device, on pixels only (no model download, nothing leaves the browser).
 * 1. The screenshot is downscaled; strong local contrast marks "ink" (text, icons, chart lines,
 *    photo texture, edges of cards and buttons).
 * 2. Ink is joined sideways into ITEMS: a text line, an icon, a button outline, a photo.
 * 3. Each item is scored for what tends to matter in app UI:
 *    big type (headlines, balances, prices), visuals (photos, charts), colour (accent buttons, tags),
 *    filled shapes that stand out (dark/coloured buttons, cards). Status bars, navigation bars and
 *    small icons are discounted.
 * 4. The best items become ANCHORS; each gathers its close neighbours (a title's subtitle, a price
 *    beside a name) into one focus area. Areas get breathing room and a minimum size so the camera
 *    frames context instead of magnifying a word.
 * Returns fractions of the image (x right, y down) in reading order. Auto-motion turns them into
 * camera moves.
 */

/** What a focus area mainly is; `number` comes from reading the text (OCR). */
export type FocusKind = 'text' | 'number' | 'button' | 'visual';
type Box = { x0: number; y0: number; x1: number; y1: number };
/**
 * A focus area in image fractions: `x0..y1` frames it with context; `content` is the tight box of its
 * main item (for highlights and soft focus).
 */
export type FocusRegion = Box & { score: number; kind: FocusKind; content: Box; label?: string; conf?: number };

/** A scored candidate in analysis pixels. Reading the text (OCR) may refine `kind`, `score`, `label`. */
export type FocusItem = Box & {
  score: number;
  text: boolean;
  kind: FocusKind;
  label?: string;
  conf?: number;
  /** For a merged row: the tight box of its main (strongest) item, in analysis pixels. */
  main?: Box;
};
type Item = FocusItem;
/** Result of the pixel pass: candidates on the visible part, before grouping. */
export type FocusScan = { items: FocusItem[]; W: number; H: number; visible: Box };

const ANALYSIS_PX = 320 * 700;

/** Downscale an image source into analysis pixels. Returns null if the source cannot be read. */
export function analysisPixels(src: CanvasImageSource, w: number, h: number): ImageData | null {
  if (!w || !h) return null;
  /*
    Same pixel budget for every shape (a phone capture is 320 × ~700): a fixed width left desktop
    captures at 320 × 200, where the gaps between photo tiles closed and the grid became one block.
  */
  const W = Math.min(Math.round(w), Math.round(Math.sqrt(ANALYSIS_PX * (w / h))));
  const H = Math.max(1, Math.round((h / w) * W));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  try {
    g.drawImage(src, 0, 0, W, H);
    return g.getImageData(0, 0, W, H);
  } catch {
    return null;
  }
}

/** Box dilation by running count, separable: `rx` columns and `ry` rows on each side. */
function dilate(src: Uint8Array, W: number, H: number, rx: number, ry: number): Uint8Array {
  const tmp = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = -rx; x < W + rx; x++) {
      const add = x + rx < W && x + rx >= 0 ? src[y * W + x + rx] : 0;
      const sub = x - rx - 1 >= 0 && x - rx - 1 < W ? src[y * W + x - rx - 1] : 0;
      run += add - sub;
      if (x >= 0 && x < W) tmp[y * W + x] = run > 0 ? 1 : 0;
    }
  }
  if (!ry) return tmp;
  const out = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = -ry; y < H + ry; y++) {
      const add = y + ry < H && y + ry >= 0 ? tmp[(y + ry) * W + x] : 0;
      const sub = y - ry - 1 >= 0 && y - ry - 1 < H ? tmp[(y - ry - 1) * W + x] : 0;
      run += add - sub;
      if (y >= 0 && y < H) out[y * W + x] = run > 0 ? 1 : 0;
    }
  }
  return out;
}

/** Summed-area table: O(1) sums over any box. */
function integral(src: ArrayLike<number>, W: number, H: number): Float64Array {
  const s = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += src[y * W + x];
      s[(y + 1) * (W + 1) + x + 1] = s[y * (W + 1) + x + 1] + row;
    }
  }
  return s;
}
function boxSum(s: Float64Array, W: number, x0: number, y0: number, x1: number, y1: number): number {
  const w = W + 1;
  return s[y1 * w + x1] - s[y0 * w + x1] - s[y1 * w + x0] + s[y0 * w + x0];
}

/** Bounding boxes of connected pixels in `mask`. */
function boxes(mask: Uint8Array, W: number, H: number): { x0: number; y0: number; x1: number; y1: number }[] {
  const seen = new Uint8Array(W * H);
  const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!mask[start] || seen[start]) continue;
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W;
      const y = (i / W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const visit = (j: number) => {
        if (mask[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < W - 1) visit(i + 1);
      if (y > 0) visit(i - W);
      if (y < H - 1) visit(i + W);
    }
    out.push({ x0, y0, x1: x1 + 1, y1: y1 + 1 });
  }
  return out;
}

const iou = (a: FocusRegion, b: FocusRegion) => {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const i = ix * iy;
  const u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i;
  return u > 0 ? i / u : 0;
};
const c01 = (v: number) => Math.min(1, Math.max(0, v));

/** Per-item score breakdown of the last analysis (debugging and tuning only). */
export type FocusDebugItem = { x0: number; y0: number; x1: number; y1: number; score: number; parts: string };
let lastDebug: FocusDebugItem[] = [];
export function lastFocusItems(): FocusDebugItem[] {
  return lastDebug;
}

type Window = Box;

/**
 * Find up to `max` focus regions on a screenshot. `visible` (image fractions) is the part shown on the
 * device after cover crop, Crop top/bottom and Scroll; areas are chosen and kept inside it.
 */
export function findFocusRegions(img: ImageData, max = 3, visible: Window = { x0: 0, y0: 0, x1: 1, y1: 1 }): FocusRegion[] {
  return pickFocus(scanFocus(img, visible), max);
}

/** Pixel pass: scored candidates (text lines, buttons, visuals) on the visible part of the image. */
export function scanFocus(img: ImageData, visible: Window = { x0: 0, y0: 0, x1: 1, y1: 1 }): FocusScan {
  lastDebug = [];
  const { width: W, height: H, data } = img;
  const n = W * H;
  const gray = new Float32Array(n);
  const sat = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    const r = data[i * 4] * a + 255 * (1 - a);
    const g = data[i * 4 + 1] * a + 255 * (1 - a);
    const b = data[i * 4 + 2] * a + 255 * (1 - a);
    // Transparent pixels count as white background.
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    sat[i] = mx > 8 ? (mx - mn) / mx : 0;
  }

  // 1) Ink: local contrast above the image's own contrast level.
  const grad = new Float32Array(n);
  let sum = 0;
  let sum2 = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const m = Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + W] - gray[i - W]);
      grad[i] = m;
      sum += m;
      sum2 += m * m;
    }
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const T = Math.min(90, Math.max(22, mean + std));
  const tall = H / W > 1.6;
  const wide = W / H > 1.2;
  // Status bar and home indicator on phone captures carry no message.
  const top = Math.round(H * (tall ? 0.055 : 0.015));
  const bottom = Math.round(H * (tall ? 0.03 : 0.015));
  const ink = new Uint8Array(n);
  for (let y = top; y < H - bottom; y++) {
    for (let x = 2; x < W - 2; x++) if (grad[y * W + x] > T) ink[y * W + x] = 1;
  }

  // 2) Items: letters join into words and lines; a photo's texture joins into one block.
  const joined = dilate(ink, W, H, Math.max(2, Math.round(W * 0.016)), 1);
  const raw = boxes(joined, W, H);
  const inkI = integral(ink, W, H);
  const satI = integral(sat, W, H);
  const grayI = integral(gray, W, H);
  const meanOf = (s: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    boxSum(s, W, x0, y0, x1, y1) / Math.max(1, (x1 - x0) * (y1 - y0));

  const items: Item[] = [];
  /*
    3b) Visuals (photos, artwork, charts) from a separate "busy" map: moderate contrast almost
    everywhere inside, flat gaps around. Ink joining merges a photo grid into one block; busy tiles
    stay apart because the gaps between them are flat. A busy area covering a large part of the
    screen is a background photo, not a subject.
  */
  const Tv = 8 + 0.5 * mean;
  const busyRaw = new Uint8Array(n);
  for (let y = top; y < H - bottom; y++) {
    for (let x = 1; x < W - 1; x++) if (grad[y * W + x] > Tv) busyRaw[y * W + x] = 1;
  }
  const busy = dilate(busyRaw, W, H, 1, 1);
  const busyI = integral(busy, W, H);
  const rawI = integral(busyRaw, W, H);
  /*
    XY-cut: a grid of photos touching through captions, borders or a title becomes one busy block.
    Split a large block along full-length flat columns/rows (the gutters between tiles), recursively.
  */
  type Rect = { x0: number; y0: number; x1: number; y1: number };
  const cut = (r: Rect, depth: number, out: Rect[]) => {
    const minGap = 1;
    const sliver = Math.max(4, Math.round(W * 0.03));
    for (const axis of ['x', 'y'] as const) {
      const a0 = axis === 'x' ? r.x0 : r.y0;
      const a1 = axis === 'x' ? r.x1 : r.y1;
      const len = axis === 'x' ? r.y1 - r.y0 : r.x1 - r.x0;
      let gapStart = -1;
      for (let a = a0 + sliver; a < a1 - sliver; a++) {
        const s = axis === 'x' ? boxSum(rawI, W, a, r.y0, a + 1, r.y1) : boxSum(rawI, W, r.x0, a, r.x1, a + 1);
        const flat = s / Math.max(1, len) < 0.04;
        if (flat && gapStart < 0) gapStart = a;
        if (!flat && gapStart >= 0) {
          if (a - gapStart >= minGap && depth < 5) {
            const mid = (gapStart + a) >> 1;
            const first = axis === 'x' ? { ...r, x1: mid } : { ...r, y1: mid };
            const second = axis === 'x' ? { ...r, x0: mid } : { ...r, y0: mid };
            cut(first, depth + 1, out);
            cut(second, depth + 1, out);
            return;
          }
          gapStart = -1;
        }
      }
    }
    // Tighten to the busy pixels inside.
    let tx0 = r.x1, ty0 = r.y1, tx1 = r.x0, ty1 = r.y0;
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        if (!busyRaw[y * W + x]) continue;
        if (x < tx0) tx0 = x;
        if (x >= tx1) tx1 = x + 1;
        if (y < ty0) ty0 = y;
        if (y >= ty1) ty1 = y + 1;
      }
    }
    if (tx1 > tx0 && ty1 > ty0) out.push({ x0: tx0, y0: ty0, x1: tx1, y1: ty1 });
  };
  const tiles: Rect[] = [];
  const bgZones: Rect[] = [];
  for (const b of boxes(busy, W, H)) {
    if (((b.x1 - b.x0) * (b.y1 - b.y0)) / n > 0.12) cut(b, 0, tiles);
    else tiles.push(b);
  }
  for (const b of tiles) {
    const w = (b.x1 - b.x0) / W;
    const hh = (b.y1 - b.y0) / H;
    const area = w * hh;
    const ratio = (b.x1 - b.x0) / Math.max(1, b.y1 - b.y0);
    const fillB = meanOf(busyI, b.x0, b.y0, b.x1, b.y1);
    const visual = c01(area / 0.06) * c01((fillB - 0.45) / 0.35);
    // Edge to edge and most of the screen: a photo behind the UI, remembered as background.
    const backdrop = area > 0.45 && w > 0.85 && fillB > 0.5;
    if (backdrop) bgZones.push(b);
    const reject = area < 0.012 ? 'small' : backdrop || area > 0.5 ? 'large' : ratio > 6 || ratio < 0.18 ? 'ratio' : visual < 0.2 ? 'weak' : '';
    if (reject) {
      if (area >= 0.005) lastDebug.push({ x0: b.x0 / W, y0: b.y0 / H, x1: b.x1 / W, y1: b.y1 / H, score: 0.16, parts: `busy-${reject} f${fillB.toFixed(2)} a${area.toFixed(2)}` });
      continue;
    }
    const cy = (b.y0 + b.y1) / 2 / H;
    let score = 0.95 * visual + 0.12 * c01(Math.sqrt(area / 0.05));
    if (tall && (cy < 0.1 || cy > 0.9)) score *= 0.4;
    lastDebug.push({ x0: b.x0 / W, y0: b.y0 / H, x1: b.x1 / W, y1: b.y1 / H, score, parts: `VISUAL f${fillB.toFixed(2)}` });
    items.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, score, text: false, kind: 'visual' });
  }

  // 3) Score ink items. Inside a background photo only real text and flat buttons count.
  const inBackground = (x: number, y: number) => bgZones.some((z) => x >= z.x0 && x < z.x1 && y >= z.y0 && y < z.y1);
  for (const b of raw) {
    const w = (b.x1 - b.x0) / W;
    const h = (b.y1 - b.y0) / W; // height in screen widths: type size for lines
    const area = ((b.x1 - b.x0) * (b.y1 - b.y0)) / n;
    if (area < 0.0004 || area > 0.6) continue;
    const density = meanOf(inkI, b.x0, b.y0, b.x1, b.y1);
    const colour = meanOf(satI, b.x0, b.y0, b.x1, b.y1);
    // Fill contrast: how much the inside differs from a ring around it (buttons, cards, chips).
    const pad = Math.max(2, Math.round(W * 0.012));
    const ox0 = Math.max(0, b.x0 - pad);
    const oy0 = Math.max(0, b.y0 - pad);
    const ox1 = Math.min(W, b.x1 + pad);
    const oy1 = Math.min(H, b.y1 + pad);
    const inner = meanOf(grayI, b.x0, b.y0, b.x1, b.y1);
    const outerSum = boxSum(grayI, W, ox0, oy0, ox1, oy1) - boxSum(grayI, W, b.x0, b.y0, b.x1, b.y1);
    const outerN = (ox1 - ox0) * (oy1 - oy0) - (b.x1 - b.x0) * (b.y1 - b.y0);
    const fill = outerN > 0 ? Math.abs(inner - outerSum / outerN) / 255 : 0;

    /*
      Text test by stroke pattern, not box shape. A text row crosses many letter strokes; icons, colour
      strips and solid buttons cross few. Type size is the tallest run of such rows, not the box
      height: a title with its subtitle (or an icon beside two lines) would otherwise look huge.
    */
    const bw = b.x1 - b.x0;
    let trans = 0;
    let inkRows = 0;
    let run = 0;
    let typeRows = 0;
    const hist = new Uint32Array(16);
    for (let y = b.y0; y < b.y1; y++) {
      let t = 0;
      let prev = 0;
      for (let x = b.x0; x < b.x1; x++) {
        const v = ink[y * W + x];
        if (v && !prev) t++;
        prev = v;
        hist[Math.min(15, gray[y * W + x] >> 4)]++;
      }
      if (t) {
        inkRows++;
        trans += t;
      }
      run = t >= 5 ? run + 1 : 0;
      if (run > typeRows) typeRows = run;
    }
    const strokeRate = trans / Math.max(1, inkRows) / Math.max(1, bw);
    // Fill uniformity: share of the most common grey level (buttons and cards are one flat fill).
    let top1 = 0;
    for (const c of hist) if (c > top1) top1 = c;
    const uniform = top1 / Math.max(1, bw * (b.y1 - b.y0));
    // Text sits on a flat ground; rock and foliage texture has many strokes but no flat ground.
    const isText = strokeRate >= 0.07 && density >= 0.12 && h < 0.22 && uniform >= 0.3;
    const bigType = isText ? c01((typeRows / W - 0.028) / 0.045) : 0;
    // Ink blocks that are mostly texture; photos proper come from the busy map (3b).
    const visual = 0.6 * c01(area / 0.05) * c01(density / 0.08) * (1 - 0.6 * uniform);
    // Colour of flat UI (buttons, tags, swatches), not of a sunset photo.
    const accent = c01(colour / 0.5) * c01(area / 0.012) * c01(uniform / 0.3);
    const shape = c01(fill / 0.3) * c01(w / 0.45) * c01(uniform / 0.45);
    const cx = (b.x0 + b.x1) / 2 / W;
    const cy = (b.y0 + b.y1) / 2 / H;
    const bg = inBackground((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    if (bg && !isText && shape < 0.5) continue;
    let score = bg
      ? Math.max(bigType, 0.75 * shape) + 0.08 * c01(Math.sqrt(area / 0.05))
      : Math.max(bigType, 0.9 * visual, 0.7 * accent, 0.75 * shape) + 0.12 * c01(Math.sqrt(area / 0.05));

    const icon = w < 0.1 && h < 0.1 && bigType < 0.5;
    if (icon) score *= 0.35;
    if (tall) {
      // Top bar: back/menu/cart icons, logos, small titles. Only a wide large title survives.
      if (cy < 0.12 && !(bigType >= 0.7 && w >= 0.3)) score *= 0.4;
      // Tab bar: rows of icons, labels, thumbnails. A real button there (Add to bag) is one flat fill.
      if (cy > 0.86 && !(shape >= 0.5 && uniform >= 0.45)) score *= 0.25;
    } else if (wide) {
      // Desktop chrome: top bar and a narrow left sidebar.
      if (cy < 0.08) score *= 0.4;
      if (cx < 0.2 && w < 0.2) score *= 0.4;
    }
    lastDebug.push({
      x0: b.x0 / W,
      y0: b.y0 / H,
      x1: b.x1 / W,
      y1: b.y1 / H,
      score,
      parts: `t${bigType.toFixed(1)} v${visual.toFixed(1)} a${accent.toFixed(1)} s${shape.toFixed(1)} r${strokeRate.toFixed(2)} u${uniform.toFixed(1)}`,
    });
    // A flat filled shape of button proportions (Add to bag, Continue), even with its label inside;
    // tested first, or the label made every button a text line. OCR may confirm it.
    const button = shape >= 0.5 && uniform >= 0.45 && w >= 0.25 && h >= 0.035 && h <= 0.22;
    const text = !button && isText && visual < 0.5;
    const kind: FocusKind = button ? 'button' : text ? 'text' : visual >= 0.5 ? 'visual' : 'text';
    if (score > 0.08) items.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, score, text, kind });
  }

  // Only what is on the visible part of the screen.
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const cx = (it.x0 + it.x1) / 2 / W;
    const cy = (it.y0 + it.y1) / 2 / H;
    if (cx < visible.x0 || cx > visible.x1 || cy < visible.y0 || cy > visible.y1) items.splice(i, 1);
  }
  return { items, W, H, visible };
}

/** Grouping and selection: the best anchors gather their subtitles and prices into focus areas. */
export function pickFocus(scan: FocusScan, max = 3): FocusRegion[] {
  const { W, H, visible } = scan;
  const n = W * H;
  /*
    Rows first: text on the same line (a product name and its price, a value and its label, a row of
    stats) becomes one item. Otherwise a strong price anchored its own small area, the title's area
    could not take it, and the price was then dropped as too close to the title.
  */
  const items: Item[] = [];
  const text = scan.items.filter((it) => it.text).sort((a, b) => b.score - a.score);
  const taken = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    if (taken[i]) continue;
    taken[i] = 1;
    // The row keeps its main item's identity: kind, read label and tight box (a price stays a price).
    const head = text[i];
    const row: Item = { ...head, main: head.main ?? { x0: head.x0, y0: head.y0, x1: head.x1, y1: head.y1 } };
    for (let grew = true; grew; ) {
      grew = false;
      for (let j = 0; j < text.length; j++) {
        if (taken[j]) continue;
        const o = text[j];
        const overlap = Math.min(o.y1, row.y1) - Math.max(o.y0, row.y0);
        const gapX = Math.max(0, Math.max(o.x0 - row.x1, row.x0 - o.x1));
        if (overlap <= 0.5 * Math.min(o.y1 - o.y0, row.y1 - row.y0) || gapX > W * 0.45) continue;
        Object.assign(row, { x0: Math.min(row.x0, o.x0), y0: Math.min(row.y0, o.y0), x1: Math.max(row.x1, o.x1), y1: Math.max(row.y1, o.y1) });
        row.score += 0.05 * o.score;
        taken[j] = 1;
        grew = true;
      }
    }
    items.push(row);
  }
  for (const it of scan.items) if (!it.text) items.push({ ...it });
  // 4) Anchors gather close neighbours into focus areas (title + subtitle, name + price).
  items.sort((a, b) => b.score - a.score);
  const used = new Uint8Array(items.length);
  const groups: (Item & { content: Box })[] = [];
  for (let i = 0; i < items.length && groups.length < max * 3; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const a = items[i];
    const mb = a.main ?? a;
    const g = { ...a, content: { x0: mb.x0 / W, y0: mb.y0 / H, x1: mb.x1 / W, y1: mb.y1 / H } };
    const unit = Math.max(items[i].y1 - items[i].y0, W * 0.04);
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < items.length; j++) {
        // Gather text only (subtitle, price, label): two photos or two cards stay separate areas.
        if (used[j] || !items[j].text) continue;
        const o = items[j];
        const gapY = Math.max(0, Math.max(o.y0 - g.y1, g.y0 - o.y1));
        const gapX = Math.max(0, Math.max(o.x0 - g.x1, g.x0 - o.x1));
        // Same row (a price beside a product name, a value beside its label) joins from further away.
        const overlapY = Math.min(o.y1, a.y1) - Math.max(o.y0, a.y0);
        const sameRow = overlapY > 0.5 * Math.min(o.y1 - o.y0, a.y1 - a.y0);
        if (gapY > unit * 1.1 || gapX > W * (sameRow ? 0.45 : 0.06)) continue;
        const nx0 = Math.min(g.x0, o.x0);
        const ny0 = Math.min(g.y0, o.y0);
        const nx1 = Math.max(g.x1, o.x1);
        const ny1 = Math.max(g.y1, o.y1);
        // Keep areas focused: stop growing past about a sixth of the screen.
        if (((nx1 - nx0) * (ny1 - ny0)) / n > 0.16) continue;
        Object.assign(g, { x0: nx0, y0: ny0, x1: nx1, y1: ny1 });
        g.score += o.score * 0.05;
        used[j] = 1;
      }
    }
    groups.push(g);
  }

  // 5) Breathing room + minimum size, then the best areas spread apart, in reading order.
  const minW = 0.36;
  const minH = Math.min(0.5, minW * (W / H) * 0.6);
  const areas: FocusRegion[] = groups
    .map((g) => {
      const x0 = g.x0 / W;
      const y0 = g.y0 / H;
      const x1 = g.x1 / W;
      const y1 = g.y1 / H;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      // Grow, but stay inside the visible window.
      const pw = Math.min((visible.x1 - visible.x0) / 2, Math.max(minW, (x1 - x0) * 1.2) / 2);
      const ph = Math.min((visible.y1 - visible.y0) / 2, Math.max(minH, (y1 - y0) * 1.3) / 2);
      const ax0 = Math.max(visible.x0, Math.min(visible.x1 - 2 * pw, cx - pw));
      const ay0 = Math.max(visible.y0, Math.min(visible.y1 - 2 * ph, cy - ph));
      return {
        x0: ax0,
        y0: ay0,
        x1: Math.min(visible.x1, ax0 + 2 * pw),
        y1: Math.min(visible.y1, ay0 + 2 * ph),
        score: g.score,
        kind: g.kind,
        content: g.content,
        label: g.label,
        conf: g.conf,
      };
    })
    .sort((a, b) => b.score - a.score);
  const picked: FocusRegion[] = [];
  for (const r of areas) {
    // Fewer good areas beat padding the tour with weak ones (a tab bar, a stray patch).
    if (picked.length >= max || r.score < 0.25) break;
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const near = picked.some(
      (p) => iou(p, r) > 0.3 || Math.hypot((p.x0 + p.x1) / 2 - cx, ((p.y0 + p.y1) / 2 - cy) * (H / W)) < 0.16,
    );
    if (!near) picked.push(r);
  }
  return picked.sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1) || a.x0 - b.x0);
}
