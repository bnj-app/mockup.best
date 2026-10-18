'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { TopBar } from '@/components/shell/TopBar';
import { Timeline } from '@/components/shell/Timeline';
import { PropertiesPanel } from '@/components/shell/PropertiesPanel';
import { applyOwnerUnlock, useEditor } from '@/store/editor';
import { DevErrorBridge } from '@/components/DevErrorBridge';
import { AutomationHook } from '@/components/AutomationHook';
import { decodeShareLink, loadDemoProject, restoreAutosave, startAutosave } from '@/store/project';
import { rebaseHistory, redo, startHistory, undo } from '@/store/history';
import { Toast, toast } from '@/components/shell/Toast';
import { HintStrip, Tour } from '@/components/shell/Tour';
import { MockupPicker } from '@/components/shell/MockupPicker';
import { DropChoice } from '@/components/shell/DropChoice';
import { WhatsNew } from '@/components/shell/WhatsNew';
import { PhoneGate } from '@/components/shell/PhoneGate';
import { openUpdateScreens, UpdateScreensHost } from '@/components/shell/UpdateScreensModal';
import { RedactHost } from '@/components/shell/RedactModal';
import { ProjectsHost } from '@/components/shell/ProjectsModal';
import { GoalPackHost, openGoalPack } from '@/components/shell/GoalPackModal';
import { getPack } from '@/config/packs';
import { TEMPLATES } from '@/config/templates';
import { OPEN_TEMPLATES_EVENT } from '@/components/shell/TopBar';
import { openRedact } from '@/components/shell/RedactModal';
import { restoreDeviceMedia, startDeviceSync } from '@/store/shelf';

// The 3D scene is client-only; WebGL is unavailable during server rendering.
const Stage = dynamic(() => import('@/components/scene/Stage').then((m) => m.Stage), {
  ssr: false,
  loading: () => <div className="h-full w-full" style={{ background: 'var(--mp-surface)' }} />,
});

/**
 * Export cover. Capture switches the renderer to target resolution while intentionally keeping the
 * canvas CSS box unchanged to avoid a 4K page jump. A 1080x1920 buffer stretches into the wide box,
 * widening the device and enlarging the framing; video capture showed this throughout recording.
 * The cover hides that frame and explains the operation. It does not correct rendering; an
 * offscreen target would, but requires separate work across the post-processing chain.
 */
function ExportCover() {
  const exporting = useEditor((s) => s.exporting);
  if (!exporting) return null;
  return (
    <div
      className="absolute inset-0 z-[500] grid place-items-center"
      style={{
        background: 'var(--mp-page)',
        borderRadius: 'var(--mp-radius-lg)',
      }}
      aria-live="polite"
    >
      <span className="mp-label" style={{ color: 'var(--mp-text-secondary)' }}>
        Rendering export…
      </span>
    </div>
  );
}

export function EditorApp() {
  const setMedia = useEditor((s) => s.setMedia);
  const videoMode = useEditor((s) => s.videoMode);
  const panelOpen = useEditor((s) => s.panelOpen);
  const toggleVideoMode = useEditor((s) => s.toggleVideoMode);
  const togglePanel = useEditor((s) => s.togglePanel);
  const drawerOpen = useEditor((s) => s.drawerOpen);
  const toggleDrawer = useEditor((s) => s.toggleDrawer);
  const setPlaying = useEditor((s) => s.setPlaying);
  const playing = useEditor((s) => s.playing);

  /*
    Drop choice: if the scene already has media, ask whether to replace it or create a scene. For an
    empty scene, placing the media is the only meaningful action.
  */
  const [dropFile, setDropFile] = useState<File | null>(null);
  const placeMedia = useCallback(
    (file: File) =>
      setMedia(
        URL.createObjectURL(file),
        file.type.startsWith('video/') ? 'video' : 'image',
        file.name,
      ),
    [setMedia],
  );

  const handleUpload = useCallback(
    (file: File) => {
      // Keep the filename too: autosave cannot store the file itself, but
      // its name is enough to identify missing files after refresh.
      if (useEditor.getState().active().media) setDropFile(file);
      else placeMedia(file);
    },
    [placeMedia],
  );

  /*
    Keyboard shortcuts. None should run in text fields: typing "t" in a heading must not close the
    timeline. Modified shortcuts such as Ctrl+S override browser behavior, so preventDefault is
    required.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el && (['INPUT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable);
      if (typing) return;

      const meta = e.ctrlKey || e.metaKey;
      const s = useEditor.getState();

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('mockuptop:capture'));
        return;
      }
      /*
        Ctrl+C: preserve native copying when text is selected; copy scenes only with an empty selection.
        Handle pasting in the paste event, not keydown, to avoid pasting both media and a scene when the
        clipboard holds an image.
      */
      if (meta && e.key.toLowerCase() === 'c') {
        if (String(window.getSelection() ?? '').length > 0) return;
        // With keyframes selected, Ctrl+C copies keyframes instead of the scene.
        if (s.selectedKfs.length) {
          e.preventDefault();
          const n = s.copySelectedKeyframes();
          toast(`${n} keyframe copied — Ctrl+V pastes at the playhead`);
          return;
        }
        if (s.copyShot()) {
          e.preventDefault();
          toast('Scene copied — Ctrl+V to paste');
        }
        return;
      }
      /*
        Ctrl/Cmd + Shift + D splits the scene at the playhead. Handle this before the switch so the
        modified 'd' combination cannot collide with another shortcut.
      */
      // Ctrl/Cmd + Alt + A selects all keyframes in the active scene.
      if (meta && e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const n = s.selectAllKeyframes();
        toast(n ? `${n} keyframe selected` : 'This scene has no keyframes');
        return;
      }

      if (meta && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        toast(s.splitShot() ? 'Scene split at playhead' : 'Move the playhead inside the scene to split');
        return;
      }

      /*
        Left/right arrows move the playhead by 0.10 s, or 0.50 s with a modifier. Accept both Ctrl/Cmd
        and Shift so either familiar gesture works. Handle this before if (meta) return; otherwise
        Ctrl/Cmd+arrow never reaches it and only Shift works.
      */
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey || meta ? 0.5 : 0.1;
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        s.setPlaying(false);
        s.setPlayhead(Math.max(0, Math.round((s.playhead + dir * step) * 100) / 100));
        return;
      }

      if (meta) return;

      /*
        Delete/Backspace: delete selected keyframes first, otherwise the scene. Deleting a scene while
        keyframes are selected is unexpected and disruptive to undo.
      */
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const removed = s.deleteSelectedKeyframes();
        if (removed) {
          toast(`${removed} keyframe deleted`);
          return;
        }
        s.removeShot(s.activeShotId);
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'k': {
          // K adds keyframes at the playhead for properties that already have animation.
          const n = s.keyframeAllTracks();
          toast(
            n
              ? `Keyframe added to ${n} ${n === 1 ? 'property' : 'properties'}`
              : 'Animate a property first — press the diamond next to a slider',
          );
          break;
        }
        case 't':
          toggleVideoMode();
          break;
        case 'p':
          togglePanel();
          break;
        case 'r':
          s.toggleRecording();
          break;
        case 'home':
          s.setPlayhead(0);
          break;
        default:
          break;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying(!playing);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleVideoMode, togglePanel, setPlaying, playing]);

  /*
    Autosave and history. Read autosave before starting writes, or the empty initial state would
    overwrite the saved project.
  */
  useEffect(() => {
    /*
      Owner key: open ?unlock=... once, persist it, then clean the URL. Run before resolving a share
      link so the address bar is cleaned in one pass.
    */
    const unlocked = applyOwnerUnlock();
    if (unlocked === 'on') toast('Pro unlocked on this browser');
    else if (unlocked === 'off') toast('Pro locked — free limits are back');
    /*
      Load persisted Pro/capture state after mount. Reading localStorage in the initial store value
      caused different server/client frames and React #418. Run after the owner key so Pro enabled
      through ?unlock= is reflected in the same pass.
    */
    useEditor.getState().hydratePersisted();

    /*
      Shared links take precedence over autosave: opening a link must show the sender's scene rather
      than the recipient's older work.
    */
    /*
      Deep link ?start=<package>: open the goal dialog with that package (future landing pages will
      link here). Remove the parameter so refreshing does not reopen the dialog.
    */
    const params = new URLSearchParams(window.location.search);
    const startPack = getPack(params.get('start'));
    const tpl = TEMPLATES.find((t) => t.id === params.get('template')) ?? null;
    const tool = params.get('tool') === 'redact' ? 'redact' : null;
    if (startPack || tpl || tool) {
      const url = new URL(window.location.href);
      ['start', 'template', 'tool'].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    if (startPack) window.setTimeout(() => openGoalPack(startPack.id), 0);
    /*
      Handle ?template=<id> (template gallery) and ?tool=redact (private-info page) after startup
      loading, over the saved project/demo. Neither changes state; they open menus/dialogs, with
      changes applied only on a user click.
    */
    const afterBoot = () => {
      if (tpl) {
        window.dispatchEvent(new CustomEvent(OPEN_TEMPLATES_EVENT, { detail: { highlight: tpl.id } }));
        toast(`Click “${tpl.label}” to apply it to this scene — Ctrl+Z undoes`);
      }
      if (tool === 'redact') {
        const sh = useEditor.getState().active();
        if (sh.media && sh.mediaKind === 'image') openRedact(sh.media);
        else toast('Upload a screenshot, then open Source → Hide private info');
      }
    };
    void decodeShareLink(window.location.hash).then((ok) => {
      // Share link > autosave > opening demo. First-time users see a playing
      // project that demonstrates the product instead of an empty editor.
      // Startup loading is not an undoable edit; history begins here.
      if (ok) {
        rebaseHistory();
        afterBoot();
        return;
      }
      if (!restoreAutosave()) {
        loadDemoProject();
        rebaseHistory();
        afterBoot();
        return;
      }
      rebaseHistory();
      afterBoot();
      /*
        Local media (project shelf): the saved project has loaded but screens still show "file missing".
        Restore media by matching IDs in IndexedDB.
      */
      void restoreDeviceMedia().then((n) => {
        if (n) toast(`Restored ${n} file${n === 1 ? '' : 's'} from this device`);
      });
    });
    const stopSave = startAutosave();
    const stopHistory = startHistory();
    const stopDevice = startDeviceSync();
    return () => {
      stopSave();
      stopHistory();
      stopDevice();
    };
  }, []);

  // Capture clipboard images directly; if the clipboard is empty and
  // the internal clipboard holds a scene, paste that scene.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (['INPUT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable)) return;
      const file = Array.from(e.clipboardData?.files ?? [])[0];
      if (file) {
        handleUpload(file);
        return;
      }
      /*
        Paste priority: keyframe clipboard > scene clipboard. Users expect the last copied content;
        pasting a scene after copying keyframes would be surprising.
      */
      const pastedKf = useEditor.getState().pasteKeyframes();
      if (pastedKf) {
        toast(`${pastedKf} keyframe pasted`);
        return;
      }
      if (useEditor.getState().pasteShot()) toast('Scene pasted');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleUpload]);

  return (
    <main
      className="fixed flex"
      style={{ inset: 'var(--mp-inset)', gap: 'var(--mp-gap)' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        // An open dialog owns the drop (portal events also bubble here).
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        /*
          Multiple files represent updated screens: "Update screens" matches filenames for review. A single
          file keeps the existing behavior.
        */
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length > 1) {
          openUpdateScreens(files);
          return;
        }
        const file = files[0];
        if (file) handleUpload(file);
      }}
    >
      {dropFile ? (
        <DropChoice
          fileName={dropFile.name}
          onReplace={() => {
            placeMedia(dropFile);
            setDropFile(null);
          }}
          onNewScene={() => {
            const s = useEditor.getState();
            s.addShot();
            placeMedia(dropFile);
            setDropFile(null);
          }}
          onCancel={() => setDropFile(null)}
        />
      ) : null}

      <DevErrorBridge />
      <AutomationHook />
      <Toast />
      <Tour />
      <WhatsNew />
      <PhoneGate />
      <UpdateScreensHost />
      <RedactHost />
      <ProjectsHost />
      <GoalPackHost />

      <div className="flex min-w-0 flex-1 flex-col" style={{ gap: 'var(--mp-gap)' }}>
        <TopBar onUpload={handleUpload} />

        <div className="relative min-h-0 flex-1">
          <Stage />
          {/* In an empty project, first ask what to showcase; only then is the panel meaningful. */}
          <MockupPicker onUpload={handleUpload} />
          <HintStrip onUpload={handleUpload} />
          <ExportCover />
        </div>

        {/*
          No full timeline on narrow screens: drag/trim/keyframe gestures are unsuitable for fingers.
          Explain why rather than showing empty space or disabled controls.
        */}
        {videoMode ? (
          <>
            <div className="max-lg:hidden">
              <Timeline />
            </div>
            <div
              className="mp-label shrink-0 px-3 py-2.5 text-center lg:hidden"
              style={{
                borderRadius: 'var(--mp-radius-lg)',
                border: '1px solid var(--mp-border)',
                background: 'var(--mp-glass)',
                color: 'var(--mp-text-tertiary)',
              }}
            >
              Timeline editing is desktop-only — capture and framing work here
            </div>
          </>
        ) : null}
      </div>

      {/*
        Mobile layout: instead of consuming 40% of a narrow screen, the right panel opens as a drawer
        from the top bar with a translucent backdrop. On wide screens it remains a fixed column.
      */}
      {/*
        Backdrop on narrow screens, only while the drawer is open.
      */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-[600] lg:hidden"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onPointerDown={() => toggleDrawer()}
        />
      ) : null}

      {/*
        One panel instance, with CSS controlling visibility. shrink-0 is required: a shrinking wrapper
        let the top bar overlap the panel (EXPORT over SOURCE). CSS visibility also avoids window-based
        hydration mismatches. lg:flex is required rather than lg:block: a block wrapper grew to fit the
        panel, leaving overflow-y-auto nothing to scroll. The lower 468px, everything below CAMERA,
        became inaccessible. Flex stretches the panel to its container's cross-axis size so it can
        scroll, as max-lg:flex already does on narrow screens.
      */}
      <div
        className={[
          'shrink-0 max-lg:fixed max-lg:inset-y-2 max-lg:right-2 max-lg:z-[601]',
          drawerOpen ? 'max-lg:flex' : 'max-lg:hidden',
          panelOpen ? 'lg:flex' : 'lg:hidden',
        ].join(' ')}
      >
        <PropertiesPanel onUpload={handleUpload} />
      </div>
    </main>
  );
}
