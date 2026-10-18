import type { MetadataRoute } from 'next';
import { BRAND } from '@/config/brand';
import { USE_ORDER, USE_PATHS } from '@/components/landing/uses-copy';

export const dynamic = 'force-static';

/*
  Public routes, all static. Deliberately omit lastModified: using build time
  would mark every entry as changed on each deploy, weakening the signal.
*/
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    /* Landing page in both languages; omit /editor/ because it is noindex. */
    {
      url: `${BRAND.siteUrl}/`,
      changeFrequency: 'weekly',
      priority: 1,
      alternates: { languages: { en: `${BRAND.siteUrl}/`, tr: `${BRAND.siteUrl}/tr/` } },
    },
    {
      url: `${BRAND.siteUrl}/tr/`,
      changeFrequency: 'weekly',
      priority: 0.9,
      alternates: { languages: { en: `${BRAND.siteUrl}/`, tr: `${BRAND.siteUrl}/tr/` } },
    },
    /*
       Use trailing slashes: slashless production URLs return 301. Listing
       redirecting URLs weakens the signal (GSC "Page with redirect" warning).
       */
    { url: `${BRAND.siteUrl}/photo/`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BRAND.siteUrl}/photo/pro/`, changeFrequency: 'monthly', priority: 0.5 },
    /* Use-case pages in EN and TR, each with hreflang pointing to its counterpart. */
    ...USE_ORDER.flatMap((id) =>
      (['en', 'tr'] as const).map((lang) => ({
        url: `${BRAND.siteUrl}${USE_PATHS[id][lang]}`,
        changeFrequency: 'monthly' as const,
        priority: lang === 'en' ? 0.8 : 0.7,
        alternates: {
          languages: { en: `${BRAND.siteUrl}${USE_PATHS[id].en}`, tr: `${BRAND.siteUrl}${USE_PATHS[id].tr}` },
        },
      })),
    ),
    { url: `${BRAND.siteUrl}/privacy/`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BRAND.siteUrl}/terms/`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
