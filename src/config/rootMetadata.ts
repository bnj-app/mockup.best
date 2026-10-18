import type { Metadata } from 'next';
import { BRAND } from '@/config/brand';

/*
  SOCIAL CARDS ARE REQUIRED.

  This visual product's shared links had no previews on X, LinkedIn, Slack
  or WhatsApp because og: tags were missing. metadataBase is also required
  to resolve relative /og.jpg into an absolute URL.
*/
export const ROOT_METADATA: Metadata = {
  metadataBase: new URL(BRAND.siteUrl),
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description: BRAND.tagline,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: BRAND.name,
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.tagline,
    url: '/',
    images: [{ url: BRAND.ogImage, width: 2400, height: 1260, alt: BRAND.tagline }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.tagline,
    images: [BRAND.ogImage],
  },
};
