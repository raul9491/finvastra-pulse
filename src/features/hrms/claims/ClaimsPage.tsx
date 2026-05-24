import { useState } from 'react';
import { format } from 'date-fns';
import { PlusCircle, ReceiptText, Car, Smartphone, Heart, Fuel, Users, HelpCircle, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useMyClaims, submitClaim, cancelClaim } from '../hooks/useClaims';
import type { ClaimType, ClaimStatus, Claim, ClaimTravelDetails } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CLAIM_TYPE_META: Record<ClaimType, { label: string; icon: typeof Car; color: string }> = {
  travel:               { label: 'Travel',               icon: Car,         color: '#3B82F6' },
  mobile:               { label: 'Mobile',               icon: Smartphone,  color: '#8B5CF6' },
  medical:              { label: 'Medical',              icon: Heart,       color: '#EF4444' },
  petrol:               { label: 'Petrol',               icon: Fuel,        color: '#F59E0B' },
  client_entertainment: { label: 'Client Entertainment', icon: Users,       color: '#10B981' },
  other:                { label: 'Other',                icon: HelpCircle,  color: '#8B8B85' },
};

const STATUS_STYLES: Record<ClaimStatus, { label: string; bg: string; color: string }> = {
  pending:  { label: 'Pending',  bg: '#FFFBEB', color: '#92400E' },
  approved: { label: 'Approved', bg: '#EFF6FF', color: '#1D4ED8' },
  rejected: { label: 'Rejected', bg: '#FFF1F2', color: '#BE123C' },
  paid:     { label: 'Paid',     bg: '#F0FDF4', color: '#166534' },
};

function toTs(ts: any): Date | null {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  return null;
}

// ─── New Claim Modal ──────────────────────────────────────────────────────────

function NewClaimModal({ employeeName, onClose }: { employeeName: string; onClose: () => void }) {
  const { user } = useAuth();
  const [claimType, setClaimType] = useState<ClaimType>('travel');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [distance, setDistance] = useState('');
  const [mode, setMode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isTravel = claimType === 'travel';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0 || amt > 50000) { setError('Amount must be between ₹1 and ₹50,000.'); return; }
    if (description.trim().length < 5) { setError('Please describe the expense.'); return; }
    if (isTravel && (!from.trim() || !to.trim() || !distance || !mode.trim())) {
      setError('Please fill all travel details.'); return;
    }
    setSubmitting(true);
    setError('');
    try {
      const travel: ClaimTravelDetails | undefined = isTravel
        ? { fromLocation: from.trim(), toLocation: to.trim(), distanceKm: parseFloat(distance), modeOfTransport: mode.trim() }
        : undefined;
      await submitClaim({
        employeeId: user.uid,
        employeeName,
        claimType,
        amount: amt,
        description: description.trim(),
        ...(travel ? { travelDetails: travel } : {}),
      });
      onClose();
    } catch {
      setError('Failed to submit. Please try again.');
      setSubmitting(false);
    }
  };

  const inp = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-navy/10 focus:border-navy';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h3 className="text-lg font-semibold" style={{ color: '#0A0A0A' }}>New Claim</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
            <X size={18} style={{ color: '#8B8B85' }} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
              Claim Type
            </label>
            <select className={inp} value={claimType} onChange={(e) => setClaimType(e.target.value as ClaimType)}>
              {Object.entries(CLAIM_TYPE_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
              Amount (₹) *
            </label>
            <input type="number" className={inp} value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00" min="1" max="50000" step="0.01" />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
              Description *
            </label>
            <textarea className={`${inp} resize-none`} rows={3} value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the expense…" maxLength={500} />
          </div>

          {isTravel && (
            <div className="space-y-3 p-4 rounded-xl" style={{ backgroundColor: '#F2EFE7' }}>
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Travel Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs mb-1" style={{ color: '#8B8B85' }}>From</label>
                  <input className={inp} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Office" />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: '#8B8B85' }}>To</label>
                  <input className={inp} value={to} onChange={(e) => setTo(e.target.value)} placeholder="Client site" />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: '#8B8B85' }}>Distance (km)</label>
                  <input type="number" className={inp} value={distance} onChange={(e) => setDistance(e.target.value)}
                    placeholder="0" min="0" step="0.1" />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: '#8B8B85' }}>Mode</label>
                  <input className={inp} value={mode} onChange={(e) => setMode(e.target.value)} placeholder="Auto / Own vehicle" />
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={submitting}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              {submitting ? 'Submitting…' : 'Submit Claim'}
            </button>
            <button type="button" onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm border border-slate-200 hover:bg-slate-50 transition-colors"
              style={{ color: '#2A2A2A' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Claim Row ────────────────────────────────────────────────────────────────

function ClaimRow({ claim, onCancel }: { claim: Claim; onCancel: () => void }) {
  const meta = CLAIM_TYPE_META[claim.claimType];
  const style = STATUS_STYLES[claim.status];
  const Icon = meta.icon;
  const submittedDate = toTs(claim.submittedAt);

  return (
    <div className="flex items-center gap-4 py-3 border-b border-slate-50 last:border-0">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: meta.color + '15', color: meta.color }}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink truncate">{claim.description}</p>
        <p className="text-xs text-mute">
          {meta.label} · {submittedDate ? format(submittedDate, 'dd MMM yyyy') : '—'}
        </p>
      </div>
      <p className="text-sm font-semibold text-ink shrink-0">₹{claim.amount.toLocaleString('en-IN')}</p>
      <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide shrink-0"
        style={{ backgroundColor: style.bg, color: style.color }}>
        {style.label}
      </span>
      {claim.status === 'pending' && (
        <button onClick={onCancel} className="text-xs text-mute hover:text-red-600 transition-colors shrink-0">
          Cancel
        </button>
      )}
    </div>
  );
}

// ─── ClaimsPage ───────────────────────────────────────────────────────────────

export function ClaimsPage() {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? '';
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [showModal, setShowModal] = useState(false);
  const { claims, loading } = useMyClaims(uid);

  const thisMonth = claims.filter((c) => c.month === currentMonth);
  const total    = thisMonth.reduce((s, c) => s + c.amount, 0);
  const approved = thisMonth.filter((c) => c.status === 'approved').reduce((s, c) => s + c.amount, 0);
  const pending  = thisMonth.filter((c) => c.status === 'pending').reduce((s, c) => s + c.amount, 0);
  const paid     = thisMonth.filter((c) => c.status === 'paid').reduce((s, c) => s + c.amount, 0);

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this claim?')) return;
    await cancelClaim(id);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl mb-1"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
            My Claims
          </h2>
          <p className="text-sm" style={{ color: '#8B8B85' }}>Submit and track your expense reimbursements.</p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
          style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
          <PlusCircle size={16} />
          New Claim
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Claimed', value: total, color: '#0A0A0A' },
          { label: 'Approved', value: approved, color: '#1D4ED8' },
          { label: 'Pending', value: pending, color: '#92400E' },
          { label: 'Paid', value: paid, color: '#166534' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-mute mb-1">{label}</p>
            <p className="text-lg font-bold" style={{ color }}>₹{value.toLocaleString('en-IN')}</p>
            <p className="text-xs text-mute">this month</p>
          </div>
        ))}
      </div>

      {/* Claims list */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#475569' }}>All Claims</p>
          <div className="flex items-center gap-1.5">
            <ReceiptText size={14} style={{ color: '#8B8B85' }} />
            <span className="text-xs text-mute">{claims.length} total</span>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />)}</div>
        ) : claims.length === 0 ? (
          <div className="text-center py-10">
            <ReceiptText size={40} className="mx-auto mb-3" style={{ color: '#CBD5E1' }} />
            <p className="text-sm text-mute">No claims submitted yet.</p>
            <button onClick={() => setShowModal(true)} className="mt-3 text-sm underline hover:opacity-70 transition-opacity"
              style={{ color: '#0B1538' }}>
              Submit your first claim
            </button>
          </div>
        ) : (
          <div>
            {claims.map((c) => (
              <ClaimRow key={c.id} claim={c} onCancel={() => handleCancel(c.id)} />
            ))}
          </div>
        )}
      </div>

      {showModal && profile && (
        <NewClaimModal employeeName={profile.displayName} onClose={() => setShowModal(false)} />
      )}
    </div>
  );
}
