'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { BRAND, FREE_CAPTURES, FREE_FOR_ALL } from '@/config/brand';
import { useEditor } from '@/store/editor';
import { Chevron } from '@/components/panel/Controls';
import { ExportMenu } from '@/components/shell/ExportMenu';
import { ASPECTS, getAspect } from '@/config/aspects';
import { MagicReelModal } from '@/components/shell/MagicReelModal';
import { openUpdateScreens } from '@/components/shell/UpdateScreensModal';
import { openProjects } from '@/components/shell/ProjectsModal';
import { openGoalPack, OPEN_EXPORT_EVENT } from '@/components/shell/GoalPackModal';

/** Open the templates menu externally via a deep link; `detail.highlight` identifies the card to highlight. */
export const OPEN_TEMPLATES_EVENT = 'mockuptop:open-templates';
import { TemplatesMenu } from '@/components/shell/TemplatesMenu';
import { InfoMenu } from '@/components/shell/InfoMenu';
import { UpgradeModal } from '@/components/shell/UpgradeModal';
import { GUIDE_URL, LEGAL } from '@/config/legal';
import { encodeShareLink, exportProject, importProjectFile, loadDemoProject, resetProject } from '@/store/project';
import { setSoundsEnabled, soundsEnabled, subscribeSounds } from '@/components/shell/sounds';
import { redo, undo } from '@/store/history';
import { toast } from '@/components/shell/Toast';
import { downloadBlob } from '@/components/scene/exportBridge';
import { ModeSwitch } from '@/components/shell/ModeSwitch';

type MenuId = 'menu' | 'info' | 'templates' | 'help' | 'fill' | 'export';

/** Dropdown row shared by the hamburger and Help menus. */
function MenuRow({
  label,
  hint,
  onClick,
  href,
}: {
  label: string;
  hint?: string;
  onClick?: () => void;
  href?: string;
}) {
  const cls = 'mp-label flex w-full items-center justify-between rounded px-2 py-1.5 text-left';
  const interactive = `${cls} hover:bg-[var(--mp-surface-active)]`;
  const inner = (
    <>
      <span style={{ color: 'var(--mp-text-primary)' }}>{label}</span>
      {hint ? <span style={{ color: 'var(--mp-text-tertiary)' }}>{hint}</span> : null}
    </>
  );
  if (href) {
    return (
      <a className={interactive} href={href} target="_blank" rel="noreferrer">
        {inner}
      </a>
    );
  }
  /*
    A row without an action is not a BUTTON. "Captures — 2 / 3 left" is informational, but
    rendering it as a button gave it hover and keyboard focus with no click action. Every
    apparently clickable menu item should do something.
  */
  if (!onClick) {
    return <div className={cls}>{inner}</div>;
  }
  return (
    <button className={interactive} onClick={onClick}>
      {inner}
    </button>
  );
}

function MenuDivider() {
  return <div className="mx-1 my-1 h-px" style={{ background: 'var(--mp-border)' }} />;
}

/**
 * Top bar: 40 px high, 12 px radius, glass background.
 * One menu state prevents simultaneous INFO, TEMPLATES and FILL dropdowns. Previously each had
 * its own boolean and stayed open on outside clicks. Escape and outside-click handling now share
 * one place.
 */
export function TopBar({ onUpload }: { onUpload: (file: File) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [magicOpen, setMagicOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const aspectId = useEditor((s) => s.aspectId);
  const setAspect = useEditor((s) => s.setAspect);
  const aspect = getAspect(aspectId);
  const capturesLeft = useEditor((s) => s.capturesLeft);
  const isPro = useEditor((s) => s.isPro);
  /*
    Read the sound preference with `useSyncExternalStore`. A constant `true` server snapshot and
    the real client preference let React apply the difference after hydration. A lazy `useState`
    initializer caused a server/client mismatch and hydration error #418.
  */
  const sounds = useSyncExternalStore(subscribeSounds, soundsEnabled, () => true);
  const [, forceSounds] = useState(0);
  const drawerOpen = useEditor((s) => s.drawerOpen);
  const toggleDrawer = useEditor((s) => s.toggleDrawer);
  const centerGuides = useEditor((s) => s.centerGuides);
  const toggleCenterGuides = useEditor((s) => s.toggleCenterGuides);
  const safeAreaGuide = useEditor((s) => s.safeAreaGuide);
  const toggleSafeAreaGuide = useEditor((s) => s.toggleSafeAreaGuide);
  const theme = useEditor((s) => s.theme);
  const setTheme = useEditor((s) => s.setTheme);
  const optimized = useEditor((s) => s.optimizedPlayback);
  const setOptimized = useEditor((s) => s.setOptimizedPlayback);
  // Read the preference AFTER mount (no localStorage on the first hydration frame).
  useEffect(() => {
    try {
      if (window.localStorage.getItem('mockuptop:optimized-playback') === '1') {
        useEditor.setState({ optimizedPlayback: true });
      }
    } catch {
      // No storage available.
    }
  }, []);
  const toggleVideoMode = useEditor((s) => s.toggleVideoMode);
  const togglePanel = useEditor((s) => s.togglePanel);

  const toggle = (id: MenuId) => setOpenMenu((v) => (v === id ? null : id));

  /*
    Sharing is called from both the bar button and a hamburger row on narrow screens, so its
    implementation lives here. Also write the link to the ADDRESS BAR: clipboard permission can
    silently fail depending on browser/focus, otherwise users would see "Copied" without receiving
    a link.
  */
  const doShare = async () => {
    const link = await encodeShareLink();
    window.history.replaceState(null, '', link);
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  // The pack dialog's "Open Export" button opens the export menu here.
  useEffect(() => {
    const onOpenExport = () => setOpenMenu('export');
    window.addEventListener(OPEN_EXPORT_EVENT, onOpenExport);
    return () => window.removeEventListener(OPEN_EXPORT_EVENT, onOpenExport);
  }, []);
  /*
    From the template gallery (`?template=<id>`), open the menu and highlight the card. Do not
    apply it automatically: a returning user's saved project must remain intact until they choose
    a template.
  */
  const [tplHighlight, setTplHighlight] = useState<string | null>(null);
  useEffect(() => {
    const onOpenTpl = (e: Event) => {
      setTplHighlight((e as CustomEvent<{ highlight?: string }>).detail?.highlight ?? null);
      setOpenMenu('templates');
    };
    window.addEventListener(OPEN_TEMPLATES_EVENT, onOpenTpl);
    return () => window.removeEventListener(OPEN_TEMPLATES_EVENT, onOpenTpl);
  }, []);

  // Escape and outside clicks close any open menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
        setUpgradeOpen(false);
        return;
      }
      /*
        "?" opens keyboard shortcuts. Help already advertised this shortcut without a listener.
        Ignore it while typing in inputs/textareas, and leave Ctrl/Alt combinations alone.
      */
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = e.target as HTMLElement | null;
        if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return;
        e.preventDefault();
        setOpenMenu((v) => (v === 'info' ? null : 'info'));
      }
    };
    const onDown = (e: PointerEvent) => {
      const el = headerRef.current;
      if (el && !el.contains(e.target as Node)) setOpenMenu(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  return (
    <header
      ref={headerRef}
      className="flex shrink-0 items-center gap-1 px-1.5 sm:gap-2 md:gap-2.5"
      /*
        `position: relative` and z-index are required. `backdrop-filter` creates a stacking
        context; without positioning the bar, its dropdown z-index is trapped there and the later
        canvas covers the menu.
      */
      style={{
        position: 'relative',
        zIndex: 600,
        height: 'var(--mp-topbar-h)',
        borderRadius: 'var(--mp-radius-lg)',
        border: '1px solid var(--mp-border)',
        background: 'var(--mp-glass)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="relative flex shrink-0 items-center gap-1.5">
        <button
          className="grid h-7 w-7 place-items-center rounded-lg"
          aria-label="Menu"
          title="Menu"
          onClick={() => toggle('menu')}
          data-active={openMenu === 'menu'}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 4h10M2 7h10M2 10h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        {/* Hide the wordmark on phones to leave room for EXPORT. */}
        <span className="mp-mono select-none text-[11px] font-bold tracking-[0.12em] max-sm:hidden">
          {BRAND.wordmark}
        </span>
        {/* 3D ↔ Photo sits beside the brand to give both modes equal prominence. */}
        <ModeSwitch variant="shell" />

        {openMenu === 'menu' ? (
          <div
            className="absolute left-0 top-full z-[700] mt-2 w-56 p-1"
            style={{
              background: 'var(--mp-dropdown)',
              border: '1px solid var(--mp-border)',
              borderRadius: 'var(--mp-radius-lg)',
              boxShadow: 'var(--mp-shadow-dropdown)',
            }}
          >
            <MenuRow
              label="New project"
              onClick={() => {
                resetProject();
                setOpenMenu(null);
                toast('Project reset — Ctrl+Z to undo');
              }}
            />
            <MenuRow
              label="Start from a goal…"
              onClick={() => {
                setOpenMenu(null);
                openGoalPack();
              }}
            />
            <MenuRow
              label="Projects on this device…"
              onClick={() => {
                setOpenMenu(null);
                openProjects();
              }}
            />
            <MenuDivider />
            <MenuRow label="Undo" hint="Ctrl Z" onClick={() => undo()} />
            <MenuRow label="Redo" hint="Ctrl Shift Z" onClick={() => redo()} />
            <MenuDivider />
            <MenuRow
              label="Toggle timeline"
              hint="T"
              onClick={() => {
                toggleVideoMode();
                setOpenMenu(null);
              }}
            />
            <MenuRow
              label={`Optimized playback${optimized ? ' ✓' : ''}`}
              onClick={() => setOptimized(!optimized)}
            />
            <MenuRow
              label="Toggle panel"
              hint="P"
              onClick={() => {
                togglePanel();
                setOpenMenu(null);
              }}
            />
            {/* The bar's theme button is hidden on phones; provide it here. */}
            <MenuRow
              label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              onClick={() => {
                setTheme(theme === 'dark' ? 'light' : 'dark');
                setOpenMenu(null);
              }}
            />
            <MenuDivider />
            {/*
              Center guides belong in the hamburger menu: a framing aid used occasionally, but
              easy to find when needed.
            */}
            {/*
              Actions removed from the bar on narrow/medium screens appear here. Lower-priority
              actions move to the menu so all remain accessible.
            */}
            {/*
              Hide the capture counter when everything is free: "unlimited" would suggest a limit
              that does not exist (see FREE_FOR_ALL).
            */}
            {!FREE_FOR_ALL ? (
              <MenuRow
                label={`Captures — ${isPro ? 'unlimited' : `${capturesLeft} / ${FREE_CAPTURES} left`}`}
              />
            ) : null}
            <MenuRow
              label="Save project…"
              onClick={async () => {
                setOpenMenu(null);
                const blob = await exportProject();
                downloadBlob(blob, `${BRAND.fileSlug}-project.json`);
              }}
            />
            <MenuRow label="Open project…" onClick={() => {
              projectRef.current?.click();
              setOpenMenu(null);
            }} />
            {/*
              ⚠️ These three rows preserve functionality on narrow screens. Templates / Demo /
              Share use `max-[1640px]:hidden`, but unlayered `.mp-topbtn` display once overrode
              `hidden`, keeping them visible. Fixing the CSS layer made hiding work and left those
              actions inaccessible at 1024–1640 px, covering most laptops. The hamburger menu must
              retain every action removed from the bar.
            */}
            <MenuRow
              label="Update screens…"
              onClick={() => {
                setOpenMenu(null);
                openUpdateScreens();
              }}
            />
            <MenuRow label="Templates…" onClick={() => setOpenMenu('templates')} />
            <MenuRow
              label="Load demo"
              onClick={() => {
                loadDemoProject();
                setOpenMenu(null);
                toast('Demo loaded — Ctrl+Z restores your work');
              }}
            />
            <MenuRow
              label="Share link"
              onClick={async () => {
                setOpenMenu(null);
                await doShare();
              }}
            />
            <MenuRow
              label={centerGuides ? 'Hide center guides' : 'Show center guides'}
              onClick={() => {
                toggleCenterGuides();
                setOpenMenu(null);
              }}
            />
            <MenuRow
              label={safeAreaGuide ? 'Hide Reels / TikTok safe area' : 'Show Reels / TikTok safe area (9:16)'}
              onClick={() => {
                toggleSafeAreaGuide();
                setOpenMenu(null);
              }}
            />
            {/*
               Persist the sound preference so users who disable interface sounds do not need to
               repeat that choice.
             */}
            <MenuRow
              label={sounds ? 'Turn interface sounds off' : 'Turn interface sounds on'}
              onClick={() => {
                setSoundsEnabled(!sounds);
                forceSounds((n) => n + 1);
                window.dispatchEvent(new Event('storage'));
                setOpenMenu(null);
              }}
            />
            <MenuRow label="Info & shortcuts" onClick={() => setOpenMenu('info')} />
            <MenuRow label="Help" onClick={() => setOpenMenu('help')} />
            <MenuDivider />
            {/*
               The guide runs in a separate container (/guide), outside the app build. A plain
               link works because it shares the same domain.
             */}
            <MenuRow label="Guides" href={GUIDE_URL} />
            <MenuRow label="Privacy" href={LEGAL.privacy} />
            <MenuRow label="Terms" href={LEGAL.terms} />
          </div>
        ) : null}
      </div>

      {/*
        NARROW-SCREEN MENU VISIBILITY. The wrapper used `max-[1640px]:hidden` and contained
        INFO/HELP dropdowns. Hamburger rows set the same `openMenu`, so the hamburger closed but
        the requested dropdown appeared inside a display:none container.
        Apply `hidden` to the BUTTON instead. On narrow screens `contents` removes the wrapper box
        and its flex gap while allowing the dropdown to render. It positions relative to the
        header (`position: relative`), with `top-full` placing it below the bar, like the
        hamburger menu. Above 1640 px the variant does not apply. The threshold rose from 1520
        because adding SHARE + TEMPLATES caused overflow at 1520 and 1600 px.
      */}
      <div className="relative max-[1640px]:contents">
        <button
          className="mp-topbtn max-[1640px]:hidden"
          onClick={() => toggle('info')}
          data-active={openMenu === 'info'}
        >
          Info
        </button>
        {openMenu === 'info' ? <InfoMenu onClose={() => setOpenMenu(null)} /> : null}
      </div>

      {/*
        Same reason as Info/Help: the hamburger's "Templates…" row targets this dropdown. A hidden
        container would make that action ineffective; `contents` removes the wrapper box while
        allowing the dropdown to render.
      */}
      <div className="relative max-[1640px]:contents">
        <button
          className="mp-topbtn max-[1640px]:hidden"
          onClick={() => toggle('templates')}
          data-tour="templates"
          data-active={openMenu === 'templates'}
        >
          Templates
          <span className="ml-1.5">
            <Chevron open={openMenu === 'templates'} />
          </span>
        </button>
        {openMenu === 'templates' ? (
          <TemplatesMenu
            highlight={tplHighlight}
            onClose={() => setOpenMenu(null)}
            onMagicReel={() => {
              setOpenMenu(null);
              setMagicOpen(true);
            }}
          />
        ) : null}
      </div>

      {/*
         Same reason as above: the narrow-screen hamburger's "Help" row targets this dropdown;
         hiding its container made the row ineffective.
       */}
      <div className="relative max-[1640px]:contents">
        <button
          className="mp-topbtn max-[1640px]:hidden"
          onClick={() => toggle('help')}
          data-active={openMenu === 'help'}
        >
          Help
        </button>
        {openMenu === 'help' ? (
          <div
            className="absolute left-0 top-full z-[700] mt-2 w-56 p-1"
            style={{
              background: 'var(--mp-dropdown)',
              border: '1px solid var(--mp-border)',
              borderRadius: 'var(--mp-radius-lg)',
              boxShadow: 'var(--mp-shadow-dropdown)',
            }}
          >
            <MenuRow label="Contact & support" href={LEGAL.support} />
            <MenuRow
              label="Keyboard shortcuts"
              hint="?"
              onClick={() => setOpenMenu('info')}
            />
            <MenuDivider />
            <MenuRow
              label="Restart tour"
              onClick={() => {
                setOpenMenu(null);
                window.dispatchEvent(new CustomEvent('mockuptop:tour'));
              }}
            />
          </div>
        ) : null}
      </div>

      {/*
        DEMO manually loads the showcase project. The opening demo loads only for first-time
        visitors without autosave, so returning users could never see it. Preserve current work:
        Ctrl+Z restores it in one step.
      */}
      <button
        /* Hide the demo button on narrow AND medium screens to avoid bar overflow. */
        className="mp-topbtn max-[1640px]:hidden"
        onClick={() => {
          loadDemoProject();
          toast('Demo loaded — Ctrl+Z restores your work');
        }}
        title="Load the 5-scene showcase project"
      >
        Demo
      </button>

      {!FREE_FOR_ALL ? (
        <>
          <span
            className="mx-1 h-4 w-px shrink-0 max-[1640px]:hidden"
            style={{ background: 'var(--mp-border)' }}
          />

          <span className="mp-label shrink-0 max-[1640px]:hidden">
            Captures{' '}
            <span style={{ color: 'var(--mp-text-focus)' }}>
              {isPro ? '∞' : `${capturesLeft} / ${FREE_CAPTURES}`}
            </span>
          </span>
        </>
      ) : null}

      {/* Centered aspect-ratio selector. */}
      <div className="relative flex flex-1 justify-center">
        <button
          className="mp-topbtn"
          onClick={() => toggle('fill')}
          data-active={openMenu === 'fill'}
          title="Canvas aspect ratio"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="mr-1.5 max-sm:hidden">
            <rect x="1" y="2" width="9" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
          </svg>
          {aspect.label}
          <span className="ml-1.5">
            <Chevron open={openMenu === 'fill'} />
          </span>
        </button>

        {openMenu === 'fill' ? (
          <div
            className="mp-scroll absolute top-full z-[700] mt-2 w-64 overflow-y-auto p-1"
            style={{
              maxHeight: '70vh',
              background: 'var(--mp-dropdown)',
              border: '1px solid var(--mp-border)',
              borderRadius: 'var(--mp-radius-lg)',
              boxShadow: 'var(--mp-shadow-dropdown)',
            }}
          >
            {ASPECTS.map((a, i) => (
              <div key={a.id}>
                {/* Group heading separates App Store sizes. */}
                {a.group && ASPECTS[i - 1]?.group !== a.group ? (
                  <div
                    className="mp-label px-2 pb-1 pt-2"
                    style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}
                  >
                    {a.group}
                  </div>
                ) : null}
                <button
                  onClick={() => {
                    setAspect(a.id);
                    setOpenMenu(null);
                  }}
                  className="mp-label flex w-full items-center justify-between rounded px-2 py-1.5 text-left"
                  style={{
                    background: aspectId === a.id ? 'var(--mp-surface-active)' : 'transparent',
                    color: aspectId === a.id ? 'var(--mp-text-primary)' : undefined,
                  }}
                >
                  <span>{a.label}</span>
                  {a.px ? (
                    <span style={{ color: 'var(--mp-text-tertiary)' }}>
                      {a.px.w}×{a.px.h}
                    </span>
                  ) : null}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <button
        className="mp-topbtn max-lg:hidden"
        onClick={() => fileRef.current?.click()}
        title="Upload a screenshot or screen recording — or paste / drop it anywhere"
      >
        Upload
      </button>

      {/* Undo / redo */}
      <button className="mp-topbtn max-lg:hidden" onClick={() => undo()} aria-label="Undo" title="Undo (Ctrl+Z)">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path d="M4 5.5H9a3 3 0 1 1 0 6H6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M6 3 3.5 5.5 6 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button className="mp-topbtn max-lg:hidden" onClick={() => redo()} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path d="M10 5.5H5a3 3 0 1 0 0 6h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M8 3l2.5 2.5L8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <button
        className="mp-topbtn max-[1640px]:hidden"
        onClick={async () => {
          const blob = await exportProject();
          downloadBlob(blob, `${BRAND.fileSlug}-project.json`);
        }}
      >
        Save project
      </button>
      {/*
        Move "Open" from the top bar to the hamburger. At 1520 px the bar content measured 1263 px
        against 1202 px available, overflowing EXPORT onto the right panel. Opening projects is
        infrequent; keep Share, Upgrade and Export in the bar.
      */}
      <button
        className="mp-topbtn max-[1640px]:hidden"
        onClick={doShare}
        title="Copies a share link with the scene setup (media not included)"
      >
        {copied ? 'Copied' : 'Share'}
      </button>

      {/*
        Mobile panel button: narrow screens start with the panel closed, and this opens it. Show
        it only there; wide screens already display the panel.
      */}
      {/*
        The wrapping span is required: applying `lg:hidden` directly to the button was overridden
        by `mp-topbtn`'s `display:flex`, leaving it visible on wide screens (measured at 1520 px).
      */}
      <span className="lg:hidden">
        <button
          className="mp-topbtn shrink-0"
          onClick={() => toggleDrawer()}
          data-active={drawerOpen}
          title="Toggle the properties panel"
        >
          Panel
        </button>
      </span>

      {!isPro ? (
        <button
          className="mp-badge shrink-0"
          data-tone="free"
          style={{ padding: '5px 10px', fontSize: 9 }}
          onClick={() => setUpgradeOpen(true)}
        >
          Upgrade
        </button>
      ) : null}
      {/*
        A portal is required: the header's backdrop-filter creates a containing block for fixed
        positioning, causing the modal to position relative to the header and get clipped.
      */}
      {upgradeOpen
        ? createPortal(<UpgradeModal onClose={() => setUpgradeOpen(false)} />, document.body)
        : null}
      {/* Same portal requirement: the header's backdrop-filter containing block. */}
      {magicOpen
        ? createPortal(<MagicReelModal onClose={() => setMagicOpen(false)} />, document.body)
        : null}

      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg max-sm:hidden"
        aria-label="Toggle theme"
        title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
      >
        {theme === 'dark' ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.2" />
            <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M11.5 8.6A5 5 0 0 1 5.4 2.5a5 5 0 1 0 6.1 6.1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <div className="relative shrink-0">
        <button
          onClick={() => toggle('export')}
          data-tour="export"
          className="mp-topbtn"
          style={{
            background: 'var(--mp-text-root)',
            color: 'var(--mp-page)',
            fontWeight: 600,
          }}
        >
          Export
          <span className="ml-1.5 max-sm:hidden">
            <Chevron open={openMenu === 'export'} />
          </span>
        </button>
        {openMenu === 'export' ? <ExportMenu onClose={() => setOpenMenu(null)} /> : null}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          // Multiple selected files use the same path as dropping them: "Update screens".
          const files = Array.from(e.target.files ?? []);
          if (files.length > 1) openUpdateScreens(files);
          else if (files[0]) onUpload(files[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={projectRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) await importProjectFile(f);
          e.target.value = '';
        }}
      />
    </header>
  );
}
