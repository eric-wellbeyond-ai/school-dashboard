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
    <div className="relative w-full max-w-md px-6">
      <a
        href="#wla-login"
        className="sr-only focus:not-sr-only focus:absolute focus:left-0 focus:-top-14 focus:z-50 btn btn-sm"
      >
        Skip to sign in
      </a>
      <section
        className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-[0_24px_48px_rgba(0,0,0,0.35)]"
        aria-labelledby="wla-landing-title"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
          Westlake Lutheran Academy
        </p>
        <h1 id="wla-landing-title" className="mt-2 text-[1.75rem] font-semibold tracking-tight text-zinc-50">
          Family folder
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-300">
          Log in with Blackbaud. Parents see Ben and Jade. Students see only their own work.
        </p>

        <div className="mt-7 flex flex-col gap-2.5">
          <button
            id="wla-login"
            type="button"
            onClick={onLogin}
            disabled={signingIn}
            aria-busy={signingIn}
            className="btn btn-primary btn-block min-h-11"
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
              className="btn btn-outline btn-block min-h-11"
            >
              Continue{accountName ? ` as ${accountName}` : ''}
            </button>
          )}
        </div>

        {connected && signedInLine && (
          <p className="mt-5 text-sm leading-relaxed text-zinc-400">{signedInLine}</p>
        )}

        <p className="mt-5 text-sm leading-relaxed text-zinc-400">
          Chrome opens on this Mac only after you choose Log in with Blackbaud. Each person keeps a separate session.
        </p>
      </section>
    </div>
  );
}
