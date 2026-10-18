import type { Metadata } from 'next';
import PhotoProPage from '@photo/ProPage';

/*
  Keep copy consistent with FREE_FOR_ALL: showing "Pricing / PRO" in search results while the product
  is free would create a mismatch between public copy and application behavior.
*/
const TITLE = 'Everything is free — mockup.best';
const DESC = 'Every feature is unlocked for everyone: 4K exports, no watermark, no sign-up.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: '/photo/pro/' },
  openGraph: { title: TITLE, description: DESC, url: '/photo/pro/' },
};

export default function Page() {
  return <PhotoProPage />;
}
