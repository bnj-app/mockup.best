import { metaForUse, UsePage } from '@/components/landing/UsePage';

/* Use-case page (portfolio, tr); content is in components/landing/uses-copy.ts. */
export const metadata = metaForUse('portfolio', 'tr');

export default function Page() {
  return <UsePage id="portfolio" lang="tr" />;
}
