import type { Metadata } from 'next';
import { Landing } from '@/components/landing/Landing';
import { COPY_TR } from '@/components/landing/copy-tr';

/* Turkish landing page. The editor UI is English; this page links to /editor/. */
export const metadata: Metadata = {
  title: { absolute: COPY_TR.meta.title },
  description: COPY_TR.meta.description,
  alternates: {
    canonical: '/tr/',
    languages: { en: '/', tr: '/tr/', 'x-default': '/' },
  },
  openGraph: {
    type: 'website',
    url: '/tr/',
    title: COPY_TR.meta.title,
    description: COPY_TR.meta.description,
    locale: 'tr_TR',
    images: [{ url: '/og.jpg', width: 2400, height: 1260, alt: COPY_TR.meta.ogAlt }],
  },
  twitter: {
    card: 'summary_large_image',
    title: COPY_TR.meta.title,
    description: COPY_TR.meta.description,
    images: ['/og.jpg'],
  },
};

export default function HomeTr() {
  return <Landing copy={COPY_TR} />;
}
