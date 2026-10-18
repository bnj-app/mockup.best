import { metaForUse, UsePage } from '@/components/landing/UsePage';

/* App Store use-case page (en); content lives in components/landing/uses-copy.ts. */
export const metadata = metaForUse('app-store', 'en');

export default function Page() {
  return <UsePage id="app-store" lang="en" />;
}
