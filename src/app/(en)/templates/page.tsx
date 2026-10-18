import { metaForUse, UsePage } from '@/components/landing/UsePage';

/* Use-case page (templates, en); content is in components/landing/uses-copy.ts. */
export const metadata = metaForUse('templates', 'en');

export default function Page() {
  return <UsePage id="templates" lang="en" />;
}
