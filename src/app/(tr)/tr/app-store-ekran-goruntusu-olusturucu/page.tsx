import { metaForUse, UsePage } from '@/components/landing/UsePage';

/* App Store use-case page (tr); content lives in components/landing/uses-copy.ts. */
export const metadata = metaForUse('app-store', 'tr');

export default function Page() {
  return <UsePage id="app-store" lang="tr" />;
}
