'use client';

import { usePhoto } from '@photo/store/photo';
import { assetUrl, type PhotoAsset } from '@photo/lib/assets';
import { DEVICES, DEVICE_BORDERS } from '@photo/config/ui';
import { Card, Row, SectionLabel, Seg } from './ui';
import { Icons } from './icons';

/**
 * All editor assets are available without locks, including the eighth hand (no badge, full opacity,
 * no dialog). Pro differs only in output: free exports have a watermark at 1080; Pro exports are
 * clean at 2160. Therefore lock badges were removed here.
 */

/**
 * Device thumbnail: a generic body drawn in code rather than a photo. Show only the phone's top,
 * with a thin dark outline, white interior and open bottom edge. A solid black miniature phone
 * looked too heavy.
 */
function DeviceThumb({ radius, accent, body }: { radius: number; accent?: boolean; body: string }) {
  const w = 58;
  return (
    <div
      style={{
        width: w,
        height: 40,
        borderTopLeftRadius: w * radius,
        borderTopRightRadius: w * radius,
        borderTop: `2px solid ${accent ? body : 'rgba(var(--ink),.45)'}`,
        borderLeft: `2px solid ${accent ? body : 'rgba(var(--ink),.45)'}`,
        borderRight: `2px solid ${accent ? body : 'rgba(var(--ink),.45)'}`,
        background: '#fff',
      }}
    />
  );
}

function PhotoGrid({ items }: { items: PhotoAsset[] }) {
  const { source, setSource } = usePhoto();
  return (
    <Row>
      <div className="grid grid-cols-3 gap-3">
        {items.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSource({ kind: 'photo', id: a.id })}
            // Accessible labels: "Select hand mockup 3" / "Select scene mockup 7".
            aria-label={`Select ${a.kind} mockup ${a.id.split('-')[1]}`}
            title={a.label}
            className="relative aspect-square overflow-hidden cursor-pointer transition-all"
            style={{
              borderRadius: 8,
              outline: `1px solid ${source?.kind === 'photo' && source.id === a.id ? 'var(--foreground)' : 'rgba(var(--ink),.1)'}`,
              outlineOffset: 0,
            }}
          >
            {/* The thumbnail has a screen cutout too; put light gray underneath so the screen looks white. */}
            <div className="absolute inset-0" style={{ background: '#f2f2f2' }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assetUrl(a, 'thumb')}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          </button>
        ))}
      </div>
    </Row>
  );
}

export function LeftPanel() {
  const { assets, source, setSource, deviceBorder, showStatusBar, showIsland, set } = usePhoto();
  const hands = assets.filter((a) => a.kind === 'hand');
  const scenes = assets.filter((a) => a.kind === 'scene');

  return (
    <div className="space-y-4">
      <Card>
        <SectionLabel icon={Icons.device}>DEVICE</SectionLabel>
        <Row>
          <div className="flex gap-2">
            {DEVICE_BORDERS.map((b) => (
              <Seg
                key={b}
                // Both switch to bodyless mode; only the ring differs.
                active={source?.kind === 'bare' && deviceBorder === b}
                onClick={() => set({ deviceBorder: b, source: { kind: 'bare' } })}
              >
                {b}
              </Seg>
            ))}
          </div>
        </Row>
        {/*
          Status-bar toggle. The store setting always existed but was never exposed: the bar stayed on,
          drawing a second bar over the screenshot's own status bar. It also appeared in output because
          exportImage reads s.showStatusBar.
        */}
        <SectionLabel icon={Icons.phone}>STATUS BAR</SectionLabel>
        <Row>
          <div className="flex gap-2">
            <Seg active={!showStatusBar} onClick={() => set({ showStatusBar: false })}>
              Off
            </Seg>
            <Seg active={showStatusBar} onClick={() => set({ showStatusBar: true })}>
              On
            </Seg>
          </div>
        </Row>
        {/*
          Island toggle, paired with the status-bar toggle. If the screenshot includes its own island, the
          frame's island overlaps it and creates a double mark. ⚠️ Keep this below STATUS BAR: the
          status-bar probe treats the first 'On' button as the status-bar control.
        */}
        <SectionLabel icon={Icons.phone}>DYNAMIC ISLAND</SectionLabel>
        <Row>
          <div className="flex gap-2">
            <Seg active={!showIsland} onClick={() => set({ showIsland: false })}>
              Off
            </Seg>
            <Seg active={showIsland} onClick={() => set({ showIsland: true })}>
              On
            </Seg>
          </div>
        </Row>
      </Card>

      <Card>
        <SectionLabel icon={Icons.phone}>PHONE</SectionLabel>
        <Row>
          <div className="grid grid-cols-3 gap-3">
            {DEVICES.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSource({ kind: 'device', id: d.id })}
                className="relative flex flex-col items-center justify-end gap-1 py-2 cursor-pointer transition-all"
                style={{
                  borderRadius: 8,
                  outline: `1px solid ${source?.kind === 'device' && source.id === d.id ? 'var(--foreground)' : 'rgba(var(--ink),.1)'}`,
                }}
              >
                <DeviceThumb radius={d.radius} body={d.body} accent={source?.kind === 'device' && source.id === d.id} />
                <span className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                  {d.label}
                </span>
              </button>
            ))}
          </div>
        </Row>
      </Card>

      {hands.length > 0 && (
        <Card>
          <SectionLabel icon={Icons.hand}>HAND</SectionLabel>
          <PhotoGrid items={hands} />
        </Card>
      )}

      {scenes.length > 0 && (
        <Card>
          <SectionLabel icon={Icons.scene}>Scene</SectionLabel>
          <PhotoGrid items={scenes} />
        </Card>
      )}
    </div>
  );
}
