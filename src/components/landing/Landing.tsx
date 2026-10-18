/* eslint-disable @next/next/no-img-element -- static export (images.unoptimized): images are prepared manually as WebP with width/height; next/image adds no optimization here. */
import './landing.css';
import { BRAND } from '@/config/brand';
import { CONTACT_EMAIL, LEGAL } from '@/config/legal';
import { FORWARD_SCRIPT } from './forward';
import type { LandingCopy } from './copy';
import { UseCards } from './UsePage';

/**
 * LANDING PAGE at the root URL. Server component, readable without JS.
 * Its visual structure comes from the product: section labels match editor panel headings (SOURCE
 * / MOCKUP / CAMERA / EXPORT), features use panel-style rows (label left · value right), and a
 * timeline ruler sits beneath the hero video. All visuals are actual product output, without
 * drawn UI frames.
 */

const EDITOR = '/editor/';
// Hero video scene order; the video starts at 12 seconds.
const SCENES = ['Color Hunt', 'Forma', 'Wander', 'Aura', 'Lumen'];
const SCENE_SEC = 4;

/*
  Returning users see "Continue" when autosave contains a project. An inline script needs no
  hydration; otherwise the button stays hidden, also correct without JS.
*/
const RESUME_SCRIPT = `(function(){try{if(localStorage.getItem('mockuptop:autosave:v1')){var e=document.querySelectorAll('[data-lp-resume]');for(var i=0;i<e.length;i++)e[i].hidden=false;}}catch(_){}})();`;
/* With reduced motion enabled, keep the poster instead of playing video. */
const MOTION_SCRIPT = `(function(){var v=document.getElementById('lp-hero-video');if(!v)return;if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches){v.removeAttribute('autoplay');v.pause();v.hidden=true;}})();`;

function Stamp({ n, label }: { n: string; label: string }) {
  return (
    <div className="lp-stamp" aria-hidden="true">
      <span className="lp-stamp__n">{n}</span>
      {/* Keep panel names in English as in the editor to avoid locale-specific uppercasing on the Turkish page. */}
      <span className="lp-stamp__label" lang="en">
        {label}
      </span>
      <span className="lp-stamp__rule" />
    </div>
  );
}

function Rows({ rows }: { rows: { label: string; value: string; note?: string }[] }) {
  return (
    <dl className="lp-rows">
      {rows.map((r) => (
        <div className="lp-row" key={r.label}>
          <dt className="lp-row__label">{r.label}</dt>
          <dd className="lp-row__value">
            <span className="lp-num">{r.value}</span>
            {r.note ? <span className="lp-row__note">{r.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Cta({ label, place, size = 'md' }: { label: string; place: string; size?: 'md' | 'lg' }) {
  return (
    <a className={`lp-btn lp-btn--${size}`} href={EDITOR} data-umami-event="cta_open_editor" data-umami-event-place={place}>
      {label}
      <span className="lp-btn__arrow" aria-hidden="true">→</span>
    </a>
  );
}

export function Landing({ copy }: { copy: LandingCopy }) {
  const c = copy;
  const url = `${BRAND.siteUrl}${c.lang === 'en' ? '/' : '/tr/'}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${BRAND.siteUrl}/#website`,
        url: `${BRAND.siteUrl}/`,
        name: BRAND.name,
        inLanguage: c.lang,
      },
      {
        '@type': 'WebApplication',
        '@id': `${BRAND.siteUrl}/#app`,
        name: BRAND.name,
        url: `${BRAND.siteUrl}${EDITOR}`,
        description: c.meta.description,
        applicationCategory: 'DesignApplication',
        operatingSystem: 'Any (web browser)',
        browserRequirements: 'Requires WebGL 2. Video export uses WebCodecs.',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        image: `${BRAND.siteUrl}/lp/hero-poster.webp`,
        screenshot: `${BRAND.siteUrl}/lp/timeline.webp`,
        featureList: [
          ...c.store.sizes.map((s) => `${s.label}: ${s.value}`),
          ...c.exportSec.rows.map((r) => `${r[0]}: ${r[1]} (${r[2]})`),
          ...c.camera.moves.map((m) => `Camera move: ${m}`),
        ],
        publisher: { '@type': 'Organization', name: BRAND.name, url: `${BRAND.siteUrl}/` },
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        mainEntity: c.faq.items.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };

  return (
    <div className="lp" lang={c.lang}>
      <script dangerouslySetInnerHTML={{ __html: FORWARD_SCRIPT }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <a className="lp-skip" href="#lp-main">
        {c.lang === 'tr' ? 'İçeriğe geç' : 'Skip to content'}
      </a>

      <header className="lp-nav">
        <div className="lp-nav__inner">
          <a className="lp-wordmark" href={c.lang === 'en' ? '/' : '/tr/'} aria-label={`${BRAND.name} — home`}>
            {BRAND.name}
          </a>
          <nav className="lp-nav__links" aria-label={c.lang === 'tr' ? 'Sayfa bölümleri' : 'Page sections'}>
            {c.nav.links.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
          <div className="lp-nav__actions">
            <a
              className="lp-link lp-nav__resume"
              href={EDITOR}
              hidden
              data-lp-resume
              data-umami-event="cta_resume"
              data-umami-event-place="nav"
              // RESUME_SCRIPT removes `hidden` before hydration, following the theme-script pattern.
              suppressHydrationWarning
            >
              {c.nav.resume}
            </a>
            <a className="lp-btn lp-btn--sm" href={EDITOR} data-umami-event="cta_open_editor" data-umami-event-place="nav">
              {c.nav.open}
            </a>
          </div>
        </div>
      </header>
      <script dangerouslySetInnerHTML={{ __html: RESUME_SCRIPT }} />

      <main id="lp-main">
        {/* ── HERO ───────────────────────────────────────────── */}
        <section className="lp-hero lp-wrap" aria-labelledby="lp-h1">
          <div className="lp-hero__text">
            <p className="lp-eyebrow">{c.hero.eyebrow}</p>
            <h1 id="lp-h1" className="lp-h1">
              {c.hero.h1}
            </h1>
            <p className="lp-lede">{c.hero.lede}</p>
            <div className="lp-hero__actions">
              <Cta label={c.hero.cta} place="hero" size="lg" />
              <a className="lp-link" href="#export">
                {c.hero.secondary} <span aria-hidden="true">↓</span>
              </a>
            </div>
            <ul className="lp-trust" aria-label={c.lang === 'tr' ? 'Özet' : 'Summary'}>
              {c.hero.trust.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>

          <figure className="lp-hero__media">
            <div className="lp-stage lp-stage--hero">
              <img
                className="lp-stage__poster"
                src="/lp/hero-poster.webp"
                width={1280}
                height={720}
                alt=""
                fetchPriority="high"
              />
              <video
                id="lp-hero-video"
                className="lp-stage__video"
                width={1280}
                height={720}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                poster="/lp/hero-poster.webp"
                aria-label={c.hero.videoCaption}
              >
                <source src="/lp/hero.webm" type="video/webm" />
                <source src="/lp/hero.mp4" type="video/mp4" />
              </video>
            </div>
            <script dangerouslySetInnerHTML={{ __html: MOTION_SCRIPT }} />
            <div className="lp-ruler" aria-hidden="true">
              <span className="lp-ruler__label">{c.hero.rulerLabel}</span>
              <div className="lp-ruler__track">
                {SCENES.map((s, i) => (
                  <span key={s} className="lp-ruler__clip" style={{ ['--i' as string]: i }}>
                    <span className="lp-ruler__t">{i * SCENE_SEC}s</span>
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <figcaption className="lp-caption">
              <span className="lp-caption__k">{c.hero.videoLabel}</span>
              {c.hero.videoCaption}
            </figcaption>
          </figure>
        </section>

        {/* ── STEPS ──────────────────────────────────────────── */}
        <section className="lp-section lp-wrap" aria-labelledby="lp-steps">
          <Stamp n="01" label={c.steps.stamp} />
          <h2 id="lp-steps" className="lp-h2 lp-h2--narrow">
            {c.steps.h2}
          </h2>
          <ol className="lp-steps">
            {c.steps.items.map((s) => (
              <li key={s.tag} className="lp-step">
                <span className="lp-step__clip" lang="en">
                  {s.tag}
                </span>
                <h3 className="lp-h3">{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── WHAT ARE YOU MAKING? — links to use-case pages ── */}
        <section className="lp-section lp-wrap" aria-labelledby="lp-uses">
          <h2 id="lp-uses" className="lp-h2 lp-h2--narrow">
            {c.lang === 'tr' ? 'Ne yapıyorsun?' : 'What are you making?'}
          </h2>
          <UseCards lang={c.lang} />
        </section>

        {/* ── STORE KIT ──────────────────────────────────────── */}
        <section id="store" className="lp-section lp-wrap" aria-labelledby="lp-store">
          <Stamp n="02" label={c.store.stamp} />
          <div className="lp-split">
            <div className="lp-split__text">
              <h2 id="lp-store" className="lp-h2">
                {c.store.h2}
              </h2>
              <p className="lp-body">{c.store.body}</p>
              <h3 className="lp-mono-h">{c.store.sizesLabel}</h3>
              <Rows rows={c.store.sizes} />
              <div className="lp-note">
                <h3 className="lp-h3">{c.store.previewTitle}</h3>
                <p>{c.store.previewBody}</p>
              </div>
              <p className="lp-more">
                <a href={`${c.guideBase}app-store-screenshot-sizes.html`}>{c.guides.items[0].title}</a>
                <a href={`${c.guideBase}google-play-screenshot-sizes.html`}>{c.guides.items[1].title}</a>
              </p>
            </div>
            <div className="lp-split__media">
              <figure>
                <div className="lp-stage lp-stage--store">
                  <img src="/lp/store-set.webp" width={1430} height={480} alt={c.store.imageAlt} loading="lazy" decoding="async" />
                </div>
                <figcaption className="lp-caption">{c.store.imageCaption}</figcaption>
              </figure>
              <h3 className="lp-mono-h">{c.store.zipLabel}</h3>
              <pre className="lp-tree" aria-label={c.store.zipLabel}>{`${BRAND.fileSlug}-store-set.zip
├─ app-store/
│  ├─ iphone-6.9in-1290x2796/   01.png 02.png …
│  ├─ ipad-13in-2064x2752/      01.png 02.png …
│  └─ mac-2880x1800/            01.png 02.png …
└─ google-play/
   ├─ phone-1080x1920/          01.png 02.png …
   ├─ tablet-1440x2560/         01.png 02.png …
   └─ feature-graphic-1024x500.png`}</pre>
            </div>
          </div>
        </section>

        {/* ── CAMERA ─────────────────────────────────────────── */}
        <section id="camera" className="lp-section lp-wrap" aria-labelledby="lp-camera">
          <Stamp n="03" label={c.camera.stamp} />
          <h2 id="lp-camera" className="lp-h2 lp-h2--narrow">
            {c.camera.h2}
          </h2>
          <div className="lp-split lp-split--media-first">
            <figure className="lp-split__media">
              <div className="lp-shot">
                <img src="/lp/timeline.webp" width={1282} height={240} alt={c.camera.imageAlt} loading="lazy" decoding="async" />
              </div>
              <figcaption className="lp-caption">{c.camera.imageCaption}</figcaption>
            </figure>
            <div className="lp-split__text">
              <p className="lp-body">{c.camera.body}</p>
              <h3 className="lp-mono-h">{c.camera.movesLabel}</h3>
              <ul className="lp-chips" lang="en">
                {c.camera.moves.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <dl className="lp-points">
                {c.camera.points.map((p) => (
                  <div key={p.title}>
                    <dt>{p.title}</dt>
                    <dd>{p.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* ── MOCKUP / SCENE ─────────────────────────────────── */}
        <section className="lp-section lp-wrap" aria-labelledby="lp-mockup">
          <Stamp n="04" label={c.mockup.stamp} />
          <div className="lp-split">
            <div className="lp-split__text">
              <h2 id="lp-mockup" className="lp-h2">
                {c.mockup.h2}
              </h2>
              <p className="lp-body">{c.mockup.body}</p>
            </div>
            <Rows rows={c.mockup.rows} />
          </div>
          <figure className="lp-wide">
            <div className="lp-stage lp-stage--wide">
              <img src="/lp/devices.webp" width={1800} height={600} alt={c.mockup.imageAlt} loading="lazy" decoding="async" />
            </div>
            <figcaption className="lp-caption">{c.mockup.imageCaption}</figcaption>
          </figure>
        </section>

        {/* ── EXPORT ─────────────────────────────────────────── */}
        <section id="export" className="lp-section lp-wrap" aria-labelledby="lp-export">
          <Stamp n="05" label={c.exportSec.stamp} />
          <div className="lp-split">
            <div className="lp-split__text">
              <h2 id="lp-export" className="lp-h2">
                {c.exportSec.h2}
              </h2>
              <p className="lp-body">{c.exportSec.body}</p>
              <figure className="lp-alpha">
                <div className="lp-checker">
                  <img src="/lp/alpha.webp" width={600} height={600} alt={c.exportSec.alphaAlt} loading="lazy" decoding="async" />
                </div>
                <figcaption className="lp-caption">{c.exportSec.alphaCaption}</figcaption>
              </figure>
            </div>
            <div className="lp-table-wrap">
              <table className="lp-table">
                <thead>
                  <tr>
                    {c.exportSec.head.map((h) => (
                      <th key={h} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.exportSec.rows.map((r) => (
                    <tr key={r[0]}>
                      <th scope="row">{r[0]}</th>
                      <td>{r[1]}</td>
                      <td>{r[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── FREE ───────────────────────────────────────────── */}
        <section className="lp-section lp-wrap lp-free" aria-labelledby="lp-free">
          <Stamp n="06" label={c.free.stamp} />
          <div className="lp-split">
            <div className="lp-split__text">
              <h2 id="lp-free" className="lp-h2">
                {c.free.h2}
              </h2>
              <p className="lp-body">
                {c.free.body}{' '}
                <a className="lp-inline" href={LEGAL.terms}>
                  {c.footer.terms}
                </a>
              </p>
            </div>
            <ul className="lp-ticks">
              {c.free.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── COMPARE ────────────────────────────────────────── */}
        <section className="lp-section lp-wrap" aria-labelledby="lp-compare">
          <Stamp n="07" label={c.compare.stamp} />
          <h2 id="lp-compare" className="lp-h2 lp-h2--narrow">
            {c.compare.h2}
          </h2>
          <div className="lp-table-wrap">
            <table className="lp-table lp-table--compare">
              <caption>{c.compare.note}</caption>
              <thead>
                <tr>
                  {c.compare.head.map((h, i) => (
                    <th key={i} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.compare.rows.map((r) => (
                  <tr key={r[0]}>
                    <th scope="row">{r[0]}</th>
                    {r.slice(1).map((cell, i) => (
                      <td key={i} className={i === 0 ? 'lp-us' : undefined}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {c.compare.sources.length ? (
            <p className="lp-sources">
              {c.compare.sources.map((s) => (
                <a key={s.href} href={s.href} rel="noopener nofollow" target="_blank">
                  {s.label}
                </a>
              ))}
            </p>
          ) : null}
        </section>

        {/* ── FAQ ────────────────────────────────────────────── */}
        <section id="faq" className="lp-section lp-wrap" aria-labelledby="lp-faq">
          <Stamp n="08" label={c.faq.stamp} />
          <div className="lp-split">
            <h2 id="lp-faq" className="lp-h2">
              {c.faq.h2}
            </h2>
            <div className="lp-faq">
              {c.faq.items.map((f, i) => (
                <details key={f.q} open={i === 0}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── GUIDES ─────────────────────────────────────────── */}
        <section className="lp-section lp-wrap" aria-labelledby="lp-guides">
          <Stamp n="09" label={c.guides.stamp} />
          <div className="lp-split">
            <div className="lp-split__text">
              <h2 id="lp-guides" className="lp-h2">
                {c.guides.h2}
              </h2>
              <p className="lp-body">{c.guides.body}</p>
              <a className="lp-link" href={c.guideBase}>
                {c.guides.all} <span aria-hidden="true">→</span>
              </a>
            </div>
            <ul className="lp-guides">
              {c.guides.items.map((g) => (
                <li key={g.slug}>
                  <a href={`${c.guideBase}${g.slug}.html`}>{g.title}</a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── FINAL ──────────────────────────────────────────── */}
        <section className="lp-final" aria-labelledby="lp-final">
          <div className="lp-wrap lp-final__inner">
            <h2 id="lp-final" className="lp-h2">
              {c.final.h2}
            </h2>
            <p>{c.final.body}</p>
            <Cta label={c.final.cta} place="final" size="lg" />
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <p className="lp-footer__word" aria-hidden="true">
            {BRAND.name}
          </p>
          <p className="lp-footer__meta">
            <span>{c.footer.meta}</span>
            <a href={LEGAL.privacy}>{c.footer.privacy}</a>
            <a href={LEGAL.terms}>{c.footer.terms}</a>
            <a href={c.guideBase}>{c.footer.guides}</a>
            <a href={BRAND.sourceUrl} rel="noopener">
              {c.footer.source}
            </a>
            <a href={`mailto:${CONTACT_EMAIL}`}>{c.footer.contact}</a>
            <a href={c.footer.langSwitch.href} hrefLang={c.lang === 'en' ? 'tr' : 'en'}>
              {c.footer.langSwitch.label}
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
