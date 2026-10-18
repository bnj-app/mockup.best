import type { Metadata } from 'next';
import { Landing } from '@/components/landing/Landing';
import { COPY_EN } from '@/components/landing/copy';

/*
  ROOT = LANDING PAGE. The editor lives at /editor/; the page's initial
  script forwards old share links there (Landing -> forward.ts).
*/
export const metadata: Metadata = {
  title: { absolute: COPY_EN.meta.title },
  description: COPY_EN.meta.description,
  alternates: {
    canonical: '/',
    languages: { en: '/', tr: '/tr/', 'x-default': '/' },
  },
  openGraph: {
    type: 'website',
    url: '/',
    title: COPY_EN.meta.title,
    description: COPY_EN.meta.description,
    locale: 'en_US',
    images: [{ url: '/og.jpg', width: 2400, height: 1260, alt: COPY_EN.meta.ogAlt }],
  },
  twitter: {
    card: 'summary_large_image',
    title: COPY_EN.meta.title,
    description: COPY_EN.meta.description,
    images: ['/og.jpg'],
  },
};

export default function Home() {
  return <Landing copy={COPY_EN} />;
}
