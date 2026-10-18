import { metaForUse, UsePage } from '@/components/landing/UsePage';

/* Turkish use-case page; content lives in components/landing/uses-copy.ts. */
export const metadata = metaForUse('promo', 'tr');

export default function Page() {
  return <UsePage id="promo" lang="tr" />;
}
