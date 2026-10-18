import { metaForUse, UsePage } from '@/components/landing/UsePage';

/* Use-case page (redact, en); content lives in components/landing/uses-copy.ts. */
export const metadata = metaForUse('redact', 'en');

export default function Page() {
  return <UsePage id="redact" lang="en" />;
}
