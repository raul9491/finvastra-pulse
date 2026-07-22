/**
 * The connector self-service screens: Home · My Leads (add + list) · My Cases ·
 * My Payouts · My Details.
 *
 * Every read here is already narrowed by firestore.rules to the caller's own
 * `channelPartnerId` — these components never pass a partner id anywhere, so
 * there is no parameter to tamper with. Submitting a lead posts to
 * /api/crm2/crm2/leads, which FORCES the sourcing attribution to the caller's own
 * CON- id and ignores anything the body claims.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { inr } from '../../lib/money';
import { FLabel, inp } from '../crm2/formPrimitives';
import { apiCrm2 } from '../crm2/lib';
import { useToast } from '../../components/ui/Toast';
import {
  useMyConnectorId, usePartnerMe, usePartnerSummary, useMyLeads, useMyCases, useMyPayouts,
} from './usePartner';

// ── shared bits ───────────────────────────────────────────────────────────────
function Title({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl sm:text-3xl mb-1"
        style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
        {text}
      </h1>
      {sub && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="glass-panel p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-2xl font-semibold" style={{ color: accent ?? 'var(--text-primary)' }}>{value}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="glass-panel p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>{text}</div>;
}

const fmtDate = (ts: unknown): string => {
  const d = (ts as { toDate?: () => Date } | null | undefined)?.toDate?.();
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
};

// Deliberately coarse: a partner sees progress, not our lender-by-lender detail.
const CASE_STATE: Record<string, { label: string; color: string }> = {
  OPENED:      { label: 'Received',    color: '#8B8B85' },
  BASIC_DOCS:  { label: 'In progress', color: '#3B82F6' },
  DOCS:        { label: 'In progress', color: '#3B82F6' },
  IN_PROGRESS: { label: 'In progress', color: '#3B82F6' },
  COMPLETED:   { label: 'Completed',   color: '#10B981' },
  CLOSED:      { label: 'Closed',      color: '#DC2626' },
};
const caseState = (stage: unknown) => CASE_STATE[String(stage)] ?? { label: 'In progress', color: '#3B82F6' };

// ── Home ──────────────────────────────────────────────────────────────────────
export function PartnerHomePage() {
  const { me } = usePartnerMe();
  const { summary, loading } = usePartnerSummary();
  const name = me?.connector.displayName ?? 'there';

  return (
    <div>
      <Title text={`Welcome, ${name}`} sub="Your leads, their progress, and what you're owed." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Leads submitted" value={loading ? '—' : String(summary?.leads.total ?? 0)} />
        <Stat label="Cases open" value={loading ? '—' : String(summary?.cases.open ?? 0)} />
        <Stat label="Payout pending" value={loading ? '—' : inr(summary?.payouts.pending ?? 0)} accent="#C9A961" />
        <Stat label="Payout received" value={loading ? '—' : inr(summary?.payouts.paid ?? 0)} accent="#10B981" />
      </div>
      <div className="glass-panel p-5">
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Have a new customer?</p>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          Submit their details and our team will pick it up from there. You'll see the progress under My Cases.
        </p>
        <Link to="/partner/leads" className="inline-block text-sm font-semibold px-4 py-2 rounded-lg"
          style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
          Submit a lead →
        </Link>
      </div>
    </div>
  );
}

// ── My Leads (submit + list) ──────────────────────────────────────────────────
const VERTICALS = [
  { value: 'LOAN', label: 'Loan' },
  { value: 'WEALTH', label: 'Wealth' },
  { value: 'INSURANCE', label: 'Insurance' },
];

export function PartnerLeadsPage() {
  const connectorId = useMyConnectorId();
  const { leads, loading } = useMyLeads(connectorId);
  const toast = useToast();

  const [form, setForm] = useState({ name: '', mobile: '', email: '', city: '', category: 'LOAN', amountRequired: '', note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form, v: string) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((p) => { const n = { ...p }; delete n[k]; return n; });
  };

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Required';
    if (!/^[6-9]\d{9}$/.test(form.mobile.trim())) errs.mobile = 'Enter a 10-digit mobile number';
    if (form.email.trim() && !form.email.includes('@')) errs.email = 'Enter a valid email';
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSaving(true);
    try {
      // NOTE: no partner id is sent — the server stamps the caller's own.
      await apiCrm2('POST', '/api/crm2/leads', {
        name: form.name.trim(),
        mobile: form.mobile.trim(),
        email: form.email.trim() || undefined,
        city: form.city.trim() || undefined,
        category: form.category,
        source: 'REFERRAL_SUBDSA',
        amountRequired: form.amountRequired ? Number(form.amountRequired) : undefined,
        nextFollowUpNote: form.note.trim() || undefined,
      });
      toast.success('Lead submitted — our team will pick it up.');
      setForm({ name: '', mobile: '', email: '', city: '', category: 'LOAN', amountRequired: '', note: '' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not submit the lead');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Title text="My Leads" sub="Submit a customer you've sourced, and track what happened to each one." />

      <div className="glass-panel p-5 mb-6">
        <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Submit a new lead</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            {FLabel({ text: 'Customer name', required: true, error: errors.name })}
            <input className={inp(!!errors.name)} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" />
          </div>
          <div>
            {FLabel({ text: 'Mobile', required: true, error: errors.mobile })}
            <input className={inp(!!errors.mobile)} value={form.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="10-digit number" inputMode="numeric" />
          </div>
          <div>
            {FLabel({ text: 'Vertical', required: true })}
            <select className={inp()} value={form.category} onChange={(e) => set('category', e.target.value)}>
              {VERTICALS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
          <div>
            {FLabel({ text: 'Amount required' })}
            <input className={inp()} value={form.amountRequired} onChange={(e) => set('amountRequired', e.target.value.replace(/[^\d]/g, ''))} placeholder="e.g. 2500000" inputMode="numeric" />
          </div>
          <div>
            {FLabel({ text: 'Email', error: errors.email })}
            <input className={inp(!!errors.email)} value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="Optional" />
          </div>
          <div>
            {FLabel({ text: 'City' })}
            <input className={inp()} value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Optional" />
          </div>
          <div className="sm:col-span-2">
            {FLabel({ text: 'Anything we should know' })}
            <textarea className={`${inp()} resize-none`} rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Optional — context that helps our team" />
          </div>
        </div>
        <button onClick={submit} disabled={saving}
          className="mt-4 text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
          style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
          {saving ? 'Submitting…' : 'Submit lead'}
        </button>
      </div>

      <p className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        Submitted leads {leads.length > 0 && <span style={{ color: 'var(--text-muted)' }}>({leads.length})</span>}
      </p>
      {loading ? <Empty text="Loading…" />
        : leads.length === 0 ? <Empty text="No leads submitted yet." />
        : (
          <div className="glass-panel overflow-x-auto">
            <table className="w-full text-sm glass-table">
              <thead><tr>
                <th className="text-left px-4 py-2">Customer</th>
                <th className="text-left px-4 py-2">Vertical</th>
                <th className="text-left px-4 py-2">Submitted</th>
                <th className="text-left px-4 py-2">Status</th>
              </tr></thead>
              <tbody>
                {leads
                  .slice()
                  .sort((a, b) => String(b.receivedAt ?? '').localeCompare(String(a.receivedAt ?? '')))
                  .map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2" style={{ color: 'var(--text-primary)' }}>{String(l.name ?? '—')}</td>
                      <td className="px-4 py-2" style={{ color: 'var(--text-muted)' }}>{String(l.category ?? '—')}</td>
                      <td className="px-4 py-2" style={{ color: 'var(--text-muted)' }}>{fmtDate(l.receivedAt)}</td>
                      <td className="px-4 py-2">
                        <span style={{ color: l.converted === true ? '#10B981' : 'var(--text-muted)' }}>
                          {l.converted === true ? 'Converted to a case' : 'With our team'}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

// ── My Cases ──────────────────────────────────────────────────────────────────
export function PartnerCasesPage() {
  const connectorId = useMyConnectorId();
  const { cases, loading } = useMyCases(connectorId);

  return (
    <div>
      <Title text="My Cases" sub="Leads that became live cases, and where each one has reached." />
      {loading ? <Empty text="Loading…" />
        : cases.length === 0 ? <Empty text="No cases yet. Once a lead you submitted is taken up, it appears here." />
        : (
          <div className="space-y-2">
            {cases.map((c) => {
              const st = caseState(c.stage);
              return (
                <div key={c.id} className="glass-panel p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {String(c.clientName ?? c.id)}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {c.id}{c.productName ? ` · ${String(c.productName)}` : ''} · opened {fmtDate(c.createdAt)}
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full shrink-0"
                    style={{ backgroundColor: `${st.color}1A`, color: st.color }}>
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

// ── My Payouts ────────────────────────────────────────────────────────────────
export function PartnerPayoutsPage() {
  const connectorId = useMyConnectorId();
  const { payouts, loading } = useMyPayouts(connectorId);

  const pending = payouts.filter((p) => p.status !== 'paid').reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const paid = payouts.filter((p) => p.status === 'paid').reduce((s, p) => s + (Number(p.amount) || 0), 0);

  return (
    <div>
      <Title text="My Payouts" sub="What you've earned on the cases you sourced." />
      <div className="grid grid-cols-2 gap-3 mb-5">
        <Stat label="Pending" value={inr(pending)} accent="#C9A961" />
        <Stat label="Received" value={inr(paid)} accent="#10B981" />
      </div>
      {loading ? <Empty text="Loading…" />
        : payouts.length === 0 ? <Empty text="No payouts yet. These appear once a case you sourced is disbursed." />
        : (
          <div className="glass-panel overflow-x-auto">
            <table className="w-full text-sm glass-table">
              <thead><tr>
                <th className="text-left px-4 py-2">Case</th>
                <th className="text-left px-4 py-2">Amount</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Paid on</th>
              </tr></thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2" style={{ color: 'var(--text-primary)' }}>{String(p.caseLabel ?? p.caseId ?? '—')}</td>
                    <td className="px-4 py-2 font-semibold" style={{ color: 'var(--text-primary)' }}>{inr(Number(p.amount) || 0)}</td>
                    <td className="px-4 py-2">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={p.status === 'paid'
                          ? { backgroundColor: 'rgba(16,185,129,0.12)', color: '#10B981' }
                          : { backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
                        {p.status === 'paid' ? 'Paid' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-2" style={{ color: 'var(--text-muted)' }}>{p.status === 'paid' ? fmtDate(p.paidAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

// ── My Details ────────────────────────────────────────────────────────────────
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-2 py-2" style={{ borderBottom: '1px solid var(--shell-border)' }}>
      <span className="w-40 shrink-0 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-sm min-w-0" style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

export function PartnerProfilePage() {
  const { me, loading, error } = usePartnerMe();

  if (loading) return <Empty text="Loading your details…" />;
  if (error || !me) return <Empty text={error || 'Could not load your details.'} />;

  const c = me.connector;
  return (
    <div>
      <Title text="My Details" sub="What we hold on record for you. To change any of it, contact your Finvastra manager." />

      <div className="glass-panel p-5 mb-4">
        <p className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Partner</p>
        <Row label="Partner code" value={c.connectorCode} />
        <Row label="Name" value={c.displayName ?? '—'} />
        {c.firmName && <Row label="Firm" value={c.firmName} />}
        <Row label="Mobile" value={c.mobiles.length ? c.mobiles.join(', ') : (c.mobile ?? '—')} />
        <Row label="Email" value={c.email ?? '—'} />
        <Row label="Verticals" value={c.verticals.length ? c.verticals.join(', ') : '—'} />
        {c.gstin && <Row label="GSTIN" value={c.gstin} />}
      </div>

      <div className="glass-panel p-5 mb-4">
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>KYC</p>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          Only the last 4 digits are shown — the full numbers are encrypted and never leave our servers.
        </p>
        <Row label="PAN" value={me.kyc.panLast4 ? `••••••${me.kyc.panLast4}` : 'Not on record'} />
        <Row label="Aadhaar" value={me.kyc.aadhaarLast4 ? `••••••••${me.kyc.aadhaarLast4}` : 'Not on record'} />
      </div>

      <div className="glass-panel p-5">
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Payout account</p>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Where your payouts are sent.</p>
        <Row label="Bank" value={me.bank.bankName ?? 'Not on record'} />
        <Row label="Account holder" value={me.bank.accountHolderName ?? '—'} />
        <Row label="Account number" value={me.bank.accountNoLast4 ? `••••••${me.bank.accountNoLast4}` : 'Not on record'} />
        <Row label="IFSC" value={me.bank.ifsc ?? '—'} />
        {me.bank.branchName && <Row label="Branch" value={me.bank.branchName} />}
        {me.tdsPct != null && <Row label="TDS" value={`${me.tdsPct}%`} />}
      </div>
    </div>
  );
}
