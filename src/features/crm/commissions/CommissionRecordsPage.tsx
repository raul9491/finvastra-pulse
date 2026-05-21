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

const STATUS_STYLES: Record<CommissionRecordStatus, { bg: string; text: string; label: string }> = {
  pending:     { bg: '#FFFBEB', text: '#92400E', label: 'Pending' },
  paid:        { bg: '#F0FDF4', text: '#166534', label: 'Paid' },
  clawed_back: { bg: '#FFF1F2', text: '#9F1239', label: 'Clawed Back' },
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

  const inputClass = "w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2";
  return (
    <Modal isOpen onClose={onClose} title="Mark Commission as Paid" size="sm"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-slate-200 rounded-xl" style={{ color: '#2A2A2A' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {saving ? 'Saving…' : 'Confirm Payment'}
          </button>
        </>
      }>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Actual Amount Received ₹</label>
          <input type="number" value={actualAmount} onChange={(e) => setActualAmount(e.target.value)} className={inputClass} />
          <p className="mt-1 text-xs" style={{ color: '#8B8B85' }}>Expected: ₹{record.calculatedCommission.toLocaleString('en-IN')}</p>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Payment Date</label>
          <input type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Notes</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="Optional" />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
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
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-slate-200 rounded-xl" style={{ color: '#2A2A2A' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !reason.trim()}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50 bg-red-600 text-white">
            {saving ? 'Saving…' : 'Confirm Clawback'}
          </button>
        </>
      }>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>Reason *</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
          placeholder="e.g. Prepayment within 12 months"
          className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 resize-none" />
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

  const sel = "text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none";

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-3xl" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
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
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>{label}</p>
              <p className="text-lg font-semibold" style={{ color: '#0A0A0A' }}>{value}</p>
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
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={sel}>
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="clawed_back">Clawed Back</option>
          </select>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="animate-pulse divide-y divide-slate-100">
              {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-50" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm" style={{ color: '#8B8B85' }}>No commission records yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr style={{ backgroundColor: '#FAFAF7', borderBottom: '1px solid #E2E8F0' }}>
                    {['Opportunity', 'Bank', 'Disbursed ₹', 'Commission ₹', 'Expected Date', isAdmin ? 'RM' : null, 'Status', ''].filter(Boolean).map((h) => (
                      <th key={h!} className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const st = STATUS_STYLES[r.status];
                    const noSlab = r.notes?.includes('NO_SLAB_MATCH');
                    return (
                      <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <button
                            onClick={() => navigate(`/crm/leads/${r.leadId}/opportunities/${r.opportunityId}`)}
                            className="text-sm font-medium underline" style={{ color: '#0B1538' }}>
                            View Opportunity ↗
                          </button>
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>
                          {providerMap.get(r.providerId) ?? r.providerId.slice(0, 8)}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium" style={{ color: '#0A0A0A' }}>
                          ₹{r.basisAmount.toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3">
                          {noSlab ? (
                            <span className="text-xs font-semibold text-amber-600">No slab — review</span>
                          ) : (
                            <p className="text-sm font-semibold" style={{ color: '#166534' }}>
                              ₹{r.calculatedCommission.toLocaleString('en-IN')}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: '#8B8B85' }}>
                          {r.expectedPayoutDate ? format(new Date(r.expectedPayoutDate), 'dd MMM yy') : '—'}
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>{rmName(r.rmOwnerId)}</td>
                        )}
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full"
                            style={{ backgroundColor: st.bg, color: st.text }}>{st.label}</span>
                        </td>
                        <td className="px-4 py-3">
                          {isAdmin && r.status === 'pending' && (
                            <div className="flex gap-2">
                              <button onClick={() => setPayRecord(r)}
                                className="text-xs font-semibold text-emerald-700 hover:underline">Pay</button>
                              <button onClick={() => setClawRecord(r)}
                                className="text-xs font-semibold text-red-600 hover:underline">Clawback</button>
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
