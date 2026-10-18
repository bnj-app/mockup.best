/* eslint-disable @next/next/no-img-element -- static export (images.unoptimized): images are manually prepared as WebP with width/height. */
import './landing.css';
import './uses.css';
import type { Metadata } from 'next';
import { BRAND } from '@/config/brand';
import { CONTACT_EMAIL, LEGAL } from '@/config/legal';
import { TEMPLATES } from '@/config/templates';
import { STORE_IMAGE_SIZES } from '@/config/exportSizes';
import { SizeChecker } from './SizeChecker';
import { TEMPLATE_NOTES, USE_CARDS, USE_ORDER, USE_PATHS, USE_UI, USES, type UseId, type UseLang } from './uses-copy';

/**
 * Use-case page template in the landing page style (landing.css): hero, real example, 3 steps,
 * outputs, FAQ, related links, and other use-case cards. Server component readable without JS; only
 * the size checker is client-side. Each page provides a distinct function: a deep link opening the
 * right pack, a gallery, or a working checker. Copy lives in uses-copy.ts.
 */

const ORIGIN = BRAND.siteUrl;

export function metaForUse(id: UseId, lang: UseLang): Metadata {
  const c = USES[lang][id];
  const p = USE_PATHS[id];
  return {
    title: { absolute: c.meta.title },
    description: c.meta.description,
    alternates: { canonical: c.path, languages: { en: p.en, tr: p.tr, 'x-default': p.en } },
    openGraph: {
      type: 'website',
      url: c.path,
      title: c.meta.title,
      description: c.meta.description,
      locale: lang === 'tr' ? 'tr_TR' : 'en_US',
      images: [{ url: c.meta.og, width: 1200, height: 630, alt: c.meta.ogAlt }],
    },
    twitter: { card: 'summary_large_image', title: c.meta.title, description: c.meta.description, images: [c.meta.og] },
  };
}

function Media({ id, lang }: { id: UseId; lang: UseLang }) {
  const ui = USE_UI[lang];
  if (id === 'app-store') {
    return (
      <figure className="lp-wide lp-use-figure">
        <img src="/uses/app-store-set.webp" width={1466} height={1000} alt={USES[lang][id].meta.ogAlt} loading="eager" />
        <figcaption className="lp-caption">{ui.exampleNote}</figcaption>
      </figure>
    );
  }
  if (id === 'promo') {
    return (
      <figure className="lp-wide lp-use-figure">
        <video
          className="lp-use-video"
          width={1280}
          height={720}
          poster="/uses/promo-poster.webp"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={USES[lang][id].meta.ogAlt}
        >
          <source src="/uses/promo.webm" type="video/webm" />
          <source src="/uses/promo.mp4" type="video/mp4" />
        </video>
        <figcaption className="lp-caption">{ui.exampleNote}</figcaption>
      </figure>
    );
  }
  if (id === 'portfolio') {
    return (
      <figure className="lp-wide lp-use-figure">
        <div className="lp-use-pair">
          <img src="/uses/portfolio-desktop.webp" width={1600} height={1200} alt={lang === 'tr' ? 'Laptop sahnesi' : 'Laptop scene'} loading="eager" />
          <img src="/uses/portfolio-duo.webp" width={1600} height={1200} alt={USES[lang][id].meta.ogAlt} />
        </div>
        <figcaption className="lp-caption">{ui.exampleNote}</figcaption>
      </figure>
    );
  }
  if (id === 'redact') {
    return (
      <figure className="lp-wide lp-use-figure">
        <div className="lp-use-pair lp-use-pair--tall">
          <div>
            <img src="/uses/redact-before.webp" width={900} height={1200} alt={`${ui.before}: e-mail and balance visible`} loading="eager" />
            <p className="lp-use-label">{ui.before}</p>
          </div>
          <div>
            <img src="/uses/redact-after.webp" width={900} height={1200} alt={`${ui.after}: e-mail and balance erased`} />
            <p className="lp-use-label">{ui.after}</p>
          </div>
        </div>
        <figcaption className="lp-caption">{ui.redactNote}</figcaption>
      </figure>
    );
  }
  if (id === 'templates') {
    return (
      <ul className="lp-tpl-grid">
        {TEMPLATES.map((t) => (
          <li key={t.id} className="lp-tpl-card">
            <img src={`/templates/${t.id}.webp`} width={420} height={264} alt={`${t.label} template`} loading="lazy" />
            <div className="lp-tpl-card__body">
              <h3 className="lp-h3">{t.label}</h3>
              <p>{TEMPLATE_NOTES[lang][t.id] ?? t.group}</p>
              <a className="lp-link" href={`/editor/?template=${t.id}`} data-umami-event="template_use" data-umami-event-id={t.id}>
                {ui.useTemplate} <span aria-hidden="true">→</span>
              </a>
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return <SizeChecker lang={lang} fixHref={USES[lang].checker.cta.href} />;
}

export function UsePage({ id, lang }: { id: UseId; lang: UseLang }) {
  const c = USES[lang][id];
  const ui = USE_UI[lang];
  const home = lang === 'tr' ? '/tr/' : '/';
  const other: UseLang = lang === 'tr' ? 'en' : 'tr';
  const guideBase = lang === 'tr' ? '/guide/tr/' : '/guide/en/';
  const url = `${ORIGIN}${c.path}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#page`,
        url,
        name: c.h1,
        description: c.meta.description,
        inLanguage: lang,
        isPartOf: { '@id': `${ORIGIN}/#website` },
        about: { '@id': `${ORIGIN}/#app` },
        primaryImageOfPage: `${ORIGIN}${c.meta.og}`,
        breadcrumb: { '@id': `${url}#crumbs` },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#crumbs`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: BRAND.name, item: `${ORIGIN}${home}` },
          { '@type': 'ListItem', position: 2, name: c.crumb, item: url },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        mainEntity: c.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
      },
    ],
  };

  return (
    <div className="lp" lang={lang}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <a className="lp-skip" href="#lp-main">
        {lang === 'tr' ? 'İçeriğe geç' : 'Skip to content'}
      </a>
      <header className="lp-nav">
        <div className="lp-nav__inner">
          <a className="lp-wordmark" href={home} aria-label={`${BRAND.name} — ${ui.home}`}>
            {BRAND.name}
          </a>
          <nav className="lp-nav__links" aria-label={lang === 'tr' ? 'Sayfalar' : 'Pages'}>
            <a href={USE_PATHS.templates[lang]}>{USE_CARDS[lang].templates.title}</a>
            <a href={USE_PATHS.checker[lang]}>{USE_CARDS[lang].checker.title}</a>
            <a href={guideBase}>{ui.guides}</a>
          </nav>
          <div className="lp-nav__actions">
            <a className="lp-btn lp-btn--sm" href="/editor/" data-umami-event="cta_open_editor" data-umami-event-place={`use-${id}-nav`}>
              {ui.editor}
            </a>
          </div>
        </div>
      </header>

      <main id="lp-main">
        <nav className="lp-wrap lp-crumbs" aria-label={lang === 'tr' ? 'Konum' : 'Breadcrumb'}>
          <a href={home}>{BRAND.name}</a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{c.crumb}</span>
        </nav>

        <section className="lp-hero lp-wrap lp-use-hero" aria-labelledby="lp-h1">
          <div className="lp-hero__text">
            <p className="lp-eyebrow">{c.eyebrow}</p>
            <h1 id="lp-h1" className="lp-h1">
              {c.h1}
            </h1>
            <p className="lp-lede">{c.lede}</p>
            {id !== 'checker' ? (
              <p className="lp-use-cta">
                <a className="lp-btn lp-btn--lg" href={c.cta.href} data-umami-event="use_cta" data-umami-event-page={id}>
                  {c.cta.label}
                  <span className="lp-btn__arrow" aria-hidden="true">→</span>
                </a>
              </p>
            ) : null}
            <p className="lp-use-privacy">{c.privacy}</p>
          </div>
        </section>

        <section className="lp-section lp-wrap lp-use-media" aria-label={c.crumb}>
          <Media id={id} lang={lang} />
        </section>

        {id === 'app-store' ? (
          <section className="lp-section lp-wrap" aria-labelledby="lp-sizes">
            <h2 id="lp-sizes" className="lp-h2 lp-h2--narrow">
              {ui.sizes}
            </h2>
            <dl className="lp-rows lp-use-sizes">
              {/* Store set ZIP contents: entries with folders plus the feature graphic (one frame from the active scene). */}
              {STORE_IMAGE_SIZES.filter((s) => s.folder || s.id === 'gp-feature').map((s) => (
                <div className="lp-row" key={s.id}>
                  <dt className="lp-row__label">{s.label.split(' — ')[0]}</dt>
                  <dd className="lp-row__value">
                    <span className="lp-num">
                      {s.w} × {s.h}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <section className="lp-section lp-wrap" aria-labelledby="lp-how">
          <h2 id="lp-how" className="lp-h2 lp-h2--narrow">
            {ui.how}
          </h2>
          <ol className="lp-steps lp-steps--3">
            {c.steps.map((s, i) => (
              <li key={s.title} className="lp-step">
                <span className="lp-step__clip">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="lp-h3">{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-section lp-wrap" aria-labelledby="lp-gets">
          <div className="lp-split">
            <h2 id="lp-gets" className="lp-h2">
              {c.gets.h2}
            </h2>
            <ul className="lp-ticks lp-use-ticks">
              {c.gets.items.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>
          {c.notes ? (
            <div className="lp-split lp-use-notes">
              <h2 className="lp-h2 lp-h2--small">{c.notes.h2}</h2>
              <ul className="lp-use-notes__list">
                {c.notes.items.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section id="faq" className="lp-section lp-wrap" aria-labelledby="lp-faq">
          <div className="lp-split">
            <h2 id="lp-faq" className="lp-h2">
              {ui.faq}
            </h2>
            <div className="lp-faq">
              {c.faq.map((f, i) => (
                <details key={f.q} open={i === 0}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section lp-wrap" aria-labelledby="lp-related">
          <div className="lp-split">
            <h2 id="lp-related" className="lp-h2">
              {ui.related}
            </h2>
            <ul className="lp-guides">
              {c.related.map((r) => (
                <li key={r.href}>
                  <a href={r.href}>{r.label}</a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section lp-wrap" aria-labelledby="lp-more">
          <h2 id="lp-more" className="lp-h2 lp-h2--narrow">
            {ui.more}
          </h2>
          <UseCards lang={lang} except={id} />
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <p className="lp-footer__word" aria-hidden="true">
            {BRAND.name}
          </p>
          <p className="lp-footer__meta">
            <span>{ui.meta}</span>
            <a href={LEGAL.privacy}>{ui.privacyLink}</a>
            <a href={LEGAL.terms}>{ui.terms}</a>
            <a href={guideBase}>{ui.guides}</a>
            <a href={BRAND.sourceUrl} rel="noopener">
              {ui.source}
            </a>
            <a href={`mailto:${CONTACT_EMAIL}`}>{ui.contact}</a>
            <a href={USE_PATHS[id][other]} hrefLang={other}>
              {ui.lang}
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

/** Use-case cards for page footers and the homepage. */
export function UseCards({ lang, except }: { lang: UseLang; except?: UseId }) {
  return (
    <ul className="lp-use-cards">
      {USE_ORDER.filter((x) => x !== except).map((x) => (
        <li key={x}>
          <a href={USE_PATHS[x][lang]} className="lp-use-card" data-umami-event="use_card" data-umami-event-page={x}>
            <span className="lp-use-card__title">{USE_CARDS[lang][x].title}</span>
            <span className="lp-use-card__body">{USE_CARDS[lang][x].body}</span>
            <span className="lp-use-card__arrow" aria-hidden="true">
              →
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
