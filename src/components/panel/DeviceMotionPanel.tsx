'use client';

import { Slider } from '@/components/panel/Slider';
import { Segmented, Select, Toggle } from '@/components/panel/Controls';
import { isSlotPath } from '@/config/tracks';
import {
  DEVICE_MOTION_DEFAULT,
  useEditor,
  type DeviceMotionKind,
  type DeviceMotionRecipe,
} from '@/store/editor';

const KINDS: { value: DeviceMotionKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'drop', label: 'Drop in' },
  { value: 'rise', label: 'Rise up' },
  { value: 'slide', label: 'Slide in' },
  { value: 'spin', label: 'Spin in' },
  { value: 'pop', label: 'Pop' },
];

/**
 * PER-DEVICE ANIMATION in the Mockup section, below layout rows. Each change reruns
 * `composeDeviceMotion`, rewriting device slot tracks. They appear as ordinary editable keyframes
 * in the timeline; recomposing overwrites manual edits.
 */
export function DeviceMotionPanel() {
  const shot = useEditor((s) => s.active());
  const compose = useEditor((s) => s.composeDeviceMotion);
  const r: DeviceMotionRecipe = shot.deviceMotion ?? DEVICE_MOTION_DEFAULT;
  const n = 1 + shot.extras.length;
  const devices = [{ key: 'main', label: 'Device 1' }, ...shot.extras.map((e, i) => ({ key: e.id, label: `Device ${i + 2}` }))];
  const anyOn = r.kind !== 'none' || devices.some((d) => r.per[d.key] && r.per[d.key] !== 'none');
  const hasTracks = shot.tracks.some((t) => isSlotPath(t.path));

  const run = (patch: Partial<DeviceMotionRecipe>) => compose({ ...r, ...patch, per: patch.per ?? r.per });

  return (
    <div className="flex flex-col gap-1.5" data-testid="device-motion">
      <Select
        label={n > 1 ? 'Animate devices' : 'Animate device'}
        value={r.kind}
        options={KINDS}
        onChange={(kind) => run({ kind })}
      />
      {anyOn ? (
        <>
          <Slider
            label="Duration"
            value={r.duration}
            min={0.2}
            max={2}
            step={0.05}
            precision={2}
            onChange={(duration) => run({ duration })}
          />
          {n > 1 ? (
            <>
              <Slider
                label="Stagger"
                value={r.stagger}
                min={0}
                max={0.6}
                step={0.01}
                precision={2}
                onChange={(stagger) => run({ stagger })}
              />
              <Segmented
                ariaLabel="Device order"
                value={r.order}
                onChange={(order) => run({ order })}
                options={[
                  { value: 'ltr', label: 'Left first' },
                  { value: 'rtl', label: 'Right first' },
                  { value: 'center', label: 'Center out' },
                ]}
              />
            </>
          ) : null}
          <Toggle label="Exit at the end" checked={r.exit} onChange={(exit) => run({ exit })} />
          {n > 1 ? (
            /* Per-device type: "Same" uses the selection above. */
            <div className="flex flex-col gap-1">
              {devices.map((d) => (
                <Select
                  key={d.key}
                  label={d.label}
                  value={r.per[d.key] ?? 'same'}
                  options={[{ value: 'same', label: 'Same' }, ...KINDS]}
                  onChange={(v) => {
                    const per = { ...r.per };
                    if (v === 'same') delete per[d.key];
                    else per[d.key] = v as DeviceMotionKind;
                    run({ per });
                  }}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {hasTracks && !anyOn ? (
        <span className="mp-label px-1" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9, lineHeight: 1.4 }}>
          Device keyframes are on the timeline — pick a motion to replace them.
        </span>
      ) : null}
    </div>
  );
}
