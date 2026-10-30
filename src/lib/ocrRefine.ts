/**
 * TEXT PASS for Find focus areas: read the strongest text candidates and adjust what they are.
 *
 * Engine-agnostic: an engine is any `(canvas) => { text, conf }` reader running on the device. The
 * pass picks at most 12 candidates (pixel budget ~1 MP, time budget 3 s), crops them from the
 * full-resolution screen image with a small margin, reads them one by one and:
 *  - money, percentages and large standalone numbers become `number` areas and gain importance,
 *  - short call-to-action labels (Add to bag, Continue, Sign up …) become `button`,
 *  - times, dates, phone numbers and version strings lose importance (they are rarely the message).
 * What was read stays in memory only; it is never saved into the project.
 */

import type { FocusItem, FocusScan } from '@/lib/focusFinder';

export type OcrEngine = (crop: HTMLCanvasElement) => Promise<{ text: string; conf: number }>;

const MONEY = /[$€£₺¥₹]\s?\d|\d\s?[$€£₺¥₹]|\b(?:USD|EUR|GBP|TRY|TL)\b/i;
const PERCENT = /[+-]?\d+(?:[.,]\d+)?\s?%/;
const BIG_NUMBER = /^[+-−]?\s?\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?$|^[+-−]?\s?\d{3,}(?:[.,]\d+)?$/;
const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;
const DATE = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;
const PHONE = /\+?\d[\d\s().-]{8,}\d/;
const VERSION = /\bv?\d+\.\d+\.\d+\b/i;
const CTA = /\b(?:add to|buy|get|start|continue|sign ?up|log ?in|subscribe|download|install|book|try|join|order|checkout|check out|send|pay|shop|upgrade|next|done|save|apply|create)\b/i;

export type TextClass = { kind: 'number' | 'button' | 'text'; boost: number; scale: number };

/** Classify a read label. `boost` adds importance; `scale` multiplies it (penalties). */
export function classifyText(raw: string): TextClass {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return { kind: 'text', boost: 0, scale: 1 };
  const words = text.split(' ').length;
  const money = MONEY.test(text);
  if (!money && (TIME.test(text) || DATE.test(text) || PHONE.test(text) || VERSION.test(text))) {
    return { kind: 'text', boost: 0, scale: 0.6 };
  }
  // A short call to action stays a button even with its price inside ("Add to bag $129").
  if (words <= 6 && CTA.test(text)) return { kind: 'button', boost: 0.2, scale: 1 };
  if (money) return { kind: 'number', boost: 0.45, scale: 1 };
  if (PERCENT.test(text)) return { kind: 'number', boost: 0.35, scale: 1 };
  if (BIG_NUMBER.test(text)) return { kind: 'number', boost: 0.25, scale: 1 };
  return { kind: 'text', boost: 0, scale: 1 };
}

/** A readable number for a count-up caption: the exact label must survive (sign, currency, separators). */
export function countableLabel(label: string | undefined, conf: number | undefined): boolean {
  if (!label || (conf ?? 0) < 90) return false;
  const t = label.trim();
  // Only what reads as a number worth counting (money, percent, large value), not a size or a time.
  if (classifyText(t).kind !== 'number') return false;
  return /^[^\d\s-−]{0,3}\s?[+-−]?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d+)?\s?[%€£$₺¥₹]?$/.test(t);
}

const MAX_CANDIDATES = 12;
const PIXEL_BUDGET = 1_000_000;
const TIME_BUDGET_MS = 3000;

/** Candidates worth reading: text lines and buttons, strongest first, inside the pixel budget. */
export function pickCandidates(scan: FocusScan, size: { w: number; h: number }): FocusItem[] {
  const sx = size.w / scan.W;
  const sy = size.h / scan.H;
  const out: FocusItem[] = [];
  let px = 0;
  const pool = scan.items.filter((it) => it.kind === 'text' || it.kind === 'button').sort((a, b) => b.score - a.score);
  for (const it of pool) {
    if (out.length >= MAX_CANDIDATES) break;
    const area = (it.x1 - it.x0) * sx * (it.y1 - it.y0) * sy * 1.3;
    if (px + area > PIXEL_BUDGET) continue;
    px += area;
    out.push(it);
  }
  return out;
}

/** Crop a candidate from the full-resolution source with a small margin; upscale tiny text for reading. */
function cropOf(src: CanvasImageSource, it: FocusItem, scan: FocusScan, size: { w: number; h: number }): HTMLCanvasElement {
  const sx = size.w / scan.W;
  const sy = size.h / scan.H;
  const m = 0.15 * (it.y1 - it.y0);
  const x0 = Math.max(0, (it.x0 - m) * sx);
  const y0 = Math.max(0, (it.y0 - m) * sy);
  const w = Math.min(size.w - x0, (it.x1 - it.x0 + 2 * m) * sx);
  const h = Math.min(size.h - y0, (it.y1 - it.y0 + 2 * m) * sy);
  const up = h < 32 ? 32 / Math.max(1, h) : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * up));
  c.height = Math.max(1, Math.round(h * up));
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, x0, y0, w, h, 0, 0, c.width, c.height);
  return c;
}

/** Build the text pass for an engine; plug it in with autoMotion.ts `setScanRefiner`. */
export function makeTextPass(engine: OcrEngine) {
  return async (scan: FocusScan, src: CanvasImageSource, size: { w: number; h: number }) => {
    /*
      A real total budget: a reader that never answers must not keep Find busy. When time is up the
      pass ends with what it has; an answer arriving later is ignored and changes nothing.
    */
    const deadline = performance.now() + TIME_BUDGET_MS;
    const TIMEOUT = Symbol('timeout');
    for (const it of pickCandidates(scan, size)) {
      const left = deadline - performance.now();
      if (left <= 0) break;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const res = await Promise.race([
        engine(cropOf(src, it, scan, size)).catch(() => null),
        new Promise<typeof TIMEOUT>((r) => {
          timer = setTimeout(() => r(TIMEOUT), left);
        }),
      ]);
      clearTimeout(timer);
      if (res === TIMEOUT) break;
      if (!res) continue;
      const { text, conf } = res;
      const label = text.replace(/\s+/g, ' ').trim();
      if (!label || conf < 50) continue;
      const k = classifyText(label);
      it.label = label;
      it.conf = conf;
      it.score = it.score * k.scale + k.boost;
      if (k.kind !== 'text') it.kind = k.kind;
      // A read button label stays a button; a number becomes a text item for grouping by row.
      if (k.kind === 'number') it.text = true;
    }
  };
}
