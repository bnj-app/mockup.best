import { metaForUse, UsePage } from '@/components/landing/UsePage';

/* Use-case page (portfolio, en); content is in components/landing/uses-copy.ts. */
export const metadata = metaForUse('portfolio', 'en');

export default function Page() {
  return <UsePage id="portfolio" lang="en" />;
}
