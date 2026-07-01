import { useEffect, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, X, Share, Plus } from 'lucide-react';
import {
  canInstall, hasNativePrompt, isIOS, isStandalone, promptInstall, subscribeInstall,
} from '../../lib/pwaInstall';

const SNOOZE_KEY = 'fv-pwa-snooze';
const SNOOZE_DAYS = 5;

function snooze() {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000)); } catch { /* storage off */ }
}
function isSnoozed(): boolean {
  try { return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) ?? '0'); } catch { return false; }
}

/**
 * InstallAppBanner — a global, dismissible "Install Pulse" banner. Shown app-wide
 * once the browser says the PWA is installable (or on iOS Safari), a few seconds
 * after load, unless the user recently dismissed it or it's already installed.
 * Also responds to a `fv:install` window event (the "Install app" menu option).
 */
export function InstallAppBanner() {
  const [eligible, setEligible] = useState(false);
  const [show, setShow] = useState(false);
  const [help, setHelp] = useState(false);   // iOS Add-to-Home-Screen instructions

  const doInstall = useCallback(async () => {
    if (hasNativePrompt()) {
      const outcome = await promptInstall();
      setShow(false);
      if (outcome !== 'accepted') snooze();
    } else if (isIOS()) {
      setShow(false);
      setHelp(true);
    }
  }, []);

  useEffect(() => {
    const compute = () => setEligible(canInstall() && !isSnoozed());
    compute();
    const unsub = subscribeInstall(compute);
    const onManual = () => {
      if (isStandalone()) return;
      if (hasNativePrompt()) void doInstall();
      else if (isIOS()) setHelp(true);
    };
    window.addEventListener('fv:install', onManual);
    return () => { unsub(); window.removeEventListener('fv:install', onManual); };
  }, [doInstall]);

  // Reveal the banner a few seconds after it becomes eligible (not jarring on load).
  useEffect(() => {
    if (!eligible) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 3500);
    return () => clearTimeout(t);
  }, [eligible]);

  const dismiss = () => { snooze(); setShow(false); setEligible(false); };

  return (
    <>
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="fixed left-1/2 -translate-x-1/2 z-55 w-[calc(100%-1.5rem)] max-w-md"
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }}
            role="dialog" aria-label="Install app"
          >
            <div className="rounded-2xl p-3.5 flex items-center gap-3.5 shadow-2xl"
              style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)' }}>
              <div className="w-11 h-11 rounded-xl shrink-0 flex items-center justify-center overflow-hidden"
                style={{ background: 'linear-gradient(135deg,#0B1538,#050d1f)' }}>
                <img src="/favicon.png" alt="" className="w-7 h-7 object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
                  Install Finvastra Pulse
                </p>
                <p className="text-[11px] leading-snug mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  One-tap access from your home screen · instant launch.
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <button onClick={doInstall}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                  style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                  <Download size={13} /> Install
                </button>
                <button onClick={dismiss} className="text-[10px] font-medium px-2 py-0.5" style={{ color: 'var(--text-dim)' }}>
                  Not now
                </button>
              </div>
              <button onClick={dismiss} aria-label="Dismiss" className="absolute top-2 right-2 p-1 rounded-lg hover:bg-(--shell-hover-soft)">
                <X size={13} style={{ color: 'var(--text-dim)' }} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* iOS — manual Add to Home Screen instructions */}
      <AnimatePresence>
        {help && (
          <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(5,13,31,0.6)' }} onClick={() => setHelp(false)}>
            <motion.div
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
              className="rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}
              style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Add Pulse to your Home Screen</h3>
                <button onClick={() => setHelp(false)} aria-label="Close" className="p-1 rounded-lg hover:bg-(--shell-hover-soft)">
                  <X size={16} style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>
              <ol className="space-y-3">
                <li className="flex items-center gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ backgroundColor: 'rgba(201,169,97,0.18)', color: '#C9A961' }}>1</span>
                  Tap the <Share size={15} className="inline" style={{ color: '#5B9BD5' }} /> <strong>Share</strong> button in Safari’s toolbar.
                </li>
                <li className="flex items-center gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ backgroundColor: 'rgba(201,169,97,0.18)', color: '#C9A961' }}>2</span>
                  Scroll down and tap <Plus size={15} className="inline" /> <strong>Add to Home Screen</strong>.
                </li>
                <li className="flex items-center gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ backgroundColor: 'rgba(201,169,97,0.18)', color: '#C9A961' }}>3</span>
                  Tap <strong>Add</strong> — Pulse now opens like an app.
                </li>
              </ol>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
