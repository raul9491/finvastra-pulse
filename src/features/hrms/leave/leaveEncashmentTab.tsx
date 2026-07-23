/**
 * The Encashment tab - approve / reject leave-encashment requests.
 * 
 * Extracted verbatim from AdminLeavePage.tsx (2026-07-23). Approval still runs
 * through approveEncashmentRequest, which DEBITS earned leave in a transaction
 * and enforces the 30-day/FY cap.
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { useAllEncashmentRequests, approveEncashmentRequest, rejectEncashmentRequest } from '../hooks/useLeaveEncashment';
import { Coins, CheckCircle2 } from 'lucide-react';

// ─── AdminLeavePage ───────────────────────────────────────────────────────────

// ─── EncashmentTab ────────────────────────────────────────────────────────────

export function EncashmentTab({ actorUid }: { actorUid: string }) {
  const { requests, loading } = useAllEncashmentRequests();
  const [actionId,  setActionId]  = useState<string | null>(null);
  const [rejReason, setRejReason] = useState('');
  const [showRej,   setShowRej]   = useState<string | null>(null);
  const [busy,      setBusy]      = useState<string | null>(null);
  const [toast,     setToast]     = useState('');
  const [toastErr,  setToastErr]  = useState(false);

  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const otherRequests   = requests.filter((r) => r.status !== 'pending');

  const handleApprove = async (id: string) => {
    setBusy(id);
    try {
      await approveEncashmentRequest(id, actorUid);
      setToastErr(false);
      setToast('Encashment request approved.');
    } catch (e) {
      // The hook throws human-readable rejections (insufficient EL balance,
      // FY 30-day cap, already processed) — show the actual reason.
      setToastErr(true);
      setToast(e instanceof Error && e.message ? e.message : 'Failed to approve.');
    }
    finally { setBusy(null); }
  };

  const handleReject = async (id: string) => {
    if (!rejReason.trim()) return;
    setBusy(id);
    try {
      await rejectEncashmentRequest(id, actorUid, rejReason.trim());
      setShowRej(null);
      setRejReason('');
      setToastErr(false);
      setToast('Encashment request rejected.');
    } catch { setToastErr(true); setToast('Failed to reject.'); }
    finally { setBusy(null); }
  };

  const toTs = (ts: any): Date | null => ts?.toDate?.() ?? null;

  return (
    <div className="p-6 space-y-5">
      {toast && (
        <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: toastErr ? '#FEF2F2' : '#F0FDF4' }}>
          <CheckCircle2 size={14} style={{ color: toastErr ? '#DC2626' : '#059669' }} />
          <p className="text-sm" style={{ color: toastErr ? '#991B1B' : '#065F46' }}>{toast}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[1,2,3].map((i) => <div key={i} className="h-12 bg-(--glass-panel-bg) rounded-xl animate-pulse" />)}</div>
      ) : pendingRequests.length === 0 && otherRequests.length === 0 ? (
        <div className="py-10 text-center">
          <Coins size={32} className="mx-auto mb-3 text-(--text-dim)" />
          <p className="text-sm text-(--text-muted)">No encashment requests yet.</p>
        </div>
      ) : (
        <>
          {pendingRequests.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#92400E' }}>
                Pending ({pendingRequests.length})
              </h4>
              <div className="space-y-3">
                {pendingRequests.map((r) => (
                  <div key={r.id} className="p-4 rounded-2xl border border-amber-200 bg-amber-50/40">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-(--text-primary)">{r.employeeName}</p>
                        <p className="text-xs text-(--text-muted) mt-0.5">
                          {r.leaveDays} day{r.leaveDays !== 1 ? 's' : ''} · ₹{r.dailyRate.toLocaleString('en-IN')}/day · Total: <strong>₹{r.totalAmount.toLocaleString('en-IN')}</strong>
                        </p>
                        <p className="text-xs text-(--text-muted)">Month: {r.month} · "{r.reason}"</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => handleApprove(r.id)} disabled={busy === r.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                          style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                          Approve
                        </button>
                        <button onClick={() => { setShowRej(r.id); setRejReason(''); }} disabled={busy === r.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                          style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                          Reject
                        </button>
                      </div>
                    </div>
                    {showRej === r.id && (
                      <div className="mt-3 flex gap-2">
                        <input className="flex-1 text-sm px-3 py-1.5 border border-(--shell-border) rounded-lg outline-none focus:ring-2 focus:ring-red-200"
                          placeholder="Rejection reason…" value={rejReason} onChange={(e) => setRejReason(e.target.value)} />
                        <button onClick={() => handleReject(r.id)} disabled={!rejReason.trim() || busy === r.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                          style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}>
                          Confirm
                        </button>
                        <button onClick={() => setShowRej(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-(--shell-border) hover:bg-(--glass-panel-bg)">
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {otherRequests.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
                Processed
              </h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--shell-border)">
                    {['Employee', 'Month', 'Days', 'Amount', 'Status', 'Date'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {otherRequests.slice(0, 20).map((r) => {
                    const d = toTs(r.approvedAt);
                    const statusCfg: Record<string, { label: string; color: string; bg: string }> = {
                      approved: { label: 'Approved', color: '#065F46', bg: '#D1FAE5' },
                      rejected: { label: 'Rejected', color: '#991B1B', bg: '#FEE2E2' },
                      paid:     { label: 'Paid',     color: '#1D4ED8', bg: '#DBEAFE' },
                    };
                    const cfg = statusCfg[r.status] ?? { label: r.status, color: '#374151', bg: '#F3F4F6' };
                    return (
                      <tr key={r.id} className="border-b border-(--shell-border)">
                        <td className="px-3 py-2.5 font-medium text-(--text-primary)">{r.employeeName}</td>
                        <td className="px-3 py-2.5 text-(--text-muted)">{r.month}</td>
                        <td className="px-3 py-2.5 text-(--text-muted)">{r.leaveDays}</td>
                        <td className="px-3 py-2.5 font-semibold">₹{r.totalAmount.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ color: cfg.color, backgroundColor: cfg.bg }}>{cfg.label}</span>
                        </td>
                        <td className="px-3 py-2.5 text-(--text-muted) text-xs">{d ? format(d, 'd MMM yyyy') : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
