/**
 * RouteErrorBoundary — branded full-page error screen used as `errorElement`
 * on every top-level route.
 *
 * Replaces React Router's default "Unexpected Application Error!" wall of text.
 *
 * The most common production error is a STALE-DEPLOY chunk failure: after a
 * deploy, hashed chunk filenames change, so a tab opened before the deploy
 * 404s when it lazy-loads a route ("Failed to fetch dynamically imported
 * module"). For that case we auto hard-refresh ONCE (sessionStorage guard
 * prevents reload loops) — the refresh pulls the new index.html and the user
 * never sees an error. If the refresh doesn't fix it (offline, real bug),
 * this screen renders with clear recovery actions.
 */

import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { RefreshCw, Home, LogOut } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { VideoLogo } from './VideoLogo';
import { CHUNK_RELOAD_GUARD_KEY } from '../../lib/chunkReloadGuard';

/** True when the error is a lazy-chunk fetch failure (stale deploy / network). */
function isChunkLoadError(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message :
    typeof err === 'string' ? err : '';
  return /dynamically imported module|Importing a module script failed|Failed to fetch|Loading chunk|error loading dynamically/i.test(msg);
}

/** Module home for the current path — "direct to the module page". */
function moduleHome(pathname: string): string {
  if (pathname.startsWith('/crm'))  return '/crm/dashboard';
  if (pathname.startsWith('/hrms')) return '/hrms/dashboard';
  if (pathname.startsWith('/mis'))  return '/mis/overview';
  return '/';
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  const chunkError = isChunkLoadError(error);

  // Log the underlying error so route failures are diagnosable (the default
  // boundary swallowed it). Skip the benign stale-deploy chunk case below.
  useEffect(() => {
    if (!chunkError) {
      console.error('[RouteError]', window.location.pathname, error);
    }
  }, [chunkError, error]);

  // Stale-deploy auto-recovery: hard refresh once. The guard is cleared on any
  // successful lazy load (see lazyPage in router.tsx), so each new deploy gets
  // one fresh attempt without ever looping.
  useEffect(() => {
    if (chunkError && !sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY)) {
      sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, '1');
      window.location.reload();
    }
  }, [chunkError]);

  // While the auto-refresh is kicking in, show only the logo — no error flash.
  if (chunkError && !sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY)) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--navy-deep, #050d1f)' }}>
        <VideoLogo size="sm" showText />
      </div>
    );
  }

  const home = moduleHome(window.location.pathname);

  // True hard refresh: drop the service worker + all caches first, so even a
  // corrupted/stale SW state (the usual cause of persistent chunk failures)
  // is fully reset before reloading. All steps are best-effort.
  const handleHardRefresh = async () => {
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = (await window.caches?.keys?.()) ?? [];
      await Promise.all(keys.map((k) => window.caches.delete(k)));
    } catch { /* reload regardless */ }
    window.location.reload();
  };

  const handleSignOut = async () => {
    try { await signOut(auth); } catch { /* proceed to login regardless */ }
    // Hard navigation — guarantees a fresh index.html + clean app state.
    window.location.assign('/login');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ backgroundColor: 'var(--navy-deep, #050d1f)' }}>

      <VideoLogo size="md" showText />

      <h1 className="text-2xl mt-8 mb-2"
        style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary, #f0ece0)' }}>
        {chunkError ? 'A new version of Pulse is ready' : 'Something went wrong'}
      </h1>
      <p className="text-sm mb-8 max-w-md leading-relaxed" style={{ color: 'var(--text-muted, #8B8B85)' }}>
        {chunkError
          ? 'The app was updated while this page was open. Refresh to load the latest version — your data is safe.'
          : 'An unexpected error occurred on this page. Refreshing usually fixes it — your data is safe.'}
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={handleHardRefresh}
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
          <RefreshCw size={15} /> Refresh now
        </button>
        <button onClick={() => window.location.assign(home)}
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold border transition-opacity hover:opacity-80"
          style={{ borderColor: 'rgba(201,169,97,0.35)', color: '#C9A961' }}>
          <Home size={15} /> Go to home
        </button>
        <button onClick={handleSignOut}
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold border transition-opacity hover:opacity-80"
          style={{ borderColor: 'var(--shell-border, rgba(255,255,255,0.15))', color: 'var(--text-muted, #8B8B85)' }}>
          <LogOut size={15} /> Sign out &amp; sign in again
        </button>
      </div>
    </div>
  );
}
