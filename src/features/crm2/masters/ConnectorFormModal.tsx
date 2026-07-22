/**
 * The CON-### connector (channel partner) record: the tabbed create/edit modal
 * (Details / Screening / Assessment / Onboarding / Activity / Payouts) plus the
 * two tabs it renders, ConnectorPayoutsTab and ConnectorActivityTab.
 * 
 * The modal and those two tabs reference each other, so they stay in one module
 * - that keeps the dependency on ConnectorsMasterTab one-way.
 * 
 * Extracted verbatim from MastersPage.tsx (2026-07-22) - no behaviour change.
 * Create/edit still go through /api/crm2/connectors so PAN + bank account are
 * encrypted server-side (last-4 shown) and Aadhaar stays last-4 only.
 */
import { useMemo, useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { apiCrm2, useCrm2Collection } from '../lib';
import { FLabel, inp } from '../formPrimitives';
import { getConnectorFinancial, useConnectorPayouts, markConnectorPayoutPaid } from '../../hrms/hooks/useConnectors';
import { CONSTITUTION_OPTS } from '../clients/ClientFormModal';
import { computePartnerScore, computeOnboardingProgress, computePracticalAssessment, type PartnerRubric } from '../../../lib/crm2/partnerScoring';
import {
  AskQ, TierBadge, PRACTICAL_OPTS,
  PARTNER_FUNNEL_OPTS, PARTNER_LEAD_SOURCE_OPTS, PARTNER_NETWORK_TYPE_OPTS, PARTNER_NETWORK_SIZE_OPTS,
  PARTNER_FIT_OPTS, PARTNER_TRACK_OPTS, PARTNER_VOLUME_OPTS, PARTNER_KYC_OPTS, PARTNER_NEXT_ACTION_OPTS,
} from './partnerOptions';
import type { Connector, ConnectorVertical, ConnectorFinancial } from '../../../types';
import type { WithId } from './masterForm';
import type { Product } from '../../../types/crm2';

// ─── Connectors (CON-) tab ────────────────────────────────────────────────────
// The ONE place to add/manage connectors (channel partners who source customers).
// Backed by `/connectors` (read by the Add Customer picker). Create/edit go via
// the server so PAN + bank account are encrypted (last-4 shown) and Aadhaar is
// last-4 only. The CON-### code is auto-assigned; super admins toggle status.
const VERTICAL_OPTS: Array<{ value: ConnectorVertical; label: string }> = [
  { value: 'loan', label: 'Loan' }, { value: 'wealth', label: 'Wealth' }, { value: 'insurance', label: 'Insurance' },
];
const EMPTY_BANK = { bankName: '', accountHolderName: '', ifsc: '', accountNo: '', branchName: '' };

// Firestore Timestamp (or null) → yyyy-mm-dd for a <input type="date">.
function tsToInput(ts: unknown): string {
  const d = (ts as { toDate?: () => Date } | null | undefined)?.toDate?.();
  return d ? d.toISOString().slice(0, 10) : '';
}
const SectionLabel = ({ text }: { text: string }) => (
  <p className="text-[11px] font-bold uppercase tracking-widest pt-1" style={{ color: '#C9A961' }}>{text}</p>
);

export function ConnectorFormModal({ initial, autoCode, onClose, onSaved }: {
  initial: Connector | null;
  autoCode: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [entityType, setEntityType] = useState<string>(initial?.entityType ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [mobiles, setMobiles] = useState<string[]>(initial?.mobiles?.length ? initial.mobiles : [initial?.mobile ?? '']);
  const [email, setEmail] = useState(initial?.email ?? '');
  const [firmName, setFirmName] = useState(initial?.firmName ?? '');
  const [gstin, setGstin] = useState(initial?.gstin ?? '');
  const [verticals, setVerticals] = useState<ConnectorVertical[]>(initial?.verticals ?? []);
  const [pan, setPan] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  const [bank, setBank] = useState({ ...EMPTY_BANK });
  const [tdsPct, setTdsPct] = useState('');
  const [fin, setFin] = useState<ConnectorFinancial | null>(null);   // existing — for last-4 hints
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  // On edit, load the admin-only financial sub-doc for last-4 hints + prefills.
  useEffect(() => {
    if (!initial) return;
    getConnectorFinancial(initial.id).then((f) => {
      if (!f) return;
      setFin(f);
      setAadhaar(f.aadhaarLast4 ?? '');
      setTdsPct(f.tdsPct != null ? String(f.tdsPct) : '');
      if (f.payoutBank) setBank({
        bankName: f.payoutBank.bankName ?? '', accountHolderName: f.payoutBank.accountHolderName ?? '',
        ifsc: f.payoutBank.ifsc ?? '', accountNo: '', branchName: f.payoutBank.branchName ?? '',
      });
    });
  }, [initial]);

  // ── Partner funnel state ──
  const [tab, setTab] = useState<'details' | 'screening' | 'assessment' | 'onboarding' | 'activity' | 'payouts'>('details');
  // Legacy connectors have no funnelStatus — default to Active when they're already
  // active (an established partner) so editing them doesn't silently deactivate them.
  const [funnelStatus, setFunnelStatus] = useState<string>(
    initial?.funnelStatus ?? (initial?.status === 'active' ? 'Active' : 'Inquiry'));
  const [owner, setOwner] = useState(initial?.owner ?? '');
  const [leadSource, setLeadSource] = useState(initial?.leadSource ?? '');
  const [occupation, setOccupation] = useState(initial?.occupation ?? '');
  const [networkType, setNetworkType] = useState(initial?.networkType ?? '');
  const [networkSize, setNetworkSize] = useState(initial?.networkSize ?? '');
  const [productInterestStated, setProductInterestStated] = useState(initial?.productInterestStated ?? '');
  const [productDemandFit, setProductDemandFit] = useState(initial?.productDemandFit ?? '');
  const [priorTrackRecord, setPriorTrackRecord] = useState(initial?.priorTrackRecord ?? '');
  const [trackRecordNotes, setTrackRecordNotes] = useState(initial?.trackRecordNotes ?? '');
  const [expectedMonthlyVolume, setExpectedMonthlyVolume] = useState(initial?.expectedMonthlyVolume ?? '');
  const [kycReadinessInput, setKycReadinessInput] = useState(initial?.kycReadinessInput ?? '');
  const [existingDsaCodeElsewhere, setExistingDsa] = useState(!!initial?.existingDsaCodeElsewhere);
  const [conflictNotes, setConflictNotes] = useState(initial?.conflictNotes ?? '');
  const [screeningCallDone, setScreeningCallDone] = useState(!!initial?.screeningCallDone);
  const [screeningCallDate, setScreeningCallDate] = useState(tsToInput(initial?.screeningCallDate));
  const [nextAction, setNextAction] = useState(initial?.nextAction ?? '');
  const oc0 = initial?.onboardingChecklist;
  const [onb, setOnb] = useState({
    panCollected: !!oc0?.panCollected, aadhaarCollected: !!oc0?.aadhaarCollected,
    bankDetailsCollected: !!oc0?.bankDetailsCollected, trainingCompleted: !!oc0?.trainingCompleted,
    pulseAccessCreated: !!oc0?.pulseAccessCreated, firstCaseLogged: !!oc0?.firstCaseLogged,
    agreementSentDate: tsToInput(oc0?.agreementSentDate), agreementSignedDate: tsToInput(oc0?.agreementSignedDate),
  });
  const pa0 = initial?.practicalAssessment;
  const [pa, setPa] = useState({
    productKnowledge: pa0?.productKnowledge ?? '',
    sampleCaseQuality: pa0?.sampleCaseQuality ?? '',
    responsiveness: pa0?.responsiveness ?? '',
    processUnderstanding: pa0?.processUnderstanding ?? '',
    assessorNotes: pa0?.assessorNotes ?? '',
  });
  const [rubric, setRubric] = useState<PartnerRubric | null>(null);
  useEffect(() => { apiCrm2<{ config: PartnerRubric }>('GET', '/api/crm2/partner-scoring-config').then((r) => setRubric(r.config)).catch(() => {}); }, []);

  // Live score preview from the current screening answers (never a black box).
  const preview = useMemo(() => {
    if (!rubric) return null;
    return computePartnerScore({ networkType, networkSize, productDemandFit, priorTrackRecord, expectedMonthlyVolume, kycReadinessInput, existingDsaCodeElsewhere }, rubric);
  }, [rubric, networkType, networkSize, productDemandFit, priorTrackRecord, expectedMonthlyVolume, kycReadinessInput, existingDsaCodeElsewhere]);
  const onbProgress = computeOnboardingProgress({ ...onb, agreementSignedDate: onb.agreementSignedDate || null });
  const paPreview = useMemo(() => (rubric ? computePracticalAssessment(pa, rubric) : null), [rubric, pa]);

  const toggleV = (v: ConnectorVertical) => setVerticals((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  const setMobileAt = (i: number, v: string) => setMobiles((p) => p.map((m, j) => (j === i ? v : m)));
  const setB = (k: keyof typeof EMPTY_BANK, v: string) => setBank((p) => ({ ...p, [k]: v }));

  const save = async () => {
    const e: Record<string, string> = {};
    if (!displayName.trim()) e.displayName = 'Required';
    const cleanMobiles = mobiles.map((m) => m.replace(/[\s-]/g, '').replace(/^\+91/, '')).filter(Boolean);
    if (cleanMobiles.length === 0) e.mobile = 'At least one mobile';
    else if (cleanMobiles.some((m) => !/^[6-9]\d{9}$/.test(m))) e.mobile = 'Each must be a 10-digit mobile';
    if (verticals.length === 0) e.verticals = 'Pick at least one';
    const panUp = pan.trim().toUpperCase();
    // PAN is optional now (a candidate can be logged at Inquiry before KYC).
    if (panUp && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panUp)) e.pan = 'Invalid PAN (ABCDE1234F)';
    if (aadhaar.trim() && !/^\d{4}$/.test(aadhaar.trim())) e.aadhaar = 'Last 4 digits only';
    if (bank.ifsc.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank.ifsc.trim().toUpperCase())) e.ifsc = 'Invalid IFSC';
    if (bank.accountNo.trim() && !/^\d{6,20}$/.test(bank.accountNo.replace(/\s/g, ''))) e.accountNo = '6–20 digits';
    if (Object.keys(e).length) { setErrs(e); setTab('details'); return; }
    setErrs({}); setServerError(''); setBusy(true);
    try {
      const payload = {
        entityType: entityType || null, displayName: displayName.trim(), mobiles: cleanMobiles,
        email: email.trim() || null, firmName: firmName.trim() || null, gstin: gstin.trim() || null,
        verticals,
        // Screening / funnel (status is DERIVED server-side from funnelStatus)
        funnelStatus, owner: owner.trim() || null, leadSource: leadSource || null,
        occupation, networkType: networkType || null, networkSize: networkSize || null,
        productInterestStated, productDemandFit: productDemandFit || null,
        priorTrackRecord: priorTrackRecord || null, trackRecordNotes,
        expectedMonthlyVolume: expectedMonthlyVolume || null, kycReadinessInput: kycReadinessInput || null,
        existingDsaCodeElsewhere, conflictNotes,
        screeningCallDone, screeningCallDate: screeningCallDate || null, nextAction: nextAction || null,
        practicalAssessment: {
          productKnowledge: pa.productKnowledge || null,
          sampleCaseQuality: pa.sampleCaseQuality || null,
          responsiveness: pa.responsiveness || null,
          processUnderstanding: pa.processUnderstanding || null,
          assessorNotes: pa.assessorNotes,
        },
        onboardingChecklist: {
          panCollected: onb.panCollected, aadhaarCollected: onb.aadhaarCollected,
          bankDetailsCollected: onb.bankDetailsCollected, trainingCompleted: onb.trainingCompleted,
          pulseAccessCreated: onb.pulseAccessCreated, firstCaseLogged: onb.firstCaseLogged,
          agreementSentDate: onb.agreementSentDate || null, agreementSignedDate: onb.agreementSignedDate || null,
        },
        ...(panUp ? { pan: panUp } : {}),
        aadhaarLast4: aadhaar.trim() || null,
        tdsPct: tdsPct.trim() ? Number(tdsPct) : null,
        bank: {
          bankName: bank.bankName.trim(), accountHolderName: bank.accountHolderName.trim(),
          ifsc: bank.ifsc.trim().toUpperCase(), branchName: bank.branchName.trim(),
          ...(bank.accountNo.trim() ? { accountNo: bank.accountNo.replace(/\s/g, '') } : {}),
        },
      };
      if (initial) { await apiCrm2('PATCH', `/api/crm2/connectors/${initial.id}`, payload); onSaved('Saved'); }
      else { const r = await apiCrm2<{ ok: boolean; id: string; connectorCode: string }>('POST', '/api/crm2/connectors', payload); onSaved(`Created ${r.connectorCode}`); }
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Save failed');
    } finally { setBusy(false); }
  };

  const followUpDue = !!initial?.nextFollowUpAt?.toMillis && initial.nextFollowUpAt.toMillis() <= Date.now();
  const TABS: Array<{ k: typeof tab; label: string }> = [
    { k: 'details', label: '1 · Details' },
    { k: 'screening', label: '2 · Screening' },
    { k: 'assessment', label: `3 · Assessment${paPreview ? (paPreview.result === 'Pass' ? ' ✓' : paPreview.result === 'Fail' ? ' ✗' : '') : ''}` },
    { k: 'onboarding', label: `4 · Onboarding · ${onbProgress}%` },
    ...(initial ? [{ k: 'activity' as const, label: `5 · Activity${followUpDue ? ' 🔔' : ''}` }, { k: 'payouts' as const, label: '6 · Payouts' }] : []),
  ];

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              {initial ? `Edit ${initial.connectorCode}` : 'New Partner / Connector'}
              {preview && <TierBadge tier={preview.tier} />}
            </h3>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Code <span className="font-mono font-semibold" style={{ color: '#C9A961' }}>{initial?.connectorCode ?? autoCode}</span> · auto-assigned
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close">
            <X size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Funnel stage selector + tab pills */}
        <div className="px-5 pt-3 flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Stage</span>
            <span className="w-44"><SearchableSelect options={PARTNER_FUNNEL_OPTS} value={funnelStatus} onChange={setFunnelStatus} /></span>
          </div>
          <div className="flex items-center gap-1.5">
            {TABS.map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                style={tab === t.k ? { backgroundColor: '#0B1538', color: '#E5C97C' } : { backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-secondary)' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 space-y-4">
          {serverError && (
            <div className="px-3.5 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#f87171' }}>
              {serverError}
            </div>
          )}

          {tab === 'details' && <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FLabel text="Name" required error={errs.displayName} />
              <input className={inp(!!errs.displayName)} value={displayName}
                onChange={(e) => setDisplayName(e.target.value)} placeholder="Connector's name" />
            </div>
            <div>
              <FLabel text="Entity Type" />
              <SearchableSelect options={[{ value: '', label: '—' }, ...CONSTITUTION_OPTS]} value={entityType} onChange={setEntityType} placeholder="—" />
            </div>
          </div>

          {/* Mobiles — one or more, with + to add */}
          <div>
            <FLabel text="Mobile" required error={errs.mobile} />
            <div className="space-y-2">
              {mobiles.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={inp(!!errs.mobile)} value={m} maxLength={13}
                    onChange={(e) => setMobileAt(i, e.target.value)} placeholder="9876543210" />
                  {mobiles.length > 1 && (
                    <button type="button" onClick={() => setMobiles((p) => p.filter((_, j) => j !== i))}
                      className="p-2 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Remove">
                      <X size={14} style={{ color: '#f87171' }} />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setMobiles((p) => [...p, ''])}
                className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#C9A961' }}>
                <Plus size={13} /> Add another mobile
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FLabel text="Email" />
              <input className={inp()} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <FLabel text="Firm / DSA Entity" />
              <input className={inp()} value={firmName} onChange={(e) => setFirmName(e.target.value)} placeholder="optional" />
            </div>
          </div>

          <div>
            <FLabel text="Verticals" required error={errs.verticals} />
            <div className="flex gap-2">
              {VERTICAL_OPTS.map(({ value, label }) => {
                const on = verticals.includes(value);
                return (
                  <button key={value} type="button" onClick={() => toggleV(value)}
                    className="px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors"
                    style={on
                      ? { backgroundColor: 'rgba(201,169,97,0.15)', borderColor: '#C9A961', color: '#C9A961' }
                      : { borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>
                    {on ? '✓ ' : ''}{label}
                  </button>
                );
              })}
            </div>
          </div>

          <SectionLabel text="KYC" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FLabel text="PAN" error={errs.pan} />
              <input className={`${inp(!!errs.pan)} uppercase`} value={pan} maxLength={10}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                placeholder={fin?.panLast4 ? `current ••••${fin.panLast4} — blank keeps it` : 'optional'} />
            </div>
            <div>
              <FLabel text="Aadhaar (last 4)" error={errs.aadhaar} />
              <input className={inp(!!errs.aadhaar)} value={aadhaar} maxLength={4}
                onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ''))} placeholder="1234" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FLabel text="GSTIN" />
              <input className={`${inp()} uppercase`} value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="optional" />
            </div>
          </div>

          <SectionLabel text="Payout Account" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FLabel text="Bank Name" />
              <input className={inp()} value={bank.bankName} onChange={(e) => setB('bankName', e.target.value)} placeholder="HDFC Bank" />
            </div>
            <div>
              <FLabel text="Name as per Account" />
              <input className={inp()} value={bank.accountHolderName} onChange={(e) => setB('accountHolderName', e.target.value)} />
            </div>
            <div>
              <FLabel text="Account Number" error={errs.accountNo} />
              <input className={inp(!!errs.accountNo)} value={bank.accountNo}
                onChange={(e) => setB('accountNo', e.target.value)}
                placeholder={fin?.payoutBank?.accountNoLast4 ? `current ••••${fin.payoutBank.accountNoLast4} — blank keeps it` : '6–20 digits'} />
            </div>
            <div>
              <FLabel text="IFSC Code" error={errs.ifsc} />
              <input className={`${inp(!!errs.ifsc)} uppercase`} value={bank.ifsc} onChange={(e) => setB('ifsc', e.target.value.toUpperCase())} placeholder="HDFC0001234" />
            </div>
            <div>
              <FLabel text="Branch Name" />
              <input className={inp()} value={bank.branchName} onChange={(e) => setB('branchName', e.target.value)} placeholder="optional" />
            </div>
            <div>
              <FLabel text="TDS %" />
              <input type="number" className={inp()} value={tdsPct} onChange={(e) => setTdsPct(e.target.value)} placeholder="e.g. 5" />
            </div>
          </div>

          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Active/inactive is derived from the funnel <strong>Stage</strong> above — a candidate becomes pickable by RMs only when the stage is <strong>Active</strong>.
          </p>
          </>}

          {tab === 'screening' && <>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              This tab IS the screening call script — work top to bottom, ask each question as written, pick the answer.
              The score updates live below; no separate question sheet needed.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div><FLabel text="Lead Source" /><SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_LEAD_SOURCE_OPTS]} value={leadSource} onChange={setLeadSource} /></div>
              <div><FLabel text="Owner (who's handling)" /><input className={inp()} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="FAPL-… or name" /></div>
              <div>
                <FLabel text="1 · Occupation" />
                <AskQ q="What do you do currently — your main line of work?" />
                <input className={inp()} value={occupation} onChange={(e) => setOccupation(e.target.value)} placeholder="e.g. Practising CA" />
              </div>
              <div>
                <FLabel text="2 · Network Type" />
                <AskQ q="Who is in your circle — CAs, property dealers, corporates, societies…?" />
                <SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_NETWORK_TYPE_OPTS]} value={networkType} onChange={setNetworkType} />
              </div>
              <div>
                <FLabel text="3 · Network Size" />
                <AskQ q="Roughly how many people could you realistically refer from your network?" />
                <SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_NETWORK_SIZE_OPTS]} value={networkSize} onChange={setNetworkSize} />
              </div>
              <div>
                <FLabel text="4 · Product Interest (stated)" />
                <AskQ q="Which products do you want to work on — home loans, LAP, insurance…?" />
                <input className={inp()} value={productInterestStated} onChange={(e) => setProductInterestStated(e.target.value)} placeholder="e.g. Home Loans, LAP" />
              </div>
              <div>
                <FLabel text="5 · Product / Demand Fit" />
                <AskQ q="(your read) Does what they bring match what we actually sell?" />
                <SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_FIT_OPTS]} value={productDemandFit} onChange={setProductDemandFit} />
              </div>
              <div>
                <FLabel text="6 · Prior Track Record" />
                <AskQ q="Have you sourced loans or insurance before? Give me one or two examples." />
                <SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_TRACK_OPTS]} value={priorTrackRecord} onChange={setPriorTrackRecord} />
              </div>
              <div>
                <FLabel text="7 · Expected Volume" />
                <AskQ q="How many cases a month do you honestly expect to bring?" />
                <SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_VOLUME_OPTS]} value={expectedMonthlyVolume} onChange={setExpectedMonthlyVolume} />
              </div>
              <div>
                <FLabel text="8 · KYC Readiness" />
                <AskQ q="Do you have PAN, Aadhaar and bank details ready to share?" />
                <SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_KYC_OPTS]} value={kycReadinessInput} onChange={setKycReadinessInput} />
              </div>
            </div>
            <div><FLabel text="Track Record Notes" /><textarea className={`${inp()} min-h-13`} value={trackRecordNotes} onChange={(e) => setTrackRecordNotes(e.target.value)} placeholder="Examples / references they gave" /></div>
            <div>
              <AskQ q="9 · Do you already hold a DSA code with any other company?" />
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={existingDsaCodeElsewhere} onChange={(e) => setExistingDsa(e.target.checked)} />
                Already holds a DSA code elsewhere (applies a scoring penalty)
              </label>
            </div>
            {existingDsaCodeElsewhere && <div><FLabel text="Conflict Notes" /><input className={inp()} value={conflictNotes} onChange={(e) => setConflictNotes(e.target.value)} placeholder="Which lender / arrangement?" /></div>}
            <div className="grid grid-cols-2 gap-3">
              <div><FLabel text="Next Action" /><SearchableSelect options={[{ value: '', label: '—' }, ...PARTNER_NEXT_ACTION_OPTS]} value={nextAction} onChange={setNextAction} /></div>
              <div><FLabel text="Screening Call Date" /><input type="date" className={inp()} value={screeningCallDate} onChange={(e) => setScreeningCallDate(e.target.value)} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={screeningCallDone} onChange={(e) => setScreeningCallDone(e.target.checked)} />
              Screening call done
            </label>

            {/* Read-only score breakdown — the tier is never a black box */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Score breakdown</span>
                {preview ? <span className="flex items-center gap-2"><TierBadge tier={preview.tier} /><span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{preview.totalScore} pts</span></span> : <span className="text-xs" style={{ color: 'var(--text-dim)' }}>loading rubric…</span>}
              </div>
              {preview && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {[['Network type', preview.networkTypeScore], ['Network size', preview.networkSizeScore], ['Product fit', preview.productFitScore], ['Track record', preview.trackRecordScore], ['Volume', preview.volumeScore], ['KYC readiness', preview.kycScore], ['DSA conflict', preview.conflictPenalty]].map(([k, v]) => (
                    <div key={k as string} className="flex justify-between"><span>{k}</span><span className="font-semibold" style={{ color: (v as number) < 0 ? '#f87171' : 'var(--text-primary)' }}>{v as number > 0 ? '+' : ''}{v as number}</span></div>
                  ))}
                </div>
              )}
              <p className="text-[10px] mt-2" style={{ color: 'var(--text-dim)' }}>Saved after you click {initial ? 'Save Changes' : 'Create'} — thresholds are set in the Partner Scoring tab.</p>
            </div>
          </>}

          {tab === 'assessment' && <>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Stage 2 — the hands-on check after screening. Give them a sample case brief, watch how they work,
              then rate each item below. All four ratings + a passing score are required before this candidate can be made <strong>Active</strong>.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FLabel text="Product knowledge" />
                <AskQ q="Walk me through how you'd pitch the products you want to work on." />
                <SearchableSelect options={[{ value: '', label: '— not rated —' }, ...PRACTICAL_OPTS.productKnowledge]} value={pa.productKnowledge} onChange={(v) => setPa((x) => ({ ...x, productKnowledge: v }))} />
              </div>
              <div>
                <FLabel text="Sample case quality" />
                <AskQ q="Here's a sample customer — send me the file you'd log for them." />
                <SearchableSelect options={[{ value: '', label: '— not rated —' }, ...PRACTICAL_OPTS.sampleCaseQuality]} value={pa.sampleCaseQuality} onChange={(v) => setPa((x) => ({ ...x, sampleCaseQuality: v }))} />
              </div>
              <div>
                <FLabel text="Responsiveness" />
                <AskQ q="(observe) How quickly did they respond through this process?" />
                <SearchableSelect options={[{ value: '', label: '— not rated —' }, ...PRACTICAL_OPTS.responsiveness]} value={pa.responsiveness} onChange={(v) => setPa((x) => ({ ...x, responsiveness: v }))} />
              </div>
              <div>
                <FLabel text="Process understanding" />
                <AskQ q="What documents does a home-loan file need, and what happens after login?" />
                <SearchableSelect options={[{ value: '', label: '— not rated —' }, ...PRACTICAL_OPTS.processUnderstanding]} value={pa.processUnderstanding} onChange={(v) => setPa((x) => ({ ...x, processUnderstanding: v }))} />
              </div>
            </div>
            <div>
              <FLabel text="Assessor Notes" />
              <textarea className={inp() + ' min-h-13'} value={pa.assessorNotes} onChange={(e) => setPa((x) => ({ ...x, assessorNotes: e.target.value }))} placeholder="What stood out, concerns, anything promised" />
            </div>
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Assessment result</span>
                {paPreview ? (
                  <span className="text-sm font-bold" style={{ color: paPreview.result === 'Pass' ? '#34d399' : paPreview.result === 'Fail' ? '#f87171' : '#fbbf24' }}>
                    {paPreview.result === 'Pending' ? `Pending — rate all four (${paPreview.totalScore}/${paPreview.maxScore} so far)` : `${paPreview.result} · ${paPreview.totalScore}/${paPreview.maxScore} (need ≥ ${rubric?.practical?.passThreshold ?? '—'})`}
                  </span>
                ) : <span className="text-xs" style={{ color: 'var(--text-dim)' }}>loading rubric…</span>}
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-dim)' }}>
                The chain: Screening score triages (Hot/Warm/Cold) → this assessment must PASS → agreement signed + PAN collected → only then can the stage be set to Active. Pulse enforces it — no side sheet needed.
              </p>
            </div>
          </>}

          {tab === 'onboarding' && <>
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Onboarding progress</span>
                <span className="text-sm font-bold" style={{ color: onbProgress === 100 ? '#34d399' : '#C9A961' }}>{onbProgress}%</span>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${onbProgress}%`, backgroundColor: onbProgress === 100 ? '#34d399' : '#C9A961' }} />
              </div>
            </div>
            {([
              ['panCollected', 'PAN collected'], ['aadhaarCollected', 'Aadhaar collected'], ['bankDetailsCollected', 'Bank details collected'],
              ['trainingCompleted', 'Training completed'], ['pulseAccessCreated', 'Pulse access created'], ['firstCaseLogged', 'First case logged'],
            ] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={onb[k]} onChange={(e) => setOnb((p) => ({ ...p, [k]: e.target.checked }))} /> {label}
              </label>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div><FLabel text="Agreement Sent" /><input type="date" className={inp()} value={onb.agreementSentDate} onChange={(e) => setOnb((p) => ({ ...p, agreementSentDate: e.target.value }))} /></div>
              <div><FLabel text="Agreement Signed" /><input type="date" className={inp()} value={onb.agreementSignedDate} onChange={(e) => setOnb((p) => ({ ...p, agreementSignedDate: e.target.value }))} /></div>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>KYC boxes flag that you've collected the docs; the actual PAN/Aadhaar/bank are stored (encrypted) in the Details tab.</p>
          </>}

          {tab === 'activity' && initial && (
            <ConnectorActivityTab connector={initial} />
          )}
          {tab === 'payouts' && initial && (
            <ConnectorPayoutsTab connector={initial} />
          )}

          {tab === 'activity' && initial && (
            <ConnectorActivityTab connector={initial} />
          )}
          {tab === 'payouts' && initial && (
            <ConnectorPayoutsTab connector={initial} />
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={save} disabled={busy}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {busy ? 'Saving…' : initial ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Activity & follow-up for a partner candidate — quick call/whatsapp/email/note
// logging (instant PATCH, arrayUnion timeline) + a follow-up scheduler that feeds
// the 15-min reminder sweep (bell + email to super admins when due).
const LOG_ACTIONS = [
  { key: 'call', label: '📞 Call' }, { key: 'whatsapp', label: '💬 WhatsApp' },
  { key: 'email', label: '✉️ Email' }, { key: 'note', label: '📝 Note' },
] as const;

// Payouts for a CON- partner: (a) per-product payout RULES — what we owe them
// per case sourced (flat / % of disbursed / % of our payout); read by the CRM 2.0
// disburse step to auto-create connector_payouts. (b) their payout ledger with
// mark-as-paid. Rules save instantly via the connector PATCH (server-sanitized).
const PAYOUT_BASIS_OPTS = [
  { value: 'DISBURSED_PCT', label: '% of disbursed amount' },
  { value: 'FINVASTRA_PCT', label: "% of Finvastra's payout" },
  { value: 'FLAT', label: 'Flat ₹ per case' },
];

function ConnectorPayoutsTab({ connector }: { connector: Connector }) {
  const toast = useToast();
  const { user } = useAuth();
  const { rows: products } = useCrm2Collection<WithId<Product>>('products');
  const productOpts = [{ value: 'ALL', label: 'All products (fallback)' },
    ...products.map((pr) => ({ value: pr.id, label: `${pr.name} (${pr.shortCode})` }))];
  const [rules, setRules] = useState(() => (connector.payoutRules ?? []).map((r) => ({
    productId: r.productId, basis: r.basis as string, value: String(r.value),
  })));
  const [saving, setSaving] = useState(false);
  const { payouts } = useConnectorPayouts(connector.id);
  const [payRef, setPayRef] = useState<Record<string, string>>({});

  const saveRules = async () => {
    setSaving(true);
    try {
      const clean = rules
        .filter((r) => r.productId && r.basis && r.value.trim() !== '')
        .map((r) => ({ productId: r.productId, basis: r.basis, value: Number(r.value) }));
      await apiCrm2('PATCH', `/api/crm2/connectors/${connector.id}`, { payoutRules: clean });
      toast.success('Payout rules saved — future disbursements auto-create their payout');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save rules'); }
    finally { setSaving(false); }
  };

  const markPaid = async (payoutId: string) => {
    const ref = (payRef[payoutId] ?? '').trim();
    if (!ref) { toast.error('Enter the payment reference (UTR) first'); return; }
    try {
      await markConnectorPayoutPaid(payoutId, user?.uid ?? '', ref);
      toast.success('Marked paid');
    } catch { toast.error('Could not mark paid'); }
  };

  const pending = payouts.filter((po) => po.status === 'pending');
  const paid = payouts.filter((po) => po.status === 'paid');

  return (
    <>
      <div className="rounded-xl p-4 space-y-2.5" style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#C9A961' }}>Payout rules (their share per sourced case)</p>
        {rules.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_5rem_auto] gap-2 items-center">
            <SearchableSelect options={productOpts} value={r.productId}
              onChange={(v) => setRules((p) => p.map((x, j) => (j === i ? { ...x, productId: v } : x)))} placeholder="Product" />
            <SearchableSelect options={PAYOUT_BASIS_OPTS} value={r.basis}
              onChange={(v) => setRules((p) => p.map((x, j) => (j === i ? { ...x, basis: v } : x)))} placeholder="Basis" />
            <input type="number" className={inp()} value={r.value} placeholder={r.basis === 'FLAT' ? '₹' : '%'}
              onChange={(e) => setRules((p) => p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <button onClick={() => setRules((p) => p.filter((_, j) => j !== i))}
              className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Remove">
              <X size={14} style={{ color: '#f87171' }} />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <button onClick={() => setRules((p) => [...p, { productId: 'ALL', basis: 'DISBURSED_PCT', value: '' }])}
            className="text-xs font-semibold" style={{ color: '#C9A961' }}>+ Add rule</button>
          <button onClick={saveRules} disabled={saving}
            className="text-xs font-semibold px-3.5 py-2 rounded-lg disabled:opacity-50"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            {saving ? 'Saving…' : 'Save rules'}
          </button>
        </div>
        <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
          Applied automatically when a case they sourced disburses (exact product wins, “All products” is the fallback; the disburse dialog can override per case). Without a rule, no payout is created.
        </p>
      </div>

      <div>
        <FLabel text={`Payout ledger — ${pending.length} pending · ${paid.length} paid`} />
        <div className="divide-y" style={{ borderColor: 'var(--shell-border)' }}>
          {payouts.length === 0 && <p className="py-3 text-sm text-center" style={{ color: 'var(--text-dim)' }}>No payouts yet — they appear when a sourced case disburses.</p>}
          {payouts.map((po) => (
            <div key={po.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  ₹{po.amount.toLocaleString('en-IN')}
                  <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>{po.caseLabel || po.caseId || po.businessLine}</span>
                  {po.auto === false && <span className="ml-2 text-[10px]" style={{ color: '#fbbf24' }}>overridden</span>}
                </p>
                {po.status === 'paid' && <p className="text-[11px]" style={{ color: '#34d399' }}>Paid · {po.paymentReference ?? ''}</p>}
              </div>
              {po.status === 'pending' ? (
                <span className="flex items-center gap-2">
                  <input className={`${inp()} w-36`} placeholder="UTR / reference" value={payRef[po.id] ?? ''}
                    onChange={(e) => setPayRef((p) => ({ ...p, [po.id]: e.target.value }))} />
                  <button onClick={() => void markPaid(po.id)}
                    className="text-xs font-semibold px-3 py-2 rounded-lg" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                    Mark paid
                  </button>
                </span>
              ) : <span className="badge-glass-success">Paid</span>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function ConnectorActivityTab({ connector }: { connector: Connector }) {
  const toast = useToast();
  const [entries, setEntries] = useState(connector.activityLog ?? []);
  const [action, setAction] = useState<string>('call');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fuAt, setFuAt] = useState(() => {
    const d = connector.nextFollowUpAt?.toDate?.();
    return d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  });
  const [fuNote, setFuNote] = useState(connector.nextFollowUpNote ?? '');
  const [fuBusy, setFuBusy] = useState(false);

  const logEntry = async () => {
    if (note.trim().length < 3) { toast.error('Write a short note about what happened'); return; }
    setBusy(true);
    try {
      await apiCrm2('PATCH', `/api/crm2/connectors/${connector.id}`, { activity: { action, note: note.trim() } });
      setEntries((p) => [...p, { at: { toDate: () => new Date() } as never, by: 'you', note: note.trim(), action }]);
      setNote('');
      toast.success('Logged');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not log'); }
    finally { setBusy(false); }
  };

  const saveFollowUp = async () => {
    setFuBusy(true);
    try {
      await apiCrm2('PATCH', `/api/crm2/connectors/${connector.id}`, {
        nextFollowUpAt: fuAt ? new Date(fuAt).toISOString() : null,
        nextFollowUpNote: fuNote.trim() || null,
      });
      toast.success(fuAt ? 'Follow-up scheduled — you will get a bell + email when it is due' : 'Follow-up cleared');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save follow-up'); }
    finally { setFuBusy(false); }
  };

  const sorted = [...entries].sort((a, b) => {
    const am = (a.at as { toDate?: () => Date })?.toDate?.()?.getTime() ?? 0;
    const bm = (b.at as { toDate?: () => Date })?.toDate?.()?.getTime() ?? 0;
    return bm - am;
  });

  return (
    <>
      {/* Follow-up scheduler */}
      <div className="rounded-xl p-4 space-y-2.5" style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#C9A961' }}>Follow-up</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FLabel text="Reach them again on" />
            <input type="datetime-local" className={inp()} value={fuAt} onChange={(e) => setFuAt(e.target.value)} />
          </div>
          <div>
            <FLabel text="Why / what they asked" />
            <input className={inp()} value={fuNote} onChange={(e) => setFuNote(e.target.value)} placeholder="e.g. asked to call after 20th, travelling" />
          </div>
        </div>
        <button onClick={saveFollowUp} disabled={fuBusy}
          className="text-xs font-semibold px-3.5 py-2 rounded-lg disabled:opacity-50"
          style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
          {fuBusy ? 'Saving…' : 'Save follow-up'}
        </button>
        <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
          When it is due you get an in-app bell + email, and the row shows red in the Connectors list.
        </p>
      </div>

      {/* Quick log */}
      <div>
        <FLabel text="Log an interaction" />
        <div className="flex items-center gap-1.5 mb-2">
          {LOG_ACTIONS.map((a) => (
            <button key={a.key} onClick={() => setAction(a.key)}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors"
              style={action === a.key
                ? { backgroundColor: '#0B1538', color: '#E5C97C' }
                : { backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-secondary)' }}>
              {a.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input className={inp()} value={note} onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void logEntry(); }}
            placeholder="What happened on this call / message?" />
          <button onClick={logEntry} disabled={busy}
            className="shrink-0 text-xs font-semibold px-3.5 py-2.5 rounded-lg disabled:opacity-50"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            {busy ? '…' : 'Log'}
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div className="divide-y" style={{ borderColor: 'var(--shell-border)' }}>
        {sorted.length === 0 && (
          <p className="py-4 text-sm text-center" style={{ color: 'var(--text-dim)' }}>No interactions logged yet.</p>
        )}
        {sorted.map((e, i) => {
          const d = (e.at as { toDate?: () => Date })?.toDate?.();
          const meta = LOG_ACTIONS.find((a) => a.key === e.action);
          return (
            <div key={i} className="py-2 flex items-baseline justify-between gap-3">
              <p className="text-sm min-w-0" style={{ color: 'var(--text-primary)' }}>
                <span className="mr-1.5">{(meta?.label ?? '📝').split(' ')[0]}</span>{e.note}
                <span className="ml-2 text-[10px]" style={{ color: 'var(--text-dim)' }}>{e.by}</span>
              </p>
              <span className="text-[11px] shrink-0" style={{ color: 'var(--text-dim)' }}>
                {d ? d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : ''}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
