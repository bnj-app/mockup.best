import '../globals.css';
import { RootShell } from '@/components/RootShell';
import { ROOT_METADATA } from '@/config/rootMetadata';

export const metadata = ROOT_METADATA;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return <RootShell lang="en">{children}</RootShell>;
}
