/**
 * Partner Scoring settings (super admin) - edits the weights/thresholds in
 * `partnerScoringConfig`. Saving bumps the rubric version and the server
 * recomputes every non-terminal candidate's score.
 * 
 * Extracted verbatim from MastersPage.tsx (2026-07-22) - no behaviour change.
 */
import { useState, useEffect } from 'react';
import { useToast } from '../../../components/ui/Toast';
import { apiCrm2 } from '../lib';
import { FLabel } from '../formPrimitives';
import { sanitizePartnerRubric, type PartnerRubric } from '../../../lib/crm2/partnerScoring';
import {
  TierBadge,
  PARTNER_NETWORK_TYPE_OPTS, PARTNER_NETWORK_SIZE_OPTS, PARTNER_FIT_OPTS,
  PARTNER_TRACK_OPTS, PARTNER_VOLUME_OPTS, PARTNER_KYC_OPTS,
} from './partnerOptions';

// ─── Partner Scoring rubric settings (super-admin) ────────────────────────────
// Editable weights + thresholds. Save bumps the version and batch-recomputes every
// non-terminal candidate server-side. The score maps are edited as-is (each answer
// option → points); the pure lib clamps/validates on the server.
const RUBRIC_SECTIONS: Array<{ key: keyof PartnerRubric; label: string; opts: string[] }> = [
  { key: 'networkType', label: 'Network type', opts: PARTNER_NETWORK_TYPE_OPTS.map((o) => o.value) },
  { key: 'networkSize', label: 'Network size', opts: PARTNER_NETWORK_SIZE_OPTS.map((o) => o.value) },
  { key: 'productDemandFit', label: 'Product / demand fit', opts: PARTNER_FIT_OPTS.map((o) => o.value) },
  { key: 'priorTrackRecord', label: 'Prior track record', opts: PARTNER_TRACK_OPTS.map((o) => o.value) },
  { key: 'expectedMonthlyVolume', label: 'Expected volume', opts: PARTNER_VOLUME_OPTS.map((o) => o.value) },
  { key: 'kycReadiness', label: 'KYC readiness', opts: PARTNER_KYC_OPTS.map((o) => o.value) },
];

export function PartnerScoringTab() {
  const toast = useToast();
  const [cfg, setCfg] = useState<PartnerRubric | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiCrm2<{ config: PartnerRubric }>('GET', '/api/crm2/partner-scoring-config').then((r) => setCfg(r.config)).catch(() => toast.error('Could not load rubric')); }, [toast]);

  const setWeight = (section: keyof PartnerRubric, opt: string, v: string) =>
    setCfg((p) => p ? { ...p, [section]: { ...(p[section] as Record<string, number>), [opt]: Number(v) || 0 } } : p);

  const save = async () => {
    if (!cfg) return;
    setBusy(true);
    try {
      // sanitize client-side too (server re-sanitizes) so the payload is clean.
      const clean = sanitizePartnerRubric(cfg, cfg);
      const r = await apiCrm2<{ ok: boolean; version: number; recomputed: number }>('PATCH', '/api/crm2/partner-scoring-config', clean);
      toast.success(`Saved (v${r.version}) — re-scored ${r.recomputed} candidate${r.recomputed === 1 ? '' : 's'}`);
      const fresh = await apiCrm2<{ config: PartnerRubric }>('GET', '/api/crm2/partner-scoring-config');
      setCfg(fresh.config);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  };

  if (!cfg) return <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading rubric…</p>;

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Points per screening answer → a total, mapped to <TierBadge tier="Hot" /> / <TierBadge tier="Warm" /> / <TierBadge tier="Cold" />.
        Saving re-scores every candidate that isn't already Active or Rejected. Config version <strong>v{cfg.version}</strong>.
      </p>

      {RUBRIC_SECTIONS.map(({ key, label, opts }) => (
        <div key={key}>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{label}</p>
          <div className="grid grid-cols-2 gap-2">
            {opts.map((o) => (
              <div key={o} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--shell-hover-soft)' }}>
                <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{o}</span>
                <input type="number" className="glass-inp w-16 text-sm text-right"
                  value={(cfg[key] as Record<string, number>)[o] ?? 0}
                  onChange={(e) => setWeight(key, o, e.target.value)} />
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="text-xs font-bold uppercase tracking-wider pt-2" style={{ color: '#C9A961' }}>Practical assessment (stage 2 — gates Active)</p>
      {(['productKnowledge', 'sampleCaseQuality', 'responsiveness', 'processUnderstanding'] as const).map((k) => (
        <div key={k}>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{k === 'productKnowledge' ? 'Product knowledge' : k === 'sampleCaseQuality' ? 'Sample case quality' : k === 'responsiveness' ? 'Responsiveness' : 'Process understanding'}</p>
          <div className="grid grid-cols-3 gap-2">
            {Object.keys((cfg.practical ?? { productKnowledge: {}, sampleCaseQuality: {}, responsiveness: {}, processUnderstanding: {}, passThreshold: 7 })[k] ?? {}).map((o) => (
              <div key={o} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--shell-hover-soft)' }}>
                <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{o}</span>
                <input type="number" className="glass-inp w-14 text-sm text-right"
                  value={cfg.practical?.[k]?.[o] ?? 0}
                  onChange={(e) => setCfg((p) => p ? { ...p, practical: { ...p.practical, [k]: { ...p.practical[k], [o]: Number(e.target.value) || 0 } } } : p)} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-3 gap-3">
        <div><FLabel text="Practical pass threshold (≥)" /><input type="number" className="glass-inp w-full text-sm" value={cfg.practical?.passThreshold ?? 7} onChange={(e) => setCfg((p) => p ? { ...p, practical: { ...p.practical, passThreshold: Number(e.target.value) || 0 } } : p)} /></div>
      </div>

      <div className="grid grid-cols-3 gap-3 pt-1">
        <div><FLabel text="DSA conflict penalty" /><input type="number" className="glass-inp w-full text-sm" value={cfg.conflictPenalty} onChange={(e) => setCfg((p) => p ? { ...p, conflictPenalty: Number(e.target.value) || 0 } : p)} /></div>
        <div><FLabel text="Hot threshold (≥)" /><input type="number" className="glass-inp w-full text-sm" value={cfg.tierThresholds.hot} onChange={(e) => setCfg((p) => p ? { ...p, tierThresholds: { ...p.tierThresholds, hot: Number(e.target.value) || 0 } } : p)} /></div>
        <div><FLabel text="Warm threshold (≥)" /><input type="number" className="glass-inp w-full text-sm" value={cfg.tierThresholds.warm} onChange={(e) => setCfg((p) => p ? { ...p, tierThresholds: { ...p.tierThresholds, warm: Number(e.target.value) || 0 } } : p)} /></div>
      </div>

      <button onClick={save} disabled={busy}
        className="px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
        style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
        {busy ? 'Saving & recomputing…' : 'Save rubric & recompute'}
      </button>
    </div>
  );
}
