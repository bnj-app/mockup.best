import { metaForUse, UsePage } from '@/components/landing/UsePage';

/* Turkish templates use-case page; content lives in components/landing/uses-copy.ts. */
export const metadata = metaForUse('templates', 'tr');

export default function Page() {
  return <UsePage id="templates" lang="tr" />;
}
