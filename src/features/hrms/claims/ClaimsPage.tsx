import { useState } from 'react';
import { format } from 'date-fns';
import { PlusCircle, ReceiptText, Car, Smartphone, Heart, Fuel, Users, HelpCircle, X, Paperclip, FileText, CreditCard, Laptop, Package } from 'lucide-react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../../../lib/firebase';
import { compressImage, formatBytes } from '../../../lib/imageCompression';
import { useAuth } from '../../auth/AuthContext';
import { useMyClaims, submitClaim, cancelClaim } from '../hooks/useClaims';
import type { ClaimType, ClaimStatus, Claim, ClaimTravelDetails } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CLAIM_TYPE_META: Record<ClaimType, { label: string; icon: typeof Car; color: string }> = {
  travel:               { label: 'Travel',               icon: Car,         color: '#60a5fa' },
  mobile:               { label: 'Mobile',               icon: Smartphone,  color: '#a78bfa' },
  medical:              { label: 'Medical',              icon: Heart,       color: '#f87171' },
  petrol:               { label: 'Petrol',               icon: Fuel,        color: '#fbbf24' },
  client_entertainment: { label: 'Client Entertainment', icon: Users,       color: '#34d399' },
  cibil:                { label: 'CIBIL',                icon: CreditCard,  color: '#22d3ee' },
  software:             { label: 'Software',             icon: Laptop,      color: '#818cf8' },
  office_supplies:      { label: 'Office Supplies',      icon: Package,     color: '#fb923c' },
  other:                { label: 'Other',                icon: HelpCircle,  color: 'var(--text-muted)' },
};

// Categories offered when creating a NEW claim — 'mobile' retired (kept in META for old claims).
const NEW_CLAIM_TYPES: ClaimType[] = ['travel', 'medical', 'petrol', 'client_entertainment', 'cibil', 'software', 'office_supplies', 'other'];

const STATUS_STYLES: Record<ClaimStatus, { label: string; bg: string; color: string }> = {
  pending:  { label: 'Pending',  bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24' },
  approved: { label: 'Approved', bg: 'rgba(96,165,250,0.15)',  color: '#60a5fa' },
  rejected: { label: 'Rejected', bg: 'rgba(248,113,113,0.15)', color: '#f87171' },
  paid:     { label: 'Paid',     bg: 'rgba(52,211,153,0.15)',  color: '#34d399' },
};

function toTs(ts: unknown): Date | null {
  if (!ts) return null;
  if (typeof (ts as { toDate?: unknown }).toDate === 'function') return (ts as { toDate: () => Date }).toDate();
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
  const [file, setFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [expenseDate, setExpenseDate] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const isTravel = claimType === 'travel';

  const onPickFile = (f: File | null) => {
    setError('');
    if (!f) { setFile(null); return; }
    const okType = f.type.startsWith('image/') || f.type === 'application/pdf';
    if (!okType) { setError('Please attach an image or a PDF.'); return; }
    if (f.size > 10 * 1024 * 1024) { setError('File too large — max 10 MB.'); return; }
    setFile(f);
  };

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
      // Upload the bill first (compress images client-side), then create the claim.
      let receiptUrl: string | null = null;
      if (file) {
        const toUpload = await compressImage(file);   // PDFs/undecodable pass through unchanged
        if (toUpload.size > 10 * 1024 * 1024) { setError('File too large — max 10 MB.'); setSubmitting(false); return; }
        const ext  = toUpload.name.includes('.') ? toUpload.name.slice(toUpload.name.lastIndexOf('.')) : '';
        const path = `claim-receipts/${user.uid}/${Date.now()}${ext}`;
        const task = uploadBytesResumable(ref(storage, path), toUpload, { contentType: toUpload.type });
        setUploadPct(0);
        receiptUrl = await new Promise<string>((resolve, reject) => {
          task.on('state_changed',
            (s) => setUploadPct(Math.round((s.bytesTransferred / s.totalBytes) * 100)),
            reject,
            async () => resolve(await getDownloadURL(task.snapshot.ref)),
          );
        });
        setUploadPct(null);
      }
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
        receiptUrl,
        expenseDate: expenseDate ? new Date(expenseDate).toISOString() : null,
      });
      onClose();
    } catch {
      setUploadPct(null);
      setError('Failed to submit. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 glass-modal-overlay">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto glass-modal-panel">
        <div className="flex items-center justify-between p-6 glass-modal-header">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>New Claim</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors nav-item-hover">
            <X size={18} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Claim Type
            </label>
            <select className="glass-inp w-full text-sm" value={claimType} onChange={(e) => setClaimType(e.target.value as ClaimType)}>
              {NEW_CLAIM_TYPES.map((k) => (
                <option key={k} value={k}>{CLAIM_TYPE_META[k].label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Amount (₹) *
            </label>
            <input type="number" className="glass-inp w-full text-sm" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00" min="1" max="50000" step="0.01" />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Description *
            </label>
            <textarea className="glass-inp w-full text-sm resize-none" rows={3} value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the expense…" maxLength={500} />
          </div>

          {isTravel && (
            <div className="space-y-3 p-4 rounded-xl" style={{ backgroundColor: 'var(--glass-panel-bg)', border: '1px solid var(--shell-border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Travel Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>From</label>
                  <input className="glass-inp w-full text-sm" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Office" />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>To</label>
                  <input className="glass-inp w-full text-sm" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Client site" />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Distance (km)</label>
                  <input type="number" className="glass-inp w-full text-sm" value={distance} onChange={(e) => setDistance(e.target.value)}
                    placeholder="0" min="0" step="0.1" />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Mode</label>
                  <input className="glass-inp w-full text-sm" value={mode} onChange={(e) => setMode(e.target.value)} placeholder="Auto / Own vehicle" />
                </div>
              </div>
            </div>
          )}

          {/* Bill date & time — for spend analysis */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Bill Date &amp; Time <span className="normal-case tracking-normal opacity-70">(when the expense occurred)</span>
            </label>
            <input type="datetime-local" className="glass-inp w-full text-sm" value={expenseDate}
              max={new Date().toISOString().slice(0, 16)}
              onChange={(e) => setExpenseDate(e.target.value)} />
          </div>

          {/* Attach bill / receipt — drag & drop or browse; images compressed in-browser */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Attach Bill <span className="normal-case tracking-normal opacity-70">(photo or PDF — optional)</span>
            </label>
            {!file ? (
              <label
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); onPickFile(e.dataTransfer.files?.[0] ?? null); }}
                className="flex flex-col items-center justify-center gap-1.5 py-6 rounded-xl cursor-pointer text-sm text-center transition-colors"
                style={{
                  border: `1.5px dashed ${dragOver ? '#C9A961' : 'var(--shell-border)'}`,
                  backgroundColor: dragOver ? 'rgba(201,169,97,0.10)' : 'transparent',
                  color: 'var(--text-muted)',
                }}>
                <Paperclip size={18} />
                <span>Drag &amp; drop a photo or PDF here,<br />or <span style={{ color: '#C9A961', fontWeight: 600 }}>browse</span></span>
                <input type="file" accept="image/*,application/pdf" className="hidden"
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)} />
              </label>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                style={{ border: '1px solid var(--shell-border)', backgroundColor: 'var(--glass-panel-bg)' }}>
                <FileText size={15} style={{ color: '#C9A961' }} className="shrink-0" />
                <span className="text-sm truncate flex-1" style={{ color: 'var(--text-primary)' }}>{file.name}</span>
                <span className="text-[11px] shrink-0" style={{ color: 'var(--text-muted)' }}>{formatBytes(file.size)}</span>
                <button type="button" onClick={() => setFile(null)} className="p-1 rounded hover:bg-(--shell-hover-mid) shrink-0" aria-label="Remove file">
                  <X size={13} style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>
            )}
            {uploadPct !== null && (
              <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-border)' }}>
                <div className="h-full transition-all" style={{ width: `${uploadPct}%`, backgroundColor: '#C9A961' }} />
              </div>
            )}
          </div>

          {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={submitting}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all hover:brightness-110 disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, rgba(201,169,97,0.85), rgba(154,126,63,0.85))',
                color:      '#0B1538',
                border:     '1px solid rgba(201,169,97,0.40)',
              }}>
              {submitting ? (uploadPct !== null ? `Uploading… ${uploadPct}%` : 'Submitting…') : 'Submit Claim'}
            </button>
            <button type="button" onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm transition-colors hover:bg-(--shell-hover-mid)"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--shell-border-mid)' }}>
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
  const st = STATUS_STYLES[claim.status];
  const Icon = meta.icon;
  const submittedDate = toTs(claim.submittedAt);

  return (
    <div className="flex items-center gap-4 py-3 last:border-0" style={{ borderBottom: '1px solid var(--shell-border)' }}>
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: meta.color + '20', color: meta.color }}
      >
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{claim.description}</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {meta.label}{claim.expenseDate
            ? ` · ${format(new Date(claim.expenseDate), 'dd MMM yyyy, h:mm a')}`
            : (submittedDate ? ` · ${format(submittedDate, 'dd MMM yyyy')}` : '')}
        </p>
      </div>
      <p className="text-sm font-semibold shrink-0" style={{ color: 'var(--text-primary)' }}>₹{claim.amount.toLocaleString('en-IN')}</p>
      {claim.receiptUrl && (
        <a href={claim.receiptUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs shrink-0 transition-colors hover:opacity-70"
          style={{ color: '#C9A961' }} title="View attached bill">
          <Paperclip size={13} /> Bill
        </a>
      )}
      <span
        className="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide shrink-0"
        style={{ backgroundColor: st.bg, color: st.color }}
      >
        {st.label}
      </span>
      {claim.status === 'pending' && (
        <button
          onClick={onCancel}
          className="text-xs transition-colors hover:opacity-60 shrink-0"
          style={{ color: 'var(--text-muted)' }}
        >
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
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            My Claims
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Submit and track your expense reimbursements.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:brightness-110"
          style={{
            background: 'linear-gradient(135deg, rgba(201,169,97,0.85), rgba(154,126,63,0.85))',
            color:      '#0B1538',
            border:     '1px solid rgba(201,169,97,0.40)',
          }}
        >
          <PlusCircle size={16} />
          New Claim
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Claimed',  value: total,    color: 'var(--text-primary)' },
          { label: 'Approved', value: approved, color: '#60a5fa'             },
          { label: 'Pending',  value: pending,  color: '#fbbf24'             },
          { label: 'Paid',     value: paid,     color: '#34d399'             },
        ].map(({ label, value, color }) => (
          <div key={label} className="glass-panel glass-card p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p className="text-lg font-bold" style={{ color }}>₹{value.toLocaleString('en-IN')}</p>
            <p className="text-xs" style={{ color: 'var(--text-dim)' }}>this month</p>
          </div>
        ))}
      </div>

      {/* Claims list */}
      <div className="glass-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>All Claims</p>
          <div className="flex items-center gap-1.5">
            <ReceiptText size={14} style={{ color: 'var(--text-muted)' }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{claims.length} total</span>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="h-12 rounded-lg animate-pulse" style={{ backgroundColor: 'var(--glass-panel-bg)' }} />
            ))}
          </div>
        ) : claims.length === 0 ? (
          <div className="text-center py-10">
            <ReceiptText size={40} className="mx-auto mb-3" style={{ color: 'rgba(201,169,97,0.30)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No claims submitted yet.</p>
            <button
              onClick={() => setShowModal(true)}
              className="mt-3 text-sm underline transition-opacity hover:opacity-70"
              style={{ color: '#C9A961' }}
            >
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
