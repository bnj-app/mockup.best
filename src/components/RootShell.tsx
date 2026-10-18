import type { ReactNode } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import { Analytics } from '@/components/Analytics';

/*
  Shared root shell: <html>/<body> for the (en) and (tr) root layouts. Multiple root layouts allow
  different <html lang> values; fonts, theme script, and analytics are shared.
*/
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'latin-ext'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin', 'latin-ext'],
});

export function RootShell({ lang, children }: { lang: 'en' | 'tr'; children: ReactNode }) {
  return (
    <html
      lang={lang}
      data-theme="light"
      /*
        The inline script below changes `data-theme` before React hydration, which would otherwise mismatch
        React's "light" value. Suppress warnings only for these two attributes; validate the rest of the
        tree normally.
      */
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/*
          Apply the theme before paint. Preferences live in localStorage and hydrate into the store after
          mount (`hydratePersisted`, for hydration safety). Waiting for that would flash a white frame for
          dark-theme users on every load. Set the attribute before first paint. The key must match THEME_KEY
          in `editor.ts`.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('mockuptop:theme:v1')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}",
          }}
        />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
