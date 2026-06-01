import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useAuth } from '../../auth/AuthContext';
import { useCommissionRecords, markCommissionPaid, markCommissionClawback } from '../hooks/useCommissionRecords';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useProviders } from '../hooks/useOpportunities';
import { Modal } from '../../../components/ui/Modal';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import type { CommissionRecord, CommissionRecordStatus } from '../../../types';

const STATUS_STYLES: Record<CommissionRecordStatus, { badgeClass: string; label: string }> = {
  pending:     { badgeClass: 'badge-glass-warning', label: 'Pending'     },
  paid:        { badgeClass: 'badge-glass-success', label: 'Paid'        },
  clawed_back: { badgeClass: 'badge-glass-danger',  label: 'Clawed Back' },
};

// ─── Mark Paid Modal ──────────────────────────────────────────────────────────
function MarkPaidModal({ record, onClose }: { record: CommissionRecord; onClose: () => void }) {
  const [actualAmount, setActualAmount] = useState(record.calculatedCommission.toString());
  const [actualDate,   setActualDate]   = useState(new Date().toISOString().slice(0, 10));
  const [notes,        setNotes]        = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      await markCommissionPaid(record.id, Number(actualAmount), actualDate, notes);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed.'); setSaving(false); }
  };

  return (
    <Modal isOpen onClose={onClose} title="Mark Commission as Paid" size="sm"
      footer={
        <>
          <button onClick={onClose}
            className="px-5 py-2.5 text-sm border rounded-xl hover:bg-white/5 transition-colors"
            style={{ color: 'var(--text-muted)', borderColor: 'rgba(255,255,255,0.12)' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {saving ? 'Saving…' : 'Confirm Payment'}
          </button>
        </>
      }>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Actual Amount Received ₹</label>
          <input type="number" value={actualAmount} onChange={(e) => setActualAmount(e.target.value)} className="glass-inp w-full text-sm" />
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Expected: ₹{record.calculatedCommission.toLocaleString('en-IN')}</p>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Payment Date</label>
          <input type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} className="glass-inp w-full text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Notes</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="glass-inp w-full text-sm" placeholder="Optional" />
        </div>
        {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Clawback Modal ───────────────────────────────────────────────────────────
function ClawbackModal({ record, onClose }: { record: CommissionRecord; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await markCommissionClawback(record.id, reason);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Modal isOpen onClose={onClose} title="Mark as Clawed Back" size="sm"
      footer={
        <>
          <button onClick={onClose}
            className="px-5 py-2.5 text-sm border rounded-xl hover:bg-white/5 transition-colors"
            style={{ color: 'var(--text-muted)', borderColor: 'rgba(255,255,255,0.12)' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !reason.trim()}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50 btn-glass-danger">
            {saving ? 'Saving…' : 'Confirm Clawback'}
          </button>
        </>
      }>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Reason *</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
          placeholder="e.g. Prepayment within 12 months"
          className="glass-inp w-full text-sm resize-none" />
      </div>
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function CommissionRecordsPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { records, loading } = useCommissionRecords(user?.uid ?? null, isAdmin);
  const { employees } = useAllEmployees();
  const providers = useProviders();

  const [filterRm,     setFilterRm]     = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [payRecord,    setPayRecord]    = useState<CommissionRecord | null>(null);
  const [clawRecord,   setClawRecord]   = useState<CommissionRecord | null>(null);

  const rmOptions = useMemo(() => employees.filter(e => e.crmAccess === true || e.role === 'admin'), [employees]);
  const providerMap = useMemo(() => new Map(providers.map(p => [p.id, p.name])), [providers]);
  const rmName = (uid: string) => employees.find(e => e.userId === uid)?.displayName ?? uid.slice(0, 8);

  const filtered = useMemo(() => records.filter(r => {
    if (filterRm     && r.rmOwnerId !== filterRm)     return false;
    if (filterStatus && r.status    !== filterStatus) return false;
    return true;
  }), [records, filterRm, filterStatus]);

  const totalExpected = filtered.reduce((s, r) => s + r.calculatedCommission, 0);
  const totalPaid     = filtered.filter(r => r.status === 'paid').reduce((s, r) => s + (r.actualAmount ?? r.calculatedCommission), 0);
  const pendingCount  = filtered.filter(r => r.status === 'pending').length;

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-3xl" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            Commission Records
          </h2>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total Expected', value: `₹${totalExpected.toLocaleString('en-IN')}` },
            { label: 'Total Received',  value: `₹${totalPaid.toLocaleString('en-IN')}` },
            { label: 'Pending',         value: `${pendingCount} records` },
          ].map(({ label, value }) => (
            <div key={label} className="glass-panel glass-card p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          {isAdmin && (
            <SearchableSelect
              options={[
                { value: '', label: 'All RMs' },
                ...rmOptions.map((e) => ({ value: e.userId, label: e.displayName })),
              ]}
              value={filterRm}
              onChange={(v) => setFilterRm(v)}
              label="Filter by RM"
            />
          )}
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="glass-inp text-sm">
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="clawed_back">Clawed Back</option>
          </select>
        </div>

        {/* Table */}
        <div className="glass-panel overflow-hidden">
          {loading ? (
            <div className="animate-pulse">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', backgroundColor: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No commission records yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    {['Opportunity', 'Bank', 'Disbursed ₹', 'Commission ₹', 'Expected Date', isAdmin ? 'RM' : null, 'Status', ''].filter(Boolean).map((h) => (
                      <th key={h!} className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const st = STATUS_STYLES[r.status];
                    const noSlab = r.notes?.includes('NO_SLAB_MATCH');
                    return (
                      <tr key={r.id} className="hover:bg-white/5 transition-colors"
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => navigate(`/crm/leads/${r.leadId}/opportunities/${r.opportunityId}`)}
                            className="text-sm font-medium hover:underline" style={{ color: '#60a5fa' }}>
                            View Opportunity ↗
                          </button>
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>
                          {providerMap.get(r.providerId) ?? r.providerId.slice(0, 8)}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          ₹{r.basisAmount.toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3">
                          {noSlab ? (
                            <span className="badge-glass-warning text-xs">No slab — review</span>
                          ) : (
                            <p className="text-sm font-semibold" style={{ color: '#34d399' }}>
                              ₹{r.calculatedCommission.toLocaleString('en-IN')}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                          {r.expectedPayoutDate ? format(new Date(r.expectedPayoutDate), 'dd MMM yy') : '—'}
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>{rmName(r.rmOwnerId)}</td>
                        )}
                        <td className="px-4 py-3">
                          <span className={st.badgeClass}>{st.label}</span>
                        </td>
                        <td className="px-4 py-3">
                          {isAdmin && r.status === 'pending' && (
                            <div className="flex gap-2">
                              <button onClick={() => setPayRecord(r)}
                                className="text-xs font-semibold hover:underline" style={{ color: '#34d399' }}>Pay</button>
                              <button onClick={() => setClawRecord(r)}
                                className="text-xs font-semibold hover:underline" style={{ color: '#f87171' }}>Clawback</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {payRecord  && <MarkPaidModal  record={payRecord}  onClose={() => setPayRecord(null)}  />}
      {clawRecord && <ClawbackModal  record={clawRecord} onClose={() => setClawRecord(null)} />}
    </>
  );
}
