import React from 'react';
import { RefreshCw } from 'lucide-react';

export default function LandingPage({
  onLogin,
  onOpenDashboard,
  connected = false,
  account = {},
  signingIn = false
}) {
  const role = account.role === 'student' ? 'student' : account.role === 'parent' ? 'parent' : null;
  const accountName = account.accountName || account.parentName || account.displayName || '';
  const studentNames = (account.students || [])
    .map((s) => s.student || s.name)
    .filter(Boolean)
    .join(' and ');

  const signedInLine = role === 'student'
    ? `Signed in as ${accountName || 'student'}. Only this student’s work is shown.`
    : role === 'parent'
      ? `Signed in as ${accountName || 'parent'}${studentNames ? ` · ${studentNames}` : ''}.`
      : null;

  return (
    <div className="wla-landing wla-grain fixed inset-0 z-40 overflow-y-auto">
      <a
        href="#wla-login"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[rgb(var(--wla-ink))] focus:px-3 focus:py-2 focus:text-[15px] focus:text-[rgb(var(--wla-on-ink))]"
      >
        Skip to sign in
      </a>
      <main className="min-h-full flex flex-col items-center justify-center px-6 py-16">
        <div className="wla-enter wla-landing-card w-full max-w-[26rem] px-8 py-12 sm:px-10 pb-14">
          <p className="font-serif text-[13px] tracking-[0.18em] uppercase" style={{ color: 'rgb(var(--wla-gold))' }}>
            Westlake Lutheran Academy
          </p>
          <h1 className="mt-3 font-serif text-[2.15rem] sm:text-[2.4rem] leading-[1.15] font-semibold">
            Family folder
          </h1>
          <p className="mt-4 text-[17px] leading-relaxed" style={{ color: 'rgb(var(--wla-mute))' }}>
            Log in with Blackbaud. Parents see Ben and Jade. Students see only their own work.
          </p>

          <div className="mt-10 space-y-3">
            <button
              id="wla-login"
              type="button"
              onClick={onLogin}
              disabled={signingIn}
              className="wla-btn-primary w-full min-h-11 inline-flex items-center justify-center gap-2 rounded-lg text-[17px] font-semibold px-5 py-3 disabled:opacity-60 disabled:cursor-wait"
            >
              {signingIn ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                'Log in with Blackbaud'
              )}
            </button>
            {connected && (
              <button
                type="button"
                onClick={onOpenDashboard}
                className="wla-btn-secondary w-full min-h-11 inline-flex items-center justify-center rounded-lg text-[17px] font-semibold px-5 py-3"
              >
                Continue{accountName ? ` as ${accountName}` : ''}
              </button>
            )}
          </div>

          {connected && signedInLine && (
            <p className="mt-6 text-[15px] leading-relaxed" style={{ color: 'rgb(var(--wla-mute))' }}>
              {signedInLine}
            </p>
          )}

          <p className="mt-10 text-[13px] leading-relaxed" style={{ color: 'rgb(var(--wla-mute))' }}>
            Chrome opens on this Mac only after you choose Log in with Blackbaud. Each person keeps a separate session.
          </p>
        </div>
      </main>
    </div>
  );
}
