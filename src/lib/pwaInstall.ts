/**
 * pwaInstall — a tiny singleton that captures the browser's `beforeinstallprompt`
 * event (Chrome / Edge / Android) so any part of the app can offer "Install app"
 * and trigger the native install dialog. iOS Safari doesn't fire the event, so we
 * detect it separately and show Add-to-Home-Screen instructions instead.
 *
 * Registering the listener at module-eval (imported from App) is earlier than a
 * React effect, so we don't miss the event.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();                 // suppress Chrome's own mini-infobar; we show our banner
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    emit();
  });
}

/** Running as an installed PWA (standalone) — never prompt in this case. */
export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch { return false; }
}

/** iOS Safari (and iPadOS) — no beforeinstallprompt; needs manual Add to Home Screen. */
export function isIOS(): boolean {
  try {
    const ua = navigator.userAgent || '';
    return (/iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document));
  } catch { return false; }
}

/** True if we can offer installation at all (native event ready, or iOS, and not already installed). */
export function canInstall(): boolean {
  return !installed && !isStandalone() && (deferred !== null || isIOS());
}

/** True only when the native install dialog is available (Android / desktop Chrome). */
export function hasNativePrompt(): boolean {
  return deferred !== null && !installed;
}

/** Subscribe to install-state changes; returns an unsubscribe fn. */
export function subscribeInstall(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Trigger the native install dialog. Returns the outcome (or 'unavailable' on iOS / unsupported). */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  await deferred.prompt();
  const choice = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  deferred = null;
  emit();
  return choice.outcome;
}
