import { metaForUse, UsePage } from '@/components/landing/UsePage';

/* Use-case page (checker, tr); content lives in components/landing/uses-copy.ts. */
export const metadata = metaForUse('checker', 'tr');

export default function Page() {
  return <UsePage id="checker" lang="tr" />;
}
