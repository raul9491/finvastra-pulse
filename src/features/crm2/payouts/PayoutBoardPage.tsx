/**
 * Pipeline → Payouts — payout-cycle board (list by status) with a stuck-cases
 * view (ageing > threshold) and hold/dispute filters. Reads via the money-aware
 * API (GET /api/crm2/payout-cycles) so payout.read users see status without
 * amounts; payout.amounts.read users get the money columns.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, AlertTriangle, X, ArrowRight } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { apiCrm2, useCrm2Collection, hasCrm2Perm } from '../lib';
import { CYCLE_STATUS_LABEL, CycleMilestones } from '../cases/PayoutTab';
import type { PayoutCycleStatus, Aggregator } from '../../../types/crm2';

interface CycleRow {
  id: string; caseId: string; connectorId: string; status: PayoutCycleStatus;
  disbursedAmount: number | null; expectedGross: number | null; receivedNet: number | null;
  netMarginRealised: number | null; holdFlag: boolean; disputeFlag: boolean;
  disbursementDate: { _seconds?: number } | null;
}

const STATUSES: PayoutCycleStatus[] = ['AWAITING_DATA_SHARE', 'CONFIRMATION_RAISED', 'BANKER_CONFIRMED', 'PDD_OTC_HOLD', 'PAYOUT_CONFIRMED', 'BILLED', 'RECEIVED', 'SUBDSA_PAID', 'CLOSED', 'DISPUTED'];
const inr = (n: number | null | undefined) => n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';
const ageDays = (d: { _seconds?: number } | null) => d?._seconds ? Math.floor((Date.now() - d._seconds * 1000) / 86400000) : null;

export function PayoutBoardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<CycleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'all' | 'stuck' | 'hold' | 'dispute'>('all');
  const [statusFilter, setStatusFilter] = useState<PayoutCycleStatus | 'ALL'>('ALL');
  const [openCycle, setOpenCycle] = useState<CycleRow | null>(null);   // milestone modal
  const { rows: aggregators } = useCrm2Collection<Aggregator & { id: string }>('aggregators');
  const canMoney = hasCrm2Perm(profile, 'payout.amounts.read');
  const STUCK_DAYS = 21;

  const load = async () => {
    setLoading(true);
    try {
      const r = await apiCrm2<{ ok: boolean; cycles: CycleRow[] }>('GET', '/api/crm2/payout-cycles');
      setRows(r.cycles);
    } catch { /* ignore */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const aggName = (id: string) => aggregators.find((a) => a.id === id)?.name ?? id;

  const filtered = useMemo(() => rows.filter((r) => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    if (view === 'hold') return r.holdFlag;
    if (view === 'dispute') return r.disputeFlag;
    if (view === 'stuck') { const a = ageDays(r.disbursementDate); return r.status !== 'CLOSED' && r.status !== 'RECEIVED' && r.status !== 'SUBDSA_PAID' && a != null && a > STUCK_DAYS; }
    return true;
  }), [rows, view, statusFilter]);

  const counts = useMemo(() => { const c = new Map<string, number>(); for (const r of rows) c.set(r.status, (c.get(r.status) ?? 0) + 1); return c; }, [rows]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>Payout Cycles</h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Disbursement → data share → banker confirm → bill → receive → sub-DSA → close</p>
        </div>
        <button onClick={load} className="glass-panel px-3 py-2 text-sm flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {(['all', 'stuck', 'hold', 'dispute'] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border capitalize transition-colors inline-flex items-center gap-1"
            style={view === v ? { backgroundColor: 'rgba(201,169,97,0.15)', borderColor: '#C9A961', color: '#C9A961' } : { borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>
            {v === 'stuck' && <AlertTriangle size={11} />}{v === 'stuck' ? `Stuck >${STUCK_DAYS}d` : v}
          </button>
        ))}
        <select className="glass-inp text-xs ml-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PayoutCycleStatus | 'ALL')}>
          <option value="ALL">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{CYCLE_STATUS_LABEL[s]} ({counts.get(s) ?? 0})</option>)}
        </select>
      </div>

      <div className="glass-panel p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                <th className="text-left font-semibold px-4 py-2.5">Cycle</th>
                <th className="text-left font-semibold px-3 py-2.5">Connector</th>
                {canMoney && <th className="text-right font-semibold px-3 py-2.5">Disbursed</th>}
                {canMoney && <th className="text-right font-semibold px-3 py-2.5">Expected</th>}
                {canMoney && <th className="text-right font-semibold px-3 py-2.5">Received</th>}
                <th className="text-right font-semibold px-3 py-2.5">Age (d)</th>
                <th className="text-left font-semibold px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canMoney ? 7 : 4} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={canMoney ? 7 : 4} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>No cycles{view !== 'all' ? ` in ${view}` : ''}.</td></tr>
              ) : filtered.map((r) => {
                const age = ageDays(r.disbursementDate);
                const stuck = view !== 'stuck' && age != null && age > STUCK_DAYS && r.status !== 'CLOSED' && r.status !== 'RECEIVED' && r.status !== 'SUBDSA_PAID';
                return (
                  <tr key={r.id} onClick={() => setOpenCycle(r)}
                    className="cursor-pointer hover:bg-(--shell-hover-soft) transition-colors" style={{ borderTop: '1px solid var(--shell-border)' }}>
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold" style={{ color: '#C9A961' }}>{r.id}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{aggName(r.connectorId)}</td>
                    {canMoney && <td className="px-3 py-2.5 text-right text-xs" style={{ color: 'var(--text-secondary)' }}>{inr(r.disbursedAmount)}</td>}
                    {canMoney && <td className="px-3 py-2.5 text-right text-xs" style={{ color: 'var(--text-secondary)' }}>{inr(r.expectedGross)}</td>}
                    {canMoney && <td className="px-3 py-2.5 text-right text-xs" style={{ color: r.receivedNet != null ? '#34d399' : 'var(--text-muted)' }}>{inr(r.receivedNet)}</td>}
                    <td className="px-3 py-2.5 text-right text-xs" style={{ color: stuck ? '#f87171' : 'var(--text-muted)', fontWeight: stuck ? 700 : 400 }}>{age ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                        style={{ backgroundColor: r.disputeFlag ? 'rgba(248,113,113,0.15)' : r.holdFlag ? 'rgba(251,191,36,0.15)' : 'rgba(201,169,97,0.12)', color: r.disputeFlag ? '#f87171' : r.holdFlag ? '#fbbf24' : '#C9A961' }}>
                        {(r.holdFlag || r.disputeFlag) && <AlertTriangle size={9} />}{CYCLE_STATUS_LABEL[r.status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {openCycle && (
        <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setOpenCycle(null)}>
          <div className="glass-modal-panel w-full max-w-2xl rounded-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="glass-modal-header flex items-center justify-between px-5 py-4 sticky top-0 z-10">
              <div>
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Payout cycle {openCycle.id}</h3>
                <button onClick={() => { setOpenCycle(null); navigate(`/crm/pipeline/cases/${openCycle.caseId}`); }}
                  className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: '#C9A961' }}>
                  Open case {openCycle.caseId} <ArrowRight size={11} />
                </button>
              </div>
              <button onClick={() => setOpenCycle(null)} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)"><X size={17} style={{ color: 'var(--text-muted)' }} /></button>
            </div>
            <div className="p-5"><CycleMilestones cycleId={openCycle.id} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
