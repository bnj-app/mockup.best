import '../globals.css';
import type { ReactNode } from 'react';
import { RootShell } from '@/components/RootShell';
import { ROOT_METADATA } from '@/config/rootMetadata';

/* Turkish root layout, separate only for <html lang="tr"> (see RootShell). */
export const metadata = ROOT_METADATA;

export default function TrLayout({ children }: { children: ReactNode }) {
  return <RootShell lang="tr">{children}</RootShell>;
}
