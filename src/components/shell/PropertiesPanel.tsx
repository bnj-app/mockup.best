'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Slider } from '@/components/panel/Slider';
import {
  Folder,
  Segmented,
  Select,
  Toggle,
  XYPad,
  Badge,
  FileButton,
} from '@/components/panel/Controls';
import { evaluateShot, shotStart, useEditor, VIDEO_RATE, type Shot } from '@/store/editor';
import { animatable } from '@/config/tracks';
import { DEVICES, getDevice } from '@/config/devices';
import { BackgroundPicker } from '@/components/panel/BackgroundPicker';
import { ColorInput } from '@/components/panel/ColorInput';
import { TextPanel } from '@/components/panel/TextPanel';
import { HighlightsPanel } from '@/components/panel/HighlightsPanel';
import { LanguagesPanel } from '@/components/panel/LanguagesPanel';
import { BrandKitPanel } from '@/components/panel/BrandKitPanel';
import { DeviceMotionPanel } from '@/components/panel/DeviceMotionPanel';
import { ENV_PRESETS } from '@/components/scene/environment';
import { STAGE3D } from '@/components/scene/stage3d';
import { EFFECT_DEFS } from '@/components/scene/effectsPass';
import { LAYOUTS } from '@/config/layouts';
import { CAMERA_DEFAULT, CAMERA_LIMITS, CAMERA_POSES, type CameraState } from '@/config/motion';
import { tipOnce, toast } from '@/components/shell/Toast';
import { openUpdateScreens } from '@/components/shell/UpdateScreensModal';
import { openRedact } from '@/components/shell/RedactModal';
import { screenKey } from '@/config/screens';

/**
 * Camera rows. CAMERA_LIMITS is the single source of ranges for sliders,
 * canvas dragging and motion presets.
 */
const CAMERA_ROWS: { field: keyof CameraState; label: string; hint?: string }[] = [
  { field: 'tiltX', label: 'Tilt X', hint: 'drag' },
  { field: 'tiltY', label: 'Tilt Y', hint: 'drag' },
  { field: 'roll', label: 'Roll' },
  { field: 'fov', label: 'FOV' },
  { field: 'zoom', label: 'Zoom', hint: 'scroll' },
  { field: 'panX', label: 'Pan X', hint: 'ctrl drag' },
  { field: 'panY', label: 'Pan Y', hint: 'ctrl drag' },
  { field: 'rotY', label: 'Rotate Y' },
  { field: 'rotX', label: 'Rotate X' },
  { field: 'handheld', label: 'Handheld' },
  // Flap tilts from the bottom edge; Rotate X rotates around the center.
  { field: 'flap', label: 'Flap' },
];


/**
 * Ready-made slider for an ANIMATABLE property.

 * Range, step and label come from config/tracks.ts; the value comes from the
 * evaluated scene and the diamond from the track. To animate a new property,
 * add a table row and an <Anim path=.../> here.
 */
function Anim({
  path,
  label,
  hint,
  shot,
  value,
}: {
  path: string;
  label?: string;
  hint?: string;
  shot: Shot;
  value: number;
}) {
  const spec = animatable(path);
  const setAnimatable = useEditor((s) => s.setAnimatable);
  const toggleTrackKeyframe = useEditor((s) => s.toggleTrackKeyframe);
  const resetAnimatable = useEditor((s) => s.resetAnimatable);
  if (!spec) return null;
  return (
    <Slider
      label={label ?? spec.label}
      hint={hint}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      precision={spec.precision}
      value={value}
      keyframed={shot.tracks.some((t) => t.path === path)}
      onChange={(v) => setAnimatable(path, v)}
      onToggleKeyframe={() => toggleTrackKeyframe(path)}
      onReset={() => resetAnimatable(path)}
    />
  );
}

export function PropertiesPanel({ onUpload }: { onUpload: (file: File) => void }) {
  const shot = useEditor((s) => s.active());
  const patchShot = useEditor((s) => s.patchShot);
  const patchCamera = useEditor((s) => s.patchCamera);
  // Device badges follow ExportMenu: show them only for locked devices.
  // With FREE_FOR_ALL, isPro is true, so the picker shows no "PRO" badge.
  const isPro = useEditor((s) => s.isPro);
  /*
    Property-path animation: setAnimatable edits the keyframe under the
    playhead, or the base value when there is no keyframe.
  */
  const setAnimatable = useEditor((s) => s.setAnimatable);
  const toggleTrackKeyframe = useEditor((s) => s.toggleTrackKeyframe);
  const resetAnimatable = useEditor((s) => s.resetAnimatable);
  /*
    Sliders display the scene evaluated at the playhead.

    Pitfall: do not use s.evaluated() directly as the selector. It returns a
    new object each time; React's useSyncExternalStore compares references,
    causing an infinite render loop. Subscribe to primitives and derive with useMemo.
  */
  const playhead = useEditor((s) => s.playhead);
  const shotStartT = useEditor((s) => shotStart(s.shots, s.activeShotId));
  const localT = Math.min(Math.max(0, playhead - shotStartT), shot.duration);
  const ev = useMemo(() => evaluateShot(shot, localT), [shot, localT]);
  const trackPaths = useEditor(
    (s) => s.active().tracks.map((t) => t.path).join('|'),
    );
  const screenView = useEditor((s) => s.screenView);
  const addScreenScroll = useEditor((s) => s.addScreenScroll);
  const [cameraTab, setCameraTab] = useState<'manual' | 'presets'>('manual');
  const [fxMenu, setFxMenu] = useState(false);
  const fxRef = useRef<HTMLDivElement>(null);
  /*
    Close "+ Add effect" on Escape and outside clicks, like other dropdowns.
    Previously, selecting an effect was the only way to close it.
  */
  useEffect(() => {
    if (!fxMenu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFxMenu(false);
    const onDown = (e: PointerEvent) => {
      const el = fxRef.current;
      if (el && !el.contains(e.target as Node)) setFxMenu(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [fxMenu]);
  const layoutId = useEditor((s) => s.active().layoutId);
  const applyLayout = useEditor((s) => s.applyLayout);
  const setExtraMedia = useEditor((s) => s.setExtraMedia);
  // Number of screens with missing files (one per name), for the restore-all link.
  const missingCount = useEditor((s) => {
    const keys = new Set<string>();
    for (const x of s.shots) {
      if (!x.media && x.mediaName) keys.add(screenKey(x.screenName || x.mediaName));
      for (const e of x.extras) if (!e.media && e.mediaName) keys.add(screenKey(e.screenName || e.mediaName));
    }
    return keys.size;
  });
  const removeExtra = useEditor((s) => s.removeExtra);
  const addEffect = useEditor((s) => s.addEffect);
  const patchEffect = useEditor((s) => s.patchEffect);
  const removeEffect = useEditor((s) => s.removeEffect);

  const trackPathSet = new Set(trackPaths ? trackPaths.split('|') : []);
  const device = getDevice(shot.deviceId);
  /*
     The finish determines which controls are meaningful
     (band color has no rendering effect on glass; see below).
     */
  const finish = device.finishes.find((x) => x.id === shot.finishId) ?? device.finishes[0];
  const [pickingDevice, setPickingDevice] = useState(false);
  const multiCount = useEditor((s) => s.selectedShotIds.length);

  // mp-panel scopes pressed and keyboard-focus styles in globals.css.
  // The old aside selector also affected the photo module's panels.
  return (
    <aside
      className="mp-panel mp-scroll shrink-0 overflow-y-auto p-3"
      style={{
        width: 'var(--mp-panel-w)',
        borderRadius: 'var(--mp-radius-lg)',
        border: '1px solid var(--mp-border)',
        background: 'var(--mp-glass)',
        backdropFilter: 'blur(12px)',
        boxShadow: 'var(--mp-shadow)',
      }}
    >
      {/* MULTIPLE SCENES: panel edits apply to every selected scene. */}
      {multiCount > 1 ? (
        <div
          className="mp-label mb-2 flex items-center justify-between px-2.5"
          style={{ height: 'var(--mp-row-h)', borderRadius: 'var(--mp-radius)', background: 'var(--mp-accent)', color: '#fff' }}
        >
          <span>Editing {multiCount} scenes together</span>
          <button className="mp-label" style={{ color: '#fff' }} onClick={() => useEditor.getState().clearShotSelection()}>
            Done
          </button>
        </div>
      ) : null}
      {/* SOURCE */}
      <div data-tour="source">
      <Folder title="Source">
        {/*
          w-full is required: label filled the available width, but button shrinks
          to its content, which would narrow the drop zone.
        */}
        <FileButton
          accept="image/*,video/*"
          className="grid w-full cursor-pointer place-items-center overflow-hidden"
          style={{
            height: 110,
            borderRadius: 'var(--mp-radius)',
            border: '1px dashed var(--mp-border-hover)',
            background: 'var(--mp-surface)',
          }}
          ariaLabel="Upload media"
          onPick={onUpload}
        >
          {shot.media ? (
            shot.mediaKind === 'video' ? (
              <video src={shot.media} muted className="h-full w-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shot.media} alt="" className="h-full w-full object-cover" />
            )
          ) : (
            <span className="mp-label text-center leading-relaxed">
              Click to upload
              <br />
              <span style={{ color: 'var(--mp-text-tertiary)' }}>drag &amp; drop or paste</span>
            </span>
          )}
        </FileButton>
        {/*
          SCREEN NAME: "Update screens" updates scenes with matching names together.
          Shown for scenes with media or a missing file; an empty scene has no screen to name.
        */}
        {shot.media || shot.mediaName || shot.screenName ? (
          <div className="flex gap-1.5">
            <label
              className="flex min-w-0 flex-1 items-center gap-2 px-2.5"
              style={{
                height: 'var(--mp-row-h)',
                borderRadius: 'var(--mp-radius)',
                background: 'var(--mp-surface)',
              }}
              title="Scenes that show a screen with the same name are updated together"
            >
              <span className="mp-label shrink-0">Screen name</span>
              <input
                value={shot.screenName ?? ''}
                placeholder="e.g. home"
                maxLength={40}
                data-screen-name
                onChange={(e) => patchShot({ screenName: e.target.value.trim() ? e.target.value : null })}
                className="mp-label min-w-0 flex-1 bg-transparent text-right outline-none"
                style={{ color: 'var(--mp-text-primary)' }}
              />
            </label>
            <button
              onClick={() => openUpdateScreens()}
              className="mp-label shrink-0 px-2.5"
              style={{ height: 'var(--mp-row-h)', borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface-active)' }}
              title="Drop new screenshots — every scene with a matching screen name is updated"
            >
              Update…
            </button>
          </div>
        ) : null}
        {/*
          PRIVATE AREAS: cover emails, names and balances before sharing.
          v1 supports images only; frame-by-frame video redaction is separate work.
          The video button stays visible and explains the limitation.
        */}
        {shot.media ? (
          <button
            onClick={() => (shot.mediaKind === 'image' && shot.media ? openRedact(shot.media) : undefined)}
            disabled={shot.mediaKind !== 'image'}
            className="mp-label w-full py-2"
            style={{
              background: 'var(--mp-surface-active)',
              borderRadius: 'var(--mp-radius)',
              opacity: shot.mediaKind === 'image' ? 1 : 0.5,
            }}
            title={
              shot.mediaKind === 'image'
                ? 'Cover emails, names or balances — burned into the image on every scene that uses it'
                : 'Hiding info works on images for now'
            }
            data-redact-open
          >
            {shot.redactions?.length
              ? `Hidden areas (${shot.redactions.length}) — edit…`
              : shot.mediaKind === 'image'
                ? 'Hide private info…'
                : 'Hide private info — images only'}
          </button>
        ) : null}
        {/*
          Crop out the uploaded screenshot's status bar so ours can replace it.
        */}
        {/*
          MISSING MEDIA: autosave preserves file names but cannot retain files.
          After refresh, name the missing file instead of leaving an unexplained
          empty scene, so users know their upload was previously accepted.
        */}
        {!shot.media && shot.mediaName ? (
          <div
            className="mp-label flex items-center gap-2 px-2 py-2"
            style={{
              borderRadius: 'var(--mp-radius)',
              background: 'rgba(255,170,60,0.14)',
              border: '1px dashed rgba(255,170,60,0.8)',
              color: 'var(--mp-text-label)',
            }}
          >
            <span style={{ fontSize: 12 }}>⚠</span>
            <span className="truncate">
              {shot.mediaName} — file missing, upload it again
              {/* Restore multiple missing files in one step. */}
              {missingCount > 1 ? (
                <>
                  {' · '}
                  <button className="underline" onClick={() => openUpdateScreens()}>
                    restore all {missingCount}
                  </button>
                </>
              ) : null}
            </span>
          </div>
        ) : null}

        {/* VIDEO: speed and trimming. */}
        {shot.media && shot.mediaKind === 'video' ? (
          <>
            <Slider
              label="Speed"
              value={shot.playbackRate}
              min={VIDEO_RATE.min}
              max={VIDEO_RATE.max}
              step={0.05}
              precision={2}
              onChange={(playbackRate) => patchShot({ playbackRate })}
            />
            <div className="flex gap-1.5">
              <div className="min-w-0 flex-1">
                <Slider
                  label="Trim in"
                  value={shot.trim.in}
                  min={0}
                  max={60}
                  step={0.1}
                  precision={1}
                  onChange={(v) => patchShot({ trim: { ...shot.trim, in: v } })}
                />
              </div>
              <div className="min-w-0 flex-1">
                <Slider
                  label="Trim out"
                  value={shot.trim.out ?? 60}
                  min={0}
                  max={60}
                  step={0.1}
                  precision={1}
                  onChange={(v) => patchShot({ trim: { ...shot.trim, out: v } })}
                />
              </div>
            </div>
          </>
        ) : null}

        {shot.media ? (
          <>
            <Slider
              label="Crop top"
              value={shot.crop.top}
              min={0}
              max={0.3}
              step={0.001}
              precision={3}
              onChange={(top) => patchShot({ crop: { ...shot.crop, top } })}
            />
            <Slider
              label="Crop bottom"
              value={shot.crop.bottom}
              min={0}
              max={0.3}
              step={0.001}
              precision={3}
              onChange={(bottom) => patchShot({ crop: { ...shot.crop, bottom } })}
            />
            {/*
              SCREEN SCROLL: show when the image is at least 2% taller than the screen,
              or a scroll track already exists, so it can be removed if a device change
              makes the image fit.
            */}
            {screenView < 0.98 || trackPaths.split('|').includes('crop.scroll') ? (
              <>
                <Anim
                  path="crop.scroll"
                  label="Scroll"
                  hint={screenView < 0.98 ? 'tall image' : undefined}
                  shot={shot}
                  // Missing crop data from automation or hand-edited files must not break the slider.
                  value={ev.crop.scroll ?? 0}
                />
                {screenView < 0.98 ? (
                  <button
                    onClick={() => {
                      addScreenScroll();
                      const d = shot.duration;
                      const run = d >= 2 ? d - 2 * Math.min(0.6, d * 0.12) : d;
                      const speed = (1 / screenView - 1) / Math.max(0.1, run);
                      toast(
                        `Screen scroll: top to bottom in ${run.toFixed(1)} s` +
                          (speed > 2 ? ' · long page — lengthen the scene to slow it down' : '') +
                          ' · Ctrl+Z to undo',
                      );
                    }}
                    className="mp-label w-full py-2"
                    style={{ background: 'var(--mp-surface-active)', borderRadius: 'var(--mp-radius)' }}
                  >
                    + Add screen scroll
                  </button>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </Folder>

      </div>

      {/* MOCKUP */}
      <div data-tour="mockup">
      <Folder title="Mockup">
        {pickingDevice ? (
          <div className="grid grid-cols-2 gap-1.5">
            {/*
              CANCEL: closing the picker previously required selecting a device.
              Users changing their minds had to find the current device and trigger
              an unnecessary "ideal media" notification.
            */}
            <div className="col-span-2 flex items-center justify-between px-1">
              <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
                Choose a device
              </span>
              <button
                onClick={() => setPickingDevice(false)}
                className="mp-label px-2 py-1"
                style={{ background: 'var(--mp-surface-active)', borderRadius: 6 }}
              >
                Cancel
              </button>
            </div>
            {/* GROUPED: Phones / Tablets / Laptops / Watches / Displays. */}
            {groupedDevices().map(({ d, header }) => [
              header ? (
                <div
                  key={`h-${header}`}
                  className="mp-label col-span-2 px-1 pt-1.5"
                  style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}
                >
                  {header}
                </div>
              ) : null,
              (
              <button
                key={d.id}
                onClick={() => {
                  patchShot({ deviceId: d.id, finishId: d.finishes[0].id });
                  setPickingDevice(false);
                  // Show the required image dimensions when the device is selected.
                  toast(
                    d.idealMedia
                      ? `${d.label} — ideal media ${d.idealMedia.w.toLocaleString()} × ${d.idealMedia.h.toLocaleString()}`
                      : `${d.label} — any media size`,
                  );
                }}
                className="relative overflow-hidden p-2 text-left"
                style={{
                  borderRadius: 'var(--mp-radius)',
                  background: 'var(--mp-surface)',
                  border: `1px solid ${d.id === shot.deviceId ? 'var(--mp-accent)' : 'transparent'}`,
                }}
              >
                {isPro ? null : (
                  <span className="absolute right-1.5 top-1.5">
                    <Badge tone={d.pro ? 'pro' : 'free'} />
                  </span>
                )}
                {/* Silhouette uses the actual body ratio; a blank gray card did not identify the device. */}
                <span className="grid h-14 place-items-center">
                  <DeviceSilhouette device={d} box={40} />
                </span>
                <span className="mp-label block">{d.label}</span>
              </button>
            ),
            ])}
          </div>
        ) : (
          <div
            className="flex items-center gap-2.5 p-2"
            style={{ borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface)' }}
          >
            {/*
              Show the selected device's silhouette in the summary row, too.
              A blank gray square did not identify the device.
            */}
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded"
              style={{ background: 'var(--mp-surface-active)' }}
              aria-hidden
            >
              <DeviceSilhouette
                device={device}
                box={24}
                landscape={shot.deviceOpts.landscape && (device.kind === 'phone' || device.kind === 'tablet')}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="mp-label block" style={{ color: 'var(--mp-text-primary)' }}>
                {device.label}
              </span>
              <span className="mp-label block" style={{ color: 'var(--mp-text-tertiary)' }}>
                {device.idealMedia
                  ? `${device.idealMedia.w.toLocaleString()} × ${device.idealMedia.h.toLocaleString()}`
                  : 'any size'}
              </span>
            </span>
            <button
              onClick={() => setPickingDevice(true)}
              title="Choose another device"
              className="mp-label px-2 py-1"
              style={{ background: 'var(--mp-surface-active)', borderRadius: 6 }}
            >
              Change
            </button>
          </div>
        )}

        {/*
          Layouts place multiple devices in one scene. Extra devices inherit the
          main device's media so a new layout immediately shows populated screens.
          Each screen can then receive separate media.
        */}
        <Select
          label="Layout"
          value={layoutId}
          options={LAYOUTS.map((l) => ({ value: l.id, label: l.label }))}
          onChange={(id) => {
            applyLayout(id);
            /*
              Changing layouts clears slot tracks, which contain the old positions.
              If device motion is enabled, recompose the same recipe for the new layout.
              Both writes occur within 350 ms and form one undo step.
            */
            const m = useEditor.getState().active().deviceMotion;
            if (m && (m.kind !== 'none' || Object.keys(m.per).length)) useEditor.getState().composeDeviceMotion(m);
          }}
        />

        {shot.extras.length ? (
          <div className="flex flex-col gap-1">
            {shot.extras.map((e, i) => (
              <div
                key={e.id}
                className="flex items-center gap-1 px-2"
                style={{
                  height: 'var(--mp-row-h)',
                  borderRadius: 'var(--mp-radius)',
                  background: 'var(--mp-surface)',
                }}
              >
                <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }}>
                  {i + 2}
                </span>
                <FileButton
                  accept="image/*,video/*"
                  className="mp-label flex-1 cursor-pointer truncate text-left"
                  style={{ color: e.media ? 'var(--mp-text-primary)' : undefined }}
                  ariaLabel={`Set screen for device ${i + 2}`}
                  onPick={(f) =>
                    setExtraMedia(e.id, URL.createObjectURL(f), f.type.startsWith('video/') ? 'video' : 'image', f.name)
                  }
                >
                  {/* Do not label a missing extra-device file as the main screen after autosave. */}
                  {e.media
                    ? e.screenName || 'Own screen'
                    : e.mediaName
                      ? `${e.screenName || e.mediaName} — file missing`
                      : 'Use main screen'}
                </FileButton>
                <button
                  onClick={() => removeExtra(e.id)}
                  className="mp-label"
                  style={{ color: 'var(--mp-text-tertiary)' }}
                  aria-label={`Remove device ${i + 2}`}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {/* PER-DEVICE ANIMATION: entrance motion also works with a single device. */}
        <DeviceMotionPanel />

        {/*
          FLAT has its own thickness control. Keep it outside kind !== 'flat';
          placing it inside that block hides it entirely.
        */}
        {device.kind === 'flat' ? (
          <Anim path="deviceOpts.depth" label="Depth" shot={shot} value={ev.deviceOpts.depth} />
        ) : null}
        {device.kind !== 'flat' ? (
          <>
            <Select
              label="Finish"
              value={shot.finishId}
              options={device.finishes.map((f) => ({ value: f.id, label: f.label }))}
              onChange={(finishId) => patchShot({ finishId })}
            />
            {/*
              DEVICE-SPECIFIC CONTROLS: notch for phones, lid angle for laptops,
              band for watches. Use device capability flags instead of one fixed form,
              so adding a device does not require new panel conditions.
            */}
            {device.kind === 'phone' || (device.kind === 'laptop' && device.model) ? (
              <Toggle
                label="Notch"
                checked={shot.deviceOpts.notch}
                onChange={(notch) =>
                  patchShot({ deviceOpts: { ...shot.deviceOpts, notch } })
                }
              />
            ) : null}
            {device.features?.base ? (
              <Anim
                path="deviceOpts.lidAngle"
                label="Lid angle"
                shot={shot}
                value={ev.deviceOpts.lidAngle}
              />
            ) : null}
            {/* Monitor: tilt the panel at the stand hinge (clamped to -5...25 degrees). */}
            {device.kind === 'monitor' && device.model ? (
              <Anim
                path="deviceOpts.lidAngle"
                label="Screen tilt"
                shot={shot}
                value={ev.deviceOpts.lidAngle}
              />
            ) : null}
            {/*
              ORIENTATION: phones and tablets rotate while the screenshot stays upright
              and fits the new shape. Ideal dimensions also follow orientation.
            */}
            {device.kind === 'phone' || device.kind === 'tablet' ? (
              <Segmented
                ariaLabel="Orientation"
                value={shot.deviceOpts.landscape ? 'landscape' : 'portrait'}
                options={[
                  { value: 'portrait', label: 'Portrait' },
                  { value: 'landscape', label: 'Landscape' },
                ]}
                onChange={(v) =>
                  patchShot({ deviceOpts: { ...shot.deviceOpts, landscape: v === 'landscape' } })
                }
              />
            ) : null}
            <Slider
              label="Media size"
              value={shot.deviceOpts.mediaSize ?? 1}
              min={0.4}
              max={1}
              step={0.01}
              precision={2}
              onChange={(mediaSize) => patchShot({ deviceOpts: { ...shot.deviceOpts, mediaSize } })}
            />
            {/*
              SCREEN UI for laptops/monitors: menu bar, Dock and browser window.
              Present website/SaaS screenshots as if opened on a desktop.
            */}
            {device.kind === 'laptop' || device.kind === 'monitor' ? (
              <>
                <Toggle
                  label="Menu bar"
                  checked={shot.deviceOpts.screenUi?.menuBar ?? false}
                  onChange={(menuBar) =>
                    patchShot({ deviceOpts: { ...shot.deviceOpts, screenUi: { ...shot.deviceOpts.screenUi, menuBar } } })
                  }
                />
                <Toggle
                  label="Dock"
                  checked={shot.deviceOpts.screenUi?.dock ?? false}
                  onChange={(dock) =>
                    patchShot({ deviceOpts: { ...shot.deviceOpts, screenUi: { ...shot.deviceOpts.screenUi, dock } } })
                  }
                />
                <Toggle
                  label="Browser frame"
                  checked={shot.deviceOpts.screenUi?.browser ?? false}
                  onChange={(browser) =>
                    patchShot({ deviceOpts: { ...shot.deviceOpts, screenUi: { ...shot.deviceOpts.screenUi, browser } } })
                  }
                />
                {shot.deviceOpts.screenUi?.browser ? (
                  <label
                    className="flex items-center justify-between gap-2 px-2.5"
                    style={{ height: 'var(--mp-row-h)', borderRadius: 'var(--mp-radius)', background: 'var(--mp-surface)' }}
                  >
                    <span className="mp-label shrink-0">Address</span>
                    <input
                      value={shot.deviceOpts.screenUi.address}
                      maxLength={60}
                      onChange={(e) =>
                        patchShot({
                          deviceOpts: { ...shot.deviceOpts, screenUi: { ...shot.deviceOpts.screenUi, address: e.target.value } },
                        })
                      }
                      className="mp-label min-w-0 flex-1 bg-transparent text-right outline-none"
                      style={{ color: 'var(--mp-text-primary)', textTransform: 'none' }}
                    />
                  </label>
                ) : null}
              </>
            ) : null}
            {/* iPad: keyboard base gives the device a laptop stance. */}
            {device.kind === 'tablet' ? (
              <Toggle
                label="Case & keyboard"
                checked={shot.deviceOpts.keyboard}
                onChange={(keyboard) =>
                  patchShot({ deviceOpts: { ...shot.deviceOpts, keyboard } })
                }
              />
            ) : null}
            {/*
              SCREEN BACKGROUND: separate from the scene backdrop. Fills empty space
              around transparent PNGs or images smaller than the screen.
              Nothing is drawn when disabled.
            */}
            <label
              className="flex items-center justify-between px-2.5"
              style={{
                height: 'var(--mp-row-h)',
                borderRadius: 'var(--mp-radius)',
                background: 'var(--mp-surface)',
              }}
            >
              <span className="mp-label">Screen background</span>
              <span className="flex items-center gap-1.5">
                {shot.deviceOpts.screenBg ? (
                  <button
                    className="mp-label"
                    style={{ color: 'var(--mp-text-tertiary)' }}
                    onClick={() =>
                      patchShot({ deviceOpts: { ...shot.deviceOpts, screenBg: null } })
                    }
                  >
                    clear
                  </button>
                ) : null}
                <ColorInput
                  label="Screen background"
                  value={shot.deviceOpts.screenBg ?? '#ffffff'}
                  onChange={(screenBg) => patchShot({ deviceOpts: { ...shot.deviceOpts, screenBg } })}
                />
              </span>
            </label>
            {/*
              BAND COLOR IS AVAILABLE ONLY FOR METAL FINISHES.

              Stage.tsx deliberately draws glass bands white to preserve their appearance.
              The picker did nothing on glass, the watch's default finish: measured pixel
              difference between extreme colors was 0.000 on glass and 20+ on metal.

              Hide the row for glass. Controls with no visible effect make the editor
              appear broken, as with orientation for custom/App Store dimensions.
            */}
            {device.features?.band && finish.kind !== 'glass' ? (
              <label
                className="flex items-center justify-between px-2.5"
                style={{
                  height: 'var(--mp-row-h)',
                  borderRadius: 'var(--mp-radius)',
                  background: 'var(--mp-surface)',
                }}
              >
                <span className="mp-label">Band color</span>
                <ColorInput
                  label="Band color"
                  value={shot.deviceOpts.bandColor}
                  onChange={(bandColor) => patchShot({ deviceOpts: { ...shot.deviceOpts, bandColor } })}
                />
              </label>
            ) : null}
            <Anim path="light.rotation" label="Light rotation" shot={shot} value={ev.light.rotation} />
            <Anim path="light.key" label="Key light" shot={shot} value={ev.light.key} />
            <Slider
              label="Key height"
              value={shot.light.keyHeight}
              min={0}
              max={15}
              step={0.1}
              precision={1}
              onChange={(keyHeight) => patchShot({ light: { ...shot.light, keyHeight } })}
            />
            {/*
              Environment rotation moves glass edge highlights without changing the
              device pose or framing.
            */}
            <Slider
              label="Env rotation"
              hint="drag"
              value={shot.light.envRotation}
              min={0}
              max={360}
              step={1}
              precision={0}
              onChange={(envRotation) => patchShot({ light: { ...shot.light, envRotation } })}
            />
            {/* Light rotation X moves the light vertically. */}
            <Slider
              label="Env tilt"
              value={shot.light.envTilt ?? 0}
              min={-60}
              max={60}
              step={1}
              precision={0}
              onChange={(envTilt) => patchShot({ light: { ...shot.light, envTilt } })}
            />
            <Slider
              label="Env intensity"
              value={shot.light.envIntensity}
              min={0}
              max={3}
              onChange={(envIntensity) => patchShot({ light: { ...shot.light, envIntensity } })}
            />
            <Slider
              label="Lift"
              value={shot.light.lift}
              min={0}
              max={6}
              onChange={(lift) => patchShot({ light: { ...shot.light, lift } })}
            />
            <Slider
              label="Reflection"
              value={shot.light.reflection}
              min={0}
              max={1}
              onChange={(reflection) => patchShot({ light: { ...shot.light, reflection } })}
            />
            {/*
              SCREEN GLOW: color is sampled from user media, or the screen background
              when media is absent. This control sets intensity and is animatable,
              allowing a screen to light up in the dark.

              Show the hint unless Studio is 'screenlit': bright studios make the effect
              subtle, so guide users to a scene where it is visible.
            */}
            <Anim
              path="light.screenGlow"
              label="Screen glow"
              shot={shot}
              value={ev.light.screenGlow}
            />
            {ev.light.screenGlow > 0.001 && shot.scene.envId !== 'screenlit' ? (
              <span className="mp-label px-2.5" style={{ color: 'var(--mp-text-tertiary)' }}>
                Strongest with the Screen-lit studio
              </span>
            ) : null}
            <Toggle
              label="Contact shadow"
              checked={shot.light.contactShadow}
              onChange={(contactShadow) => patchShot({ light: { ...shot.light, contactShadow } })}
            />
            {shot.light.contactShadow ? (
              <>
                <Slider
                  label="Shadow blur"
                  value={shot.light.shadowBlur}
                  min={0.2}
                  max={8}
                  onChange={(shadowBlur) => patchShot({ light: { ...shot.light, shadowBlur } })}
                />
                <Slider
                  label="Shadow opacity"
                  value={shot.light.shadowOpacity}
                  min={0}
                  max={1}
                  onChange={(shadowOpacity) =>
                    patchShot({ light: { ...shot.light, shadowOpacity } })
                  }
                />
                <Slider
                  label="Shadow offset"
                  value={shot.light.shadowOffset}
                  min={-0.2}
                  max={0.4}
                  onChange={(shadowOffset) => patchShot({ light: { ...shot.light, shadowOffset } })}
                />
              </>
            ) : null}

            {/* Status bar: replace the user's own time/battery in the screenshot. */}
            <Toggle
              label="Status bar"
              checked={shot.statusBar.on}
              onChange={(on) => patchShot({ statusBar: { ...shot.statusBar, on } })}
            />
            {shot.statusBar.on ? (
              <>
                <div
                  className="flex items-center gap-2 px-2.5"
                  style={{
                    height: 'var(--mp-row-h)',
                    borderRadius: 'var(--mp-radius)',
                    background: 'var(--mp-surface)',
                  }}
                >
                  <span className="mp-label flex-1">Time</span>
                  <input
                    value={shot.statusBar.time}
                    onChange={(e) =>
                      patchShot({ statusBar: { ...shot.statusBar, time: e.target.value } })
                    }
                    className="mp-label w-16 bg-transparent text-right outline-none"
                    style={{ color: 'var(--mp-text-primary)' }}
                  />
                </div>
                <Toggle
                  label="Light icons"
                  checked={shot.statusBar.dark}
                  onChange={(dark) => patchShot({ statusBar: { ...shot.statusBar, dark } })}
                />
                <Slider
                  label="Battery"
                  value={shot.statusBar.battery}
                  min={0}
                  max={1}
                  onChange={(battery) => patchShot({ statusBar: { ...shot.statusBar, battery } })}
                />
              </>
            ) : null}
          </>
        ) : null}
      </Folder>
      </div>

      {/*
        TEXT & LAYERS belongs at the top level.

        Nesting it inside a collapsed Scene > LAYERS section made it hard to find.
        Text is an independent task rather than a backdrop setting.
      */}
      <Folder title="Text" defaultOpen={false}>
        {/* Brand kit: browser-local logo, colors and fonts; collapsed initially. */}
        <BrandKitPanel />
        <TextPanel />
        {/* Languages: base and additional languages, preview language, CSV round-trip. */}
        <LanguagesPanel />
      </Folder>

      {/* HIGHLIGHTS: screen-attached taps, rings, spotlights and cursors. */}
      <Folder title="Highlights" defaultOpen={false}>
        <HighlightsPanel />
      </Folder>

      {/* CAMERA */}
      <Folder title="Camera" onReset={() => patchCamera({ ...CAMERA_DEFAULT })}>
        <Segmented
          ariaLabel="Camera mode"
          value={cameraTab}
          onChange={setCameraTab}
          options={[
            { value: 'manual', label: 'Manual' },
            { value: 'presets', label: 'Presets' },
          ]}
        />

        {cameraTab === 'manual' ? (
          CAMERA_ROWS.map((row) => (
            <Slider
              key={row.field}
              label={row.label}
              hint={row.hint}
              min={CAMERA_LIMITS[row.field].min}
              max={CAMERA_LIMITS[row.field].max}
              step={CAMERA_LIMITS[row.field].step}
              precision={CAMERA_LIMITS[row.field].precision}
              /*
                Use the evaluated scene so sliders show the actual value at the playhead
                during animation. Base values could disagree with the rendered scene.
              */
              value={ev.camera[row.field]}
              keyframed={trackPathSet.has(`camera.${row.field}`)}
              onChange={(v) => setAnimatable(`camera.${row.field}`, v)}
              onToggleKeyframe={() => toggleTrackKeyframe(`camera.${row.field}`)}
              onReset={() => resetAnimatable(`camera.${row.field}`)}
            />
          ))
        ) : (
          /*
            POSE buttons: five centered framing presets applied in one click.
            Motion presets (scan/zoom animations) were previously placed here by mistake;
            poses and animation serve different purposes.
          */
          <div className="grid grid-cols-2 gap-1.5">
            {CAMERA_POSES.map((p) => (
              <button
                key={p.id}
                onClick={() => patchCamera(p.camera)}
                className="mp-label px-2 py-2.5 text-center"
                style={{ background: 'var(--mp-surface)', borderRadius: 'var(--mp-radius)' }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </Folder>

      {/* BLUR */}
      <Folder title="Blur" defaultOpen={false}>
        <Select
          label="Mode"
          value={shot.blur.mode}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'radial', label: 'Radial' },
            { value: 'linear', label: 'Linear' },
            { value: 'lens', label: 'Lens (depth)' },
          ]}
          onChange={(mode) => patchShot({ blur: { ...shot.blur, mode } })}
        />
        {/*
          Hide secondary settings when MODE = OFF. PostProcessing.tsx disables the
          whole pass with mode !== 'off', so five sliders and a focus pad had no effect.
          Keep values and keyframe tracks in the model to restore when a mode is selected.
        */}
        {shot.blur.mode !== 'off' ? (
          <>
          {/* Angle only applies to linear mode: it orients the tilt-shift band. */}
          {shot.blur.mode === 'linear' ? (
            <Slider
              label="Angle"
              value={shot.blur.angle}
              min={0}
              max={180}
              step={1}
              precision={0}
              onChange={(angle) => patchShot({ blur: { ...shot.blur, angle } })}
            />
          ) : null}
          {/*
            Cap at 60: higher values leave sampling artifacts in a single blur pass.
            Values up to 60 are clean; product shots usually use 10-30.
          */}
          <Anim path="blur.strength" label="Strength" shot={shot} value={ev.blur.strength} />
          <Anim path="blur.focusSize" label="Focus size" shot={shot} value={ev.blur.focusSize} />
          <Anim path="blur.falloff" label="Falloff" shot={shot} value={ev.blur.falloff} />
          <Toggle
            label="Bokeh"
            checked={shot.blur.bokeh}
            onChange={(bokeh) => patchShot({ blur: { ...shot.blur, bokeh } })}
          />
          <span className="mp-label mt-1">Focus position</span>
          <XYPad
            x={shot.blur.fx}
            y={shot.blur.fy}
            onChange={(fx, fy) => patchShot({ blur: { ...shot.blur, fx, fy } })}
          />
          </>
        ) : null}
      </Folder>

      {/* SCENE: backdrop and studio. */}
      <Folder title="Scene" defaultOpen={false}>
        <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
          BACKGROUND
        </span>
        <BackgroundPicker
          value={shot.scene.backgroundId}
          onChange={(backgroundId) => patchShot({ scene: { ...shot.scene, backgroundId } })}
        />
        {/*
          Studio and backdrop are independent: the backdrop colors the frame,
          while the studio determines glass and metal reflections. This allows
          a dark backdrop with bright reflections.
        */}
        <Select
          label="Studio"
          value={shot.scene.envId}
          options={ENV_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          onChange={(envId) => patchShot({ scene: { ...shot.scene, envId } })}
        />
        {/*
          3D SCENE: place the device on a real floor. A preset supplies a matching
          floor color and photo-studio lighting for a ready-to-use shot;
          each setting can then be adjusted independently.
        */}
        <Select
          label="3D scene"
          value={shot.scene.stage3d ?? 'none'}
          options={STAGE3D.map((p) => ({ value: p.id, label: p.label }))}
          onChange={(stage3d) => {
            const preset = STAGE3D.find((p) => p.id === stage3d);
            patchShot({
              scene: {
                ...shot.scene,
                stage3d,
                ...(preset && preset.backgroundId
                  ? { backgroundId: preset.backgroundId, bgImage: null, envId: 'photo' }
                  : {}),
              },
            });
          }}
        />
        {/* Custom backdrop image overrides the gradient and supports BG blur. */}
        <div
          className="flex items-center gap-2 px-2.5"
          style={{
            height: 'var(--mp-row-h)',
            borderRadius: 'var(--mp-radius)',
            background: 'var(--mp-surface)',
          }}
        >
          <span className="mp-label flex-1">BG image</span>
          {shot.scene.bgImage ? (
            <button
              onClick={() => patchShot({ scene: { ...shot.scene, bgImage: null } })}
              className="mp-label"
              style={{ color: 'var(--mp-text-tertiary)' }}
              title="Remove background image"
            >
              ✕ Remove
            </button>
          ) : (
            <FileButton
              accept="image/*"
              className="mp-label cursor-pointer"
              style={{ color: 'var(--mp-text-primary)' }}
              ariaLabel="Upload background image"
              onPick={(f) =>
                patchShot({ scene: { ...shot.scene, bgImage: URL.createObjectURL(f) } })
              }
            >
              Upload
            </FileButton>
          )}
        </div>
        {/*
          BG BLUR ONLY APPLIES TO CUSTOM BACKDROP IMAGES. Stage.tsx uses
          bgImage ? bgBlur : 0; on a gradient, the slider had no visible effect.
        */}
        {shot.scene.bgImage ? (
          <Slider
            label="BG blur"
            value={shot.scene.bgBlur}
            min={0}
            max={1}
            onChange={(bgBlur) => patchShot({ scene: { ...shot.scene, bgBlur } })}
          />
        ) : null}
        {/*
          Use the same "Transparent background" label as the export dialog:
          both edit scene.transparent, and different labels suggested separate settings.

          The pro badge replaced the toggle, hiding whether the setting was enabled.
          It also implied a restriction that did not exist: transparency was never
          plan-gated, and the export dialog offered it without a badge.
        */}
        <Toggle
          label="Transparent background"
          checked={shot.scene.transparent}
          onChange={(transparent) => patchShot({ scene: { ...shot.scene, transparent } })}
        />
      </Folder>

      {/* EFFECTS: addable effect stack. */}
      <Folder title="Effects" defaultOpen={false}>
        <div className="relative" ref={fxRef}>
          <button
            onClick={() => setFxMenu((v) => !v)}
            className="mp-label w-full py-2"
            style={{ background: 'var(--mp-surface-active)', borderRadius: 'var(--mp-radius)' }}
          >
            + Add effect
          </button>
          {fxMenu ? (
            <div
              className="absolute left-0 right-0 z-50 mt-1 p-1"
              style={{
                background: 'var(--mp-dropdown)',
                border: '1px solid var(--mp-border)',
                borderRadius: 'var(--mp-radius)',
                boxShadow: 'var(--mp-shadow-dropdown)',
              }}
            >
              {EFFECT_DEFS.filter((d) => !shot.effects.some((e) => e.id === d.id)).map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    addEffect(d.id, d.def);
                    setFxMenu(false);
                    // Explain once that effects belong to individual scenes,
                    // so users know why an effect is absent from another scene.
                    if (useEditor.getState().shots.length > 1) {
                      tipOnce('effects-scope', 'Effects apply to the selected scene, not all scenes.');
                    }
                  }}
                  className="mp-label w-full rounded px-2 py-1.5 text-left"
                >
                  {d.label}
                </button>
              ))}
              {shot.effects.length === EFFECT_DEFS.length ? (
                <span className="mp-label block px-2 py-1.5" style={{ color: 'var(--mp-text-tertiary)' }}>
                  All added
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {shot.effects.map((e) => {
          const def = EFFECT_DEFS.find((d) => d.id === e.id);
          if (!def) return null;
          return (
            <div key={e.id} className="flex items-center gap-1">
              <div className="min-w-0 flex-1" style={{ opacity: e.on ? 1 : 0.4 }}>
                <Slider
                  label={def.label}
                  value={e.value}
                  min={def.min}
                  max={def.max}
                  onChange={(value) => patchEffect(e.id, { value })}
                />
              </div>
              <button
                onClick={() => patchEffect(e.id, { on: !e.on })}
                className="mp-label px-1"
                style={{ color: e.on ? 'var(--mp-text-primary)' : 'var(--mp-text-tertiary)' }}
                aria-label={`${e.on ? 'Disable' : 'Enable'} ${def.label}`}
                title={e.on ? 'Disable' : 'Enable'}
              >
                {e.on ? '◉' : '○'}
              </button>
              <button
                onClick={() => removeEffect(e.id)}
                className="mp-label px-1"
                style={{ color: 'var(--mp-text-tertiary)' }}
                aria-label={`Remove ${def.label}`}
                title="Remove"
              >
                ✕
              </button>
            </div>
          );
        })}
      </Folder>

      {/* BORDER */}
      <Folder title="Border" defaultOpen={false}>
        {/*
          ORDER: style first, then the settings it enables. Stage.tsx (deviceRaw):
          - Real devices with style === 'none' use the factory appearance, so radius
            and width do nothing. The style selector used to sit below those controls.
          - FLAT cards still use radius with 'none'; width only matters with a border.
          "Glass width" was misleading for Solid: both styles use the same border thickness.
        */}
        <Select
          label="Border style"
          value={shot.border.style}
          options={[
            { value: 'none', label: 'None' },
            { value: 'glass', label: 'Glass' },
            { value: 'solid', label: 'Solid' },
          ]}
          onChange={(style) => patchShot({ border: { ...shot.border, style } })}
        />
        {shot.border.style !== 'none' || device.kind === 'flat' ? (
          <Slider
            label={device.kind === 'flat' ? 'Corner radius' : 'Screen radius'}
            value={shot.border.radius}
            min={0}
            max={0.5}
            step={0.001}
            precision={3}
            onChange={(radius) => patchShot({ border: { ...shot.border, radius } })}
          />
        ) : null}
        {shot.border.style !== 'none' ? (
          <Slider
            label={device.kind === 'flat' ? 'Frame width' : 'Bezel width'}
            value={shot.border.width}
            min={0}
            max={12}
            step={1}
            precision={0}
            onChange={(width) => patchShot({ border: { ...shot.border, width } })}
          />
        ) : (
          <span className="mp-label px-2.5" style={{ color: 'var(--mp-text-tertiary)' }}>
            {device.kind === 'flat' ? 'Pick a style to add a frame' : 'Pick a style to reshape the bezel'}
          </span>
        )}
      </Folder>
    </aside>
  );
}


/**
 * Small silhouette using the device's actual body ratio (picker and summary).
 * box is the square containing the longest edge, in pixels.
 */
function DeviceSilhouette({
  device: d,
  box,
  landscape = false,
}: {
  device: (typeof DEVICES)[number];
  box: number;
  /** Rotate the body in landscape so the summary matches the scene. */
  landscape?: boolean;
}) {
  const a = landscape ? d.body.h / d.body.w : d.body.w / d.body.h;
  let w = Math.min(box * 1.15, box * a);
  let h = w / a;
  if (h > box) {
    h = box;
    w = box * a;
  }
  const r = Math.max(2, Math.min(w, h) * (d.body.radius / Math.min(d.body.w, d.body.h)));
  return (
    <span
      style={{
        width: w,
        height: h,
        borderRadius: r,
        background: 'linear-gradient(150deg, rgba(28,32,44,0.9), rgba(28,32,44,0.65))',
        border: '1px solid rgba(255,255,255,0.4)',
        boxShadow: box < 30 ? '0 1px 3px rgba(0,0,0,0.25)' : '0 3px 8px rgba(0,0,0,0.25)',
      }}
    />
  );
}

/** Group devices by type and attach a heading to each group's first item. */
const GROUPS: [string, string[]][] = [
  ['Flat', ['flat']],
  ['Phones', ['phone']],
  ['Tablets', ['tablet']],
  ['Laptops', ['laptop']],
  ['Watches', ['watch']],
  ['Displays', ['monitor']],
];
function groupedDevices() {
  const out: { d: (typeof DEVICES)[number]; header: string | null }[] = [];
  for (const [title, kinds] of GROUPS) {
    const list = DEVICES.filter((d) => kinds.includes(d.kind));
    list.forEach((d, i) => out.push({ d, header: i === 0 ? title : null }));
  }
  return out;
}
