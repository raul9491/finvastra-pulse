import { useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { stepMode } from './TourProvider';
import type { TourStep } from './tourSteps';

interface Rect { top: number; left: number; width: number; height: number; }

const PAD = 6;          // breathing room around the spotlighted element
const CARD_W = 330;     // tooltip width
const GAP = 12;         // gap between target and tooltip

export function TourOverlay({ step, stepNumber, total, onNext, onBack, onEnd }: {
  step: TourStep;
  stepNumber: number;   // 0-based index within the full step list
  total: number;
  onNext: () => void;
  onBack: () => void;
  onEnd: () => void;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const mode = stepMode(step);

  const recompute = useCallback(() => {
    if (mode !== 'spotlight' || !step.target) { setRect(null); return; }
    const el = document.querySelector(step.target) as HTMLElement | null;
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [mode, step.target]);

  useLayoutEffect(() => { recompute(); }, [recompute]);

  useEffect(() => {
    const onMove = () => recompute();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEnd();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') onNext();
      else if (e.key === 'ArrowLeft') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [recompute, onNext, onBack, onEnd]);

  const isLast = stepNumber >= total - 1;

  // Anchored-card position: below the target if there's room, else above; clamped.
  let anchoredStyle: React.CSSProperties = {};
  if (rect) {
    const below = rect.top + rect.height + GAP;
    const room = window.innerHeight - below;
    const top = room > 200 ? below : Math.max(GAP, rect.top - GAP - 190);
    let left = rect.left;
    if (left + CARD_W > window.innerWidth - GAP) left = window.innerWidth - CARD_W - GAP;
    if (left < GAP) left = GAP;
    anchoredStyle = { position: 'fixed', top, left, width: CARD_W, maxWidth: '92vw' };
  }

  // The card content — rendered the same in both anchored and centered modes.
  const cardBody = (
    <div className="rounded-2xl shadow-2xl" style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)', padding: 16 }}>
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{step.title}</h3>
        <button onClick={onEnd} aria-label="Skip tour" className="p-1 -m-1 rounded-lg hover:bg-(--shell-hover-soft) shrink-0">
          <X size={16} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{step.body}</p>

      <div className="flex items-center justify-between mt-4">
        <button onClick={onEnd} className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Skip tour</button>
        <div className="flex items-center gap-2">
          {stepNumber > 0 && (
            <button onClick={onBack} className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-secondary)' }}>Back</button>
          )}
          <button onClick={onNext} className="text-xs font-semibold px-3.5 py-1.5 rounded-lg"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 mt-3">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className="h-1 rounded-full transition-all"
            style={{ width: i === stepNumber ? 16 : 6, backgroundColor: i === stepNumber ? '#C9A961' : 'var(--shell-border-mid)' }} />
        ))}
      </div>
    </div>
  );

  const anim = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.18, ease: 'easeOut' as const } };

  return (
    <div className="fixed inset-0 z-2000" aria-modal="true" role="dialog">
      {/* Transparent click-blocker so the page can't be interacted with mid-tour. */}
      <div className="fixed inset-0" />

      {rect ? (
        <>
          {/* Spotlight: box-shadow cutout keeps the target bright + a gold ring. */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="fixed pointer-events-none"
            style={{
              top: rect.top, left: rect.left, width: rect.width, height: rect.height,
              borderRadius: 12, boxShadow: '0 0 0 9999px rgba(5,13,31,0.72)',
              outline: '2px solid #C9A961', outlineOffset: 2,
            }}
          />
          {/* Anchored tooltip near the target. */}
          <motion.div key={stepNumber} {...anim} style={anchoredStyle}>{cardBody}</motion.div>
        </>
      ) : (
        <>
          {/* Full-screen dim + a flex-centered card (no transform-based centering, so
              the entrance animation can't knock it off-centre). */}
          <div className="fixed inset-0" style={{ backgroundColor: 'rgba(5,13,31,0.72)' }} />
          <div className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none">
            <motion.div key={stepNumber} {...anim} className="pointer-events-auto" style={{ width: CARD_W, maxWidth: '92vw' }}>
              {cardBody}
            </motion.div>
          </div>
        </>
      )}
    </div>
  );
}
