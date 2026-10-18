import { metaForUse, UsePage } from '@/components/landing/UsePage';

/* English checker use-case page; content lives in components/landing/uses-copy.ts. */
export const metadata = metaForUse('checker', 'en');

export default function Page() {
  return <UsePage id="checker" lang="en" />;
}
