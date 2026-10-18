import type { Metadata } from 'next';
import { EditorApp } from '@/components/EditorApp';
import { BRAND } from '@/config/brand';

/*
  Editor moved here from the root; the root is now a landing page. Search engines and AI search need
  content, while the editor is an empty JS shell. Use noindex, follow because the editor has no
  indexable text, concentrating signals on the landing page. The root script redirects legacy /#s=…
  share links and ?unlock= here.
*/
export const metadata: Metadata = {
  title: `Editor — ${BRAND.name}`,
  description: BRAND.tagline,
  alternates: { canonical: '/editor/' },
  robots: { index: false, follow: true },
};

export default function EditorPage() {
  return <EditorApp />;
}
