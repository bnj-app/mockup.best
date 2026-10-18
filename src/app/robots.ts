import type { MetadataRoute } from 'next';
import { BRAND } from '@/config/brand';

/*
  Missing robots.txt requests returned 404. Next static export generates a plain file at build time,
  requiring no server processing.
*/
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    /*
      Two sitemaps: app and guide. The guide (30 topics × 11 languages) runs in a separate container
      and generates its own sitemap; listing it here advertises it to crawlers without overwriting
      it.
    */
    sitemap: [`${BRAND.siteUrl}/sitemap.xml`, `${BRAND.siteUrl}/guide/sitemap.xml`],
  };
}
