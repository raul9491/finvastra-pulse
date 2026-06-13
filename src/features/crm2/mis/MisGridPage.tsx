/**
 * Pipeline → MIS — the disbursal/commission grid with month/connector/RM filters,
 * xlsx export and the "Share business sheet" action (stamps dataSharedAt on each
 * included cycle). Reads via GET /api/crm2/mis (money-stripped without
 * payout.amounts.read). Requires mis.read.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Send, RefreshCw } from 'lucide-react';
import { auth } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { apiCrm2, useCrm2Collection, hasCrm2Perm } from '../lib';
import type { Aggregator } from '../../../types/crm2';

interface MisRow {
  id: string; caseId: string; partyName: string; productCode: string; lenderName: string;
  connectorName: string; connectorId: string; dsaCode: string; handlingRmName: string; handlingRmId: string;
  disbursedAmount: number | null; expectedGross: number | null; receivedNet: number | null;
  netMargin: number | null; cycleStatus: string; ageingDays: number | null; reportingMonth: string;
}
const inr = (n: number | null | undefined) => n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';
const thisMonth = () => new Date().toISOString().slice(0, 7);

export function MisGridPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [connectorId, setConnectorId] = useState('');
  const [rmId, setRmId] = useState('');
  const [rows, setRows] = useState<MisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { rows: aggregators } = useCrm2Collection<Aggregator & { id: string }>('aggregators');
  const canMoney = hasCrm2Perm(profile, 'payout.amounts.read');

  const load = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ month });
      if (connectorId) qs.set('connectorId', connectorId);
      if (rmId) qs.set('rmId', rmId);
      const r = await apiCrm2<{ ok: boolean; records: MisRow[] }>('GET', `/api/crm2/mis?${qs}`);
      setRows(r.records);
    } catch { /* ignore */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month, connectorId, rmId]);

  const rmOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.handlingRmId) m.set(r.handlingRmId, r.handlingRmName);
    return [...m.entries()];
  }, [rows]);

  // xlsx download (and share) go through fetch directly to read the binary / json.
  const callSheet = async (share: boolean) => {
    setBusy(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const qs = new URLSearchParams({ month });
      if (connectorId) qs.set('connectorId', connectorId);
      if (share) { qs.set('share', '1'); qs.set('dataSharedTo', connectorId ? (aggregators.find((a) => a.id === connectorId)?.name ?? connectorId) : 'aggregator'); }
      const res = await fetch(`/api/crm2/mis/business-sheet?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (share) {
        const data = await res.json();
        toast.success(`Shared — dataSharedAt stamped on ${data.shared} cycle(s)`);
        // also offer the file
        const blob = new Blob([Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        triggerDownload(blob);
        await load();
      } else {
        triggerDownload(await res.blob());
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sheet failed');
    } finally { setBusy(false); }
  };
  const triggerDownload = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `MIS-${month}${connectorId ? '-' + connectorId : ''}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  const totals = useMemo(() => rows.reduce((t, r) => ({
    disbursed: t.disbursed + (r.disbursedAmount ?? 0), expected: t.expected + (r.expectedGross ?? 0),
    received: t.received + (r.receivedNet ?? 0), margin: t.margin + (r.netMargin ?? 0),
  }), { disbursed: 0, expected: 0, received: 0, margin: 0 }), [rows]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>MIS</h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Disbursals + commission reconciliation by month</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="month" className="glass-inp text-sm" value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} />
          <select className="glass-inp text-sm" value={connectorId} onChange={(e) => setConnectorId(e.target.value)}>
            <option value="">All connectors</option>
            {aggregators.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="glass-inp text-sm" value={rmId} onChange={(e) => setRmId(e.target.value)}>
            <option value="">All RMs</option>
            {rmOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <button onClick={() => callSheet(false)} disabled={busy} className="glass-panel px-3 py-2 text-sm flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}><Download size={14} /> xlsx</button>
          <button onClick={() => callSheet(true)} disabled={busy} className="px-3 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}><Send size={14} /> Share sheet</button>
          <button onClick={load} className="glass-panel px-2.5 py-2" style={{ color: 'var(--text-secondary)' }}><RefreshCw size={14} /></button>
        </div>
      </div>

      {canMoney && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[['Disbursed', totals.disbursed], ['Expected', totals.expected], ['Received', totals.received], ['Net Margin', totals.margin]].map(([label, val]) => (
            <div key={label} className="glass-panel p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</p>
              <p className="text-lg font-bold mt-0.5" style={{ color: label === 'Net Margin' ? '#34d399' : 'var(--text-primary)' }}>{inr(val as number)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="glass-panel p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                <th className="text-left font-semibold px-4 py-2.5">Case</th>
                <th className="text-left font-semibold px-3 py-2.5">Party</th>
                <th className="text-left font-semibold px-3 py-2.5">Product</th>
                <th className="text-left font-semibold px-3 py-2.5">Lender</th>
                <th className="text-left font-semibold px-3 py-2.5">Connector</th>
                <th className="text-left font-semibold px-3 py-2.5">RM</th>
                {canMoney && <th className="text-right font-semibold px-3 py-2.5">Disbursed</th>}
                {canMoney && <th className="text-right font-semibold px-3 py-2.5">Received</th>}
                <th className="text-left font-semibold px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>No disbursals in {month}.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/crm/pipeline/cases/${r.caseId}`)}
                  className="cursor-pointer hover:bg-(--shell-hover-soft) transition-colors" style={{ borderTop: '1px solid var(--shell-border)' }}>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold" style={{ color: '#C9A961' }}>{r.caseId}</td>
                  <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{r.partyName}</td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.productCode}</td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.lenderName}</td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.connectorName}</td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.handlingRmName}</td>
                  {canMoney && <td className="px-3 py-2.5 text-right text-xs" style={{ color: 'var(--text-secondary)' }}>{inr(r.disbursedAmount)}</td>}
                  {canMoney && <td className="px-3 py-2.5 text-right text-xs" style={{ color: r.receivedNet != null ? '#34d399' : 'var(--text-muted)' }}>{inr(r.receivedNet)}</td>}
                  <td className="px-3 py-2.5"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961' }}>{r.cycleStatus}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
