'use client';

/* eslint-disable @next/next/no-img-element -- Local file preview (object URL); nothing to optimize. */
import { useRef, useState } from 'react';
import { STORE_IMAGE_SIZES } from '@/config/exportSizes';

/**
 * Screenshot size checker. Read files only on this page; never upload them. Dimensions come from
 * config/exportSizes.ts, the same list as the export menu, rather than being hardcoded. Read PNG
 * alpha from the header (IHDR color type 4/6 or a tRNS chunk): stores still reject an
 * opaque-looking image with an alpha channel, which counting transparent pixels would miss.
 */

type Lang = 'en' | 'tr';
type Result = {
  name: string;
  url: string;
  w: number;
  h: number;
  format: 'png' | 'jpg' | 'webp' | 'other';
  alpha: boolean | null;
  /** Transparent pixel fraction (0–1) when an alpha channel exists. Stores also reject opaque RGBA PNGs; explain the distinction to users. */
  transparent: number | null;
  exact: string[];
  ratio: { label: string; w: number; h: number }[];
  play: { ok: boolean; why?: string };
};

const T = {
  en: {
    drop: 'Drop screenshots here or click to choose',
    note: 'PNG or JPG. Checked in your browser — nothing is uploaded.',
    size: 'Size',
    exact: 'Exact match',
    ratio: 'Same proportions as',
    scale: 'scale to',
    none: 'No store size mockup.best exports',
    play: 'Google Play',
    playOk: 'Accepted proportions and size',
    alpha: 'Alpha channel',
    alphaYes: 'Yes — the stores reject transparency; re-export without alpha',
    alphaOpaque: 'Yes, but no pixel is transparent — the stores still reject the channel; re-save as RGB',
    alphaPart: (pct: string) => `Yes — ${pct} of the pixels are transparent; re-export without alpha`,
    alphaNo: 'No',
    format: 'Format',
    formatBad: 'The App Store and Google Play take PNG or JPG',
    clear: 'Clear',
    tooSmall: 'a side is under 320 px',
    tooBig: 'a side is over 3840 px',
    tooLong: 'the long side is more than twice the short side',
  },
  tr: {
    drop: 'Ekran görüntülerini buraya bırak ya da seçmek için tıkla',
    note: 'PNG veya JPG. Tarayıcında kontrol edilir — hiçbir şey yüklenmez.',
    size: 'Ölçü',
    exact: 'Tam eşleşme',
    ratio: 'Aynı oranda',
    scale: 'ölçekle:',
    none: 'mockup.best’in indirdiği bir mağaza ölçüsü yok',
    play: 'Google Play',
    playOk: 'Oran ve ölçü kabul edilir',
    alpha: 'Alfa kanalı',
    alphaYes: 'Var — mağazalar şeffaflığı reddeder; alfasız yeniden indir',
    alphaOpaque: 'Var ama hiç şeffaf piksel yok — mağazalar kanalı yine reddeder; RGB olarak yeniden kaydet',
    alphaPart: (pct: string) => `Var — piksellerin ${pct}’i şeffaf; alfasız yeniden indir`,
    alphaNo: 'Yok',
    format: 'Biçim',
    formatBad: 'App Store ve Google Play PNG veya JPG alıyor',
    clear: 'Temizle',
    tooSmall: 'bir kenar 320 px’ten küçük',
    tooBig: 'bir kenar 3840 px’ten büyük',
    tooLong: 'uzun kenar kısa kenarın iki katından fazla',
  },
};

/** PNG header alpha: color type 4 (gray+alpha) / 6 (RGBA), or tRNS before IDAT. */
function pngHasAlpha(buf: ArrayBuffer): boolean | null {
  const b = new Uint8Array(buf);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || !sig.every((v, i) => b[i] === v)) return null;
  const colorType = b[25];
  if (colorType === 4 || colorType === 6) return true;
  // Walk chunks: length (4), type (4), data, CRC (4).
  let off = 8;
  const dv = new DataView(buf);
  while (off + 8 <= b.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
    if (type === 'tRNS') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    off += 12 + len;
  }
  return false;
}

function formatOf(file: File, b: Uint8Array): Result['format'] {
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return /\.png$/i.test(file.name) ? 'png' : /\.jpe?g$/i.test(file.name) ? 'jpg' : 'other';
}

async function check(file: File, t: (typeof T)['en']): Promise<Result> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 16));
  const format = formatOf(file, head);
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const exact = STORE_IMAGE_SIZES.filter((s) => s.w === w && s.h === h).map((s) => s.label);
  const ratio = exact.length
    ? []
    : STORE_IMAGE_SIZES.filter((s) => Math.abs(s.w / s.h - w / h) / (s.w / s.h) < 0.005).map((s) => ({ label: s.label, w: s.w, h: s.h }));
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  const play =
    short < 320 ? { ok: false, why: t.tooSmall } : long > 3840 ? { ok: false, why: t.tooBig } : long > short * 2 ? { ok: false, why: t.tooLong } : { ok: true };
  const alpha = format === 'png' ? pngHasAlpha(buf) : format === 'jpg' ? false : null;
  let transparent: number | null = null;
  if (alpha) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) n += 1;
    transparent = n / (w * h);
  }
  return { name: file.name, url, w, h, format, alpha, transparent, exact, ratio, play };
}

export function SizeChecker({ lang, fixHref }: { lang: Lang; fixHref: string }) {
  const t = T[lang];
  const [results, setResults] = useState<Result[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const add = async (files: File[]) => {
    const out: Result[] = [];
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        out.push(await check(f, t));
      } catch {
        // Undecodable file: silently skip it as a non-image.
      }
    }
    setResults((r) => [...out, ...r]);
  };

  return (
    <div className="lp-checker-tool" data-size-checker>
      <button
        type="button"
        className={`lp-drop${over ? ' is-over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add(Array.from(e.dataTransfer.files ?? []));
        }}
      >
        <span className="lp-drop__title">{t.drop}</span>
        <span className="lp-drop__note">{t.note}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          void add(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      {results.length ? (
        <>
          <ul className="lp-check-list">
            {results.map((r) => {
              const pass = r.exact.length > 0 && r.alpha === false && (r.format === 'png' || r.format === 'jpg');
              return (
                <li key={r.url} className={`lp-check${pass ? ' is-pass' : ''}`} data-check-file={r.name}>
                  <img src={r.url} alt="" className="lp-check__thumb" />
                  <div className="lp-check__body">
                    <p className="lp-check__name">{r.name}</p>
                    <dl className="lp-rows">
                      <div className="lp-row">
                        <dt className="lp-row__label">{t.size}</dt>
                        <dd className="lp-row__value">
                          <span className="lp-num" data-check-size>
                            {r.w} × {r.h}
                          </span>
                        </dd>
                      </div>
                      <div className="lp-row">
                        <dt className="lp-row__label">{r.exact.length ? t.exact : r.ratio.length ? t.ratio : t.exact}</dt>
                        <dd className="lp-row__value" data-check-match>
                          {r.exact.length
                            ? r.exact.join(' · ')
                            : r.ratio.length
                              ? r.ratio.map((x) => `${x.label} (${t.scale} ${x.w}×${x.h})`).join(' · ')
                              : t.none}
                        </dd>
                      </div>
                      <div className="lp-row">
                        <dt className="lp-row__label">{t.play}</dt>
                        <dd className="lp-row__value" data-check-play>{r.play.ok ? t.playOk : `✕ ${r.play.why}`}</dd>
                      </div>
                      <div className="lp-row">
                        <dt className="lp-row__label">{t.alpha}</dt>
                        <dd className="lp-row__value" data-check-alpha>{r.alpha === null
                            ? '—'
                            : !r.alpha
                              ? t.alphaNo
                              : r.transparent === 0
                                ? `✕ ${t.alphaOpaque}`
                                : r.transparent !== null
                                  ? `✕ ${t.alphaPart(`${Math.max(0.1, Math.round(r.transparent * 1000) / 10)}%`)}`
                                  : `✕ ${t.alphaYes}`}</dd>
                      </div>
                      {r.format !== 'png' && r.format !== 'jpg' ? (
                        <div className="lp-row">
                          <dt className="lp-row__label">{t.format}</dt>
                          <dd className="lp-row__value">✕ {t.formatBad}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="lp-check-actions">
            <a className="lp-btn lp-btn--md" href={fixHref} data-umami-event="checker_fix">
              {lang === 'tr' ? 'Editörde doğru ölçüde kur' : 'Rebuild in the editor'} <span className="lp-btn__arrow" aria-hidden="true">→</span>
            </a>
            <button type="button" className="lp-link" onClick={() => setResults([])}>
              {t.clear}
            </button>
          </p>
        </>
      ) : null}
    </div>
  );
}
