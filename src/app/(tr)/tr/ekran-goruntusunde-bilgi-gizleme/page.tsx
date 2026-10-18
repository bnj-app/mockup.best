import { metaForUse, UsePage } from '@/components/landing/UsePage';

/* Use-case page (redact, tr); content is in components/landing/uses-copy.ts. */
export const metadata = metaForUse('redact', 'tr');

export default function Page() {
  return <UsePage id="redact" lang="tr" />;
}
