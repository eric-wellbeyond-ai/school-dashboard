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
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:-top-12 focus:z-50 btn btn-sm"
      >
        Skip to sign in
      </a>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
        <p className="text-sm uppercase tracking-wide text-zinc-500">
          Westlake Lutheran Academy
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Family folder</h1>
        <p className="mt-3 text-zinc-300">
          Log in with Blackbaud. Parents see Ben and Jade. Students see only their own work.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            id="wla-login"
            type="button"
            onClick={onLogin}
            disabled={signingIn}
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
          <p className="mt-4 text-sm text-zinc-400">{signedInLine}</p>
        )}

        <p className="mt-4 text-sm text-zinc-500">
          Chrome opens on this Mac only after you choose Log in with Blackbaud. Each person keeps a separate session.
        </p>
      </div>
    </div>
  );
}
