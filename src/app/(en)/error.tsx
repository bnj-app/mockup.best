'use client';

/**
 * Crash screen. Show error details only on localhost, where they save debugging time. In
 * production, messages and stack traces are unhelpful to users and expose paths and internals. Show
 * calm recovery guidance instead, plus digest for support: Next generates this traceable code
 * without exposing error content.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const dev = typeof window !== 'undefined' && window.location.hostname === 'localhost';
  return (
    <div className="fixed inset-0 grid place-items-center p-8" style={{ background: 'var(--mp-page)' }}>
      <div
        className="mp-scroll max-h-[80vh] w-full max-w-2xl overflow-auto p-6"
        style={{
          borderRadius: 'var(--mp-radius-lg)',
          border: '1px solid var(--mp-border)',
          background: 'var(--mp-glass)',
        }}
      >
        <p className="mp-section-title mb-3">Something broke</p>
        {!dev ? (
          <p className="mb-4 text-[13px] leading-relaxed" style={{ color: 'var(--mp-text-primary)' }}>
            Sorry — the editor hit an unexpected error. Your work is saved locally, so
            reloading usually brings it back.
            {error.digest ? (
              <>
                {' '}
                Reference: <span className="font-mono">{error.digest}</span>
              </>
            ) : null}
          </p>
        ) : null}
        {dev ? (
          <p className="mb-4 font-mono text-[13px] leading-relaxed" style={{ color: 'var(--mp-text-primary)' }}>
            {error.message}
          </p>
        ) : null}
        {dev && error.stack ? (
          <pre
            className="mp-scroll mb-5 max-h-64 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed"
            style={{ background: 'var(--mp-surface)', borderRadius: 'var(--mp-radius)', color: 'var(--mp-text-secondary)' }}
          >
            {error.stack}
          </pre>
        ) : null}
        <button className="mp-topbtn" style={{ background: 'var(--mp-surface-active)' }} onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
