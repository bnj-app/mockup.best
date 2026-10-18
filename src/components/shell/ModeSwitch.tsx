'use client';

import { usePathname } from 'next/navigation';

/**
 * 3D <-> PHOTO mode switch: the only shared control between both editors.

 * ⚠️ Why use <a> instead of Link: client-side 3D -> PHOTO navigation froze
 * the tab for about 30 seconds, then opened the photo editor at a broken scale.
 * Loading /photo directly worked. Teardown of the 3D route's WebGL context,
 * warmed device shaders, composer and textures blocks the main thread
 * synchronously. The modes act independently, so full-page navigation is
 * faster and starts with a fresh context.

 * It also removes Link's prefetch 404: Next 16.3 with output: 'export' requested
 * photo/__next.photo.__PAGE__.txt for segment prefetch.

 * Two appearances match the host bars: the 3D shell uses monospace/uppercase
 * (mp-topbtn), while photo uses sans-serif and mp-ctl. A third shared style
 * looked out of place in both.
 */
export function ModeSwitch({ variant }: { variant: 'shell' | 'photo' }) {
  const pathname = usePathname();
  const photoActive = pathname?.startsWith('/photo') ?? false;

  /*
    ⚠️ href requires a trailing slash: trailingSlash rewrites Link/router hrefs,
    but not plain anchors. /photo caused an nginx 301; absolute_redirect then
    sent users through https -> http -> https, requiring three requests.
  */
  const items = [
    // The editor lives at /editor/; the root is the landing page.
    { href: '/editor/' as const, label: '3D', active: !photoActive },
    { href: '/photo/' as const, label: 'Photo', active: photoActive },
  ];

  if (variant === 'shell') {
    return (
      <div
        className="flex shrink-0 items-center gap-0.5 p-0.5"
        style={{
          background: 'var(--mp-surface)',
          borderRadius: 'var(--mp-radius)',
        }}
        role="group"
        aria-label="Editor mode"
      >
        {items.map((it) => (
          <a
            key={it.href}
            href={it.href}
            className="mp-topbtn"
            style={{ height: 22, padding: '0 10px' }}
            data-active={it.active}
            aria-current={it.active ? 'page' : undefined}
          >
            {it.label}
          </a>
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex shrink-0 items-center gap-1 p-0.5"
      style={{ background: 'var(--muted)', borderRadius: 8 }}
      role="group"
      aria-label="Editor mode"
    >
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          className="mp-ctl inline-flex h-7 items-center justify-center px-3 text-sm font-medium"
          style={{ borderRadius: 6, background: it.active ? undefined : 'transparent' }}
          data-active={it.active}
          aria-current={it.active ? 'page' : undefined}
        >
          {it.label}
        </a>
      ))}
    </div>
  );
}
