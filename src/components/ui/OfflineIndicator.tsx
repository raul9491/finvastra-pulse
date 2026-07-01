import { useEffect, useState } from 'react';
import { WifiOff, X } from 'lucide-react';

/**
 * Phase P — amber "you're offline" banner. Firestore's IndexedDB persistence
 * queues writes while offline; this just tells the user what's happening.
 * Re-appears on every new offline episode (dismiss only hides the current one).
 */
export function OfflineIndicator() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const goOffline = () => { setOffline(true); setDismissed(false); };
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline || dismissed) return null;

  return (
    <div
      className="fixed top-0 inset-x-0 z-[2000] flex items-center justify-center gap-2.5 px-4 py-2 text-xs font-semibold"
      style={{ backgroundColor: '#92400E', color: '#FEF3C7' }}
      role="status"
    >
      <WifiOff size={13} className="shrink-0" />
      <span>You're offline — Pulse needs a connection to sign in and load data.</span>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss offline banner"
        className="ml-2 p-0.5 rounded hover:opacity-70">
        <X size={13} />
      </button>
    </div>
  );
}
