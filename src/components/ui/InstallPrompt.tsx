import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

// Phase P — subtle install banner on the launcher.
// Shows only after the 3rd app open (localStorage counter), only when the
// browser fires beforeinstallprompt, and never again after "Not now".

const OPEN_COUNT_KEY = 'fv-pwa-open-count';
const DISMISSED_KEY  = 'fv-pwa-install-dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Count an app open once per module load (module-scope guard survives re-renders).
let counted = false;
function bumpOpenCount(): number {
  try {
    const n = (parseInt(localStorage.getItem(OPEN_COUNT_KEY) ?? '0', 10) || 0) + (counted ? 0 : 1);
    if (!counted) { localStorage.setItem(OPEN_COUNT_KEY, String(n)); counted = true; }
    return n;
  } catch { return 0; }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem(DISMISSED_KEY) === '1') return; } catch { return; }
    const opens = bumpOpenCount();
    if (opens < 3) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setEligible(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!eligible || !deferred) return null;

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    setEligible(false);
  }

  function notNow() {
    try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* fine */ }
    setEligible(false);
  }

  return (
    <div className="glass-panel flex items-center gap-3 px-4 py-3 mt-8 max-w-md mx-auto">
      <Download size={16} className="shrink-0" style={{ color: '#C9A961' }} />
      <p className="text-xs flex-1" style={{ color: 'var(--text-muted)' }}>
        Install Pulse on this device for one-tap access.
      </p>
      <button onClick={install}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0"
        style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
        Install
      </button>
      <button onClick={notNow} aria-label="Not now"
        className="text-xs px-2 py-1.5 shrink-0" style={{ color: 'var(--text-dim)' }}>
        <X size={13} />
      </button>
    </div>
  );
}
