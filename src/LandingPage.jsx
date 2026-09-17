import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const POLL_MS = 3000;

async function readJson(path) {
  try {
    const res = await fetch(path, { credentials: 'include' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function loginMode({ connected, login, webview }) {
  if (connected || login?.dashboardConnected || login?.state === 'connected') return 'connected';
  const chromeUp = Boolean(
    login?.playwrightRunning
    || login?.chromeRunning
    || webview?.playwrightRunning
    || webview?.chromeRunning
    || webview?.running
  );
  const tPresent = Boolean(login?.cookiePresent || login?.tokenValid || webview?.tokenValid);
  if (chromeUp && tPresent) return 'signed-in';
  if (chromeUp) return 'ready';
  return 'idle';
}

export default function LandingPage({
  onLogin,
  onOpenDashboard,
  onReconnect,
  onProbe,
  connected = false,
  account = {},
  signingIn = false
}) {
  const [checking, setChecking] = useState(true);
  const [login, setLogin] = useState(null);
  const [webview, setWebview] = useState(null);
  const [status, setStatus] = useState(null);
  const onProbeRef = useRef(onProbe);
  onProbeRef.current = onProbe;

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [nextStatus, nextLogin, nextWebview] = await Promise.all([
          readJson('/api/blackbaud/status'),
          readJson('/api/blackbaud/login-status'),
          readJson('/api/blackbaud/mac-webview')
        ]);
        if (cancelled) return;
        setStatus(nextStatus);
        setLogin(nextLogin);
        setWebview(nextWebview);
        onProbeRef.current?.({
          status: nextStatus,
          login: nextLogin,
          webview: nextWebview
        });
      } finally {
        if (!cancelled) setChecking(false);
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const liveAccount = status?.connected ? status : account;
  const isConnected = Boolean(connected || status?.connected || login?.dashboardConnected);
  const mode = checking ? 'checking' : loginMode({ connected: isConnected, login, webview });
  const role = liveAccount.role === 'student' ? 'student' : liveAccount.role === 'parent' ? 'parent' : null;
  const accountName = liveAccount.accountName || liveAccount.parentName || liveAccount.displayName || '';
  const studentNames = (liveAccount.students || [])
    .map((s) => s.student || s.name)
    .filter(Boolean)
    .join(' and ');

  const signedInLine = role === 'student'
    ? `Signed in as ${accountName || 'student'}. Only this student’s work is shown.`
    : role === 'parent'
      ? `Signed in as ${accountName || 'parent'}${studentNames ? ` · ${studentNames}` : ''}.`
      : null;

  const statusLine = mode === 'checking'
    ? 'Checking whether Blackbaud sign-in is already running on this Mac…'
    : mode === 'connected'
      ? 'Blackbaud is connected.'
      : mode === 'signed-in'
        ? 'Already signed in on this Mac. Chrome is running in the background.'
        : mode === 'ready'
          ? 'Sign-in is already open on this Mac. This will not start another browser.'
          : 'Chrome opens on this Mac only after you choose Log in with Blackbaud. Each person keeps a separate session.';

  const primaryLabel = signingIn
    ? 'Signing in…'
    : mode === 'checking'
      ? 'Checking this Mac…'
      : mode === 'connected'
        ? (accountName ? `Continue as ${accountName}` : 'Continue')
        : mode === 'signed-in'
          ? 'Reconnect'
          : mode === 'ready'
            ? 'Continue sign-in'
            : 'Log in with Blackbaud';

  const handlePrimary = () => {
    if (mode === 'connected') {
      onOpenDashboard();
      return;
    }
    if (mode === 'signed-in' && onReconnect) {
      onReconnect();
      return;
    }
    onLogin();
  };

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
        aria-busy={checking || signingIn}
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
            onClick={handlePrimary}
            disabled={checking || signingIn}
            aria-busy={checking || signingIn}
            className="btn btn-primary btn-block min-h-11"
          >
            {(checking || signingIn) && (
              <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
            )}
            {primaryLabel}
          </button>
        </div>

        <p className="mt-5 text-sm leading-relaxed text-zinc-400" aria-live="polite">
          {statusLine}
        </p>
        {mode === 'connected' && signedInLine && (
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">{signedInLine}</p>
        )}
      </section>
    </div>
  );
}
