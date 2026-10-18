'use client';

import { CARD, SECTION_LABEL } from '@photo/config/ui';

/** Card shell: white, 14 px radius, 1 px border, 24 px vertical padding. */
export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col"
      style={{
        background: 'var(--card)',
        color: 'var(--foreground)',
        borderRadius: CARD.radius,
        border: `1px solid ${CARD.border}`,
        paddingTop: CARD.padY,
        paddingBottom: CARD.padY,
        gap: CARD.gap,
      }}
    >
      {children}
    </div>
  );
}

/** Card row: apply 24 px horizontal padding to the row rather than the card. */
export function Row({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`w-full ${className}`} style={{ paddingLeft: CARD.padX, paddingRight: CARD.padX }}>
      {children}
    </div>
  );
}

export function SectionLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Row>
      <div className="flex items-center gap-2">
        {icon}
        <p className={SECTION_LABEL}>{children}</p>
      </div>
    </Row>
  );
}

/** Segment button: dark fill when selected, light gray otherwise. */
export function Seg({
  active,
  onClick,
  children,
  disabled,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mp-ctl inline-flex h-8 flex-1 items-center justify-center whitespace-nowrap text-sm font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      data-active={active ? 'true' : 'false'}
      style={{ borderRadius: 8 }}
    >
      {children}
    </button>
  );
}
