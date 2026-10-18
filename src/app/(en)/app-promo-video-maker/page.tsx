import { metaForUse, UsePage } from '@/components/landing/UsePage';

/* English app video use-case page; content lives in components/landing/uses-copy.ts. */
export const metadata = metaForUse('promo', 'en');

export default function Page() {
  return <UsePage id="promo" lang="en" />;
}
