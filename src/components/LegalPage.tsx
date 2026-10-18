import Link from 'next/link';
import { BRAND } from '@/config/brand';
import { LEGAL_UPDATED } from '@/config/legal';

/**
 * Shared legal-page container. Designed for reading rather than editing, with generous line
 * spacing, limited line length, and simple typography instead of the editor's dense dark shell.
 */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh px-6 py-14" style={{ background: '#f7f7f8', color: '#1a1c20' }}>
      <div className="mx-auto w-full max-w-[68ch]">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight"
          style={{ color: 'rgba(26,28,32,.55)' }}
        >
          ← {BRAND.name}
        </Link>

        <h1 className="mt-6 text-[34px] font-extrabold leading-tight tracking-[-1px]">{title}</h1>
        <p className="mt-2 text-sm" style={{ color: 'rgba(26,28,32,.55)' }}>
          Last updated: {LEGAL_UPDATED}
        </p>

        <div className="legal mt-9 flex flex-col gap-6 text-[15px] leading-relaxed">{children}</div>

        <p className="mt-14 text-xs" style={{ color: 'rgba(26,28,32,.45)' }}>
          {BRAND.name} — {BRAND.tagline}
        </p>
      </div>
    </main>
  );
}

/** Titled section with consistent spacing on both pages. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-[19px] font-bold tracking-[-0.3px]">{title}</h2>
      {children}
    </section>
  );
}
