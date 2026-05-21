import { useState, useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { db } from '../../../lib/firebase';
import {
  collection, query, orderBy, limit, onSnapshot,
  doc, updateDoc,
} from 'firebase/firestore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeakageEntry {
  leadId: string;
  opportunityId: string;
  submissionId: string;
  providerId: string;
  providerName: string;
  disbursedAt: string;   // ISO string (job serialises Date)
  disbursedAmount: number;
  issue: 'no_commission_record' | 'no_slab_match';
  resolved?: boolean;
}

interface LeakageReport {
  id: string;
  runAt: { toDate: () => Date } | null;
  periodStart: string;
  periodEnd: string;
  leakageCount: number;
  totalEstimatedLoss: number;
  leaks: LeakageEntry[];
}

// ─── Issue badge ──────────────────────────────────────────────────────────────

function IssueBadge({ issue }: { issue: LeakageEntry['issue'] }) {
  const label  = issue === 'no_commission_record' ? 'No Record' : 'No Slab Match';
  const colour = issue === 'no_commission_record' ? '#DC2626' : '#D97706';
  const bg     = issue === 'no_commission_record' ? '#FEF2F2' : '#FFFBEB';
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ backgroundColor: bg, color: colour }}
    >
      {label}
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function CommissionLeakagePage() {
  const { user, profile } = useAuth();

  const [report,      setReport]      = useState<LeakageReport | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [running,     setRunning]     = useState(false);
  const [runResult,   setRunResult]   = useState<string>('');
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Admin gate
  if (profile !== null && profile.role !== 'admin') {
    return <Navigate to="/crm/dashboard" replace />;
  }

  // Subscribe to the most recent leakage report
  useEffect(() => {
    const q = query(
      collection(db, 'commission_leakage_reports'),
      orderBy('runAt', 'desc'),
      limit(1),
    );
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) {
        setReport(null);
      } else {
        const d = snap.docs[0];
        setReport({ id: d.id, ...d.data() } as LeakageReport);
      }
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  // Trigger the server job
  const handleRunCheck = async () => {
    if (!user) return;
    setRunning(true);
    setRunResult('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/run-commission-leakage-check', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json() as { leakageCount: number; totalEstimatedLoss: number };
      setRunResult(`Check complete — ${data.leakageCount} leak(s) found. Estimated loss: ₹${data.totalEstimatedLoss.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
    } catch (e) {
      setRunResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  // Mark a single leak entry as resolved (optimistic — patches the leaks array in Firestore)
  const handleMarkResolved = async (entry: LeakageEntry) => {
    if (!report) return;
    setResolvingId(entry.submissionId);
    try {
      const updated = report.leaks.map((l) =>
        l.submissionId === entry.submissionId ? { ...l, resolved: true } : l,
      );
      await updateDoc(doc(db, 'commission_leakage_reports', report.id), { leaks: updated });
    } catch (e) {
      // Surface error inline without crashing the page
      setRunResult(`Error resolving: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResolvingId(null);
    }
  };

  const fmtDate = (iso: string) => {
    try { return format(new Date(iso), 'dd MMM yyyy'); }
    catch { return iso; }
  };

  const fmtRunAt = (ts: LeakageReport['runAt']) => {
    try {
      const d = ts?.toDate?.() ?? null;
      return d ? format(d, 'dd MMM yyyy, HH:mm') : '—';
    } catch { return '—'; }
  };

  const visibleLeaks = report?.leaks.filter((l) => !l.resolved) ?? [];

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div className="flex items-start justify-between">
        <div>
          <h2
            className="text-3xl mb-1"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}
          >
            Commission Leakage
          </h2>
          <p className="text-sm" style={{ color: '#8B8B85' }}>
            Disbursed deals with missing or unmatched commission records — admin only.
          </p>
        </div>

        <button
          onClick={handleRunCheck}
          disabled={running}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg disabled:opacity-50"
          style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
        >
          <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
          {running ? 'Running…' : 'Run check now'}
        </button>
      </div>

      {/* Job result banner */}
      {runResult && (
        <div
          className="px-4 py-3 rounded-xl text-sm font-medium"
          style={{
            backgroundColor: runResult.startsWith('Error') ? '#FEF2F2' : '#F0FDF4',
            color:           runResult.startsWith('Error') ? '#DC2626'  : '#166534',
          }}
        >
          {runResult}
        </div>
      )}

      {/* Summary card */}
      {!loading && report && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#8B8B85' }}>
            Last Report
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm" style={{ color: '#2A2A2A' }}>
            <span>
              <span style={{ color: '#8B8B85' }}>Run at: </span>
              {fmtRunAt(report.runAt)}
            </span>
            <span>
              <span style={{ color: '#8B8B85' }}>Period: </span>
              {fmtDate(report.periodStart)} – {fmtDate(report.periodEnd)}
            </span>
            <span className="font-semibold" style={{ color: visibleLeaks.length > 0 ? '#DC2626' : '#166534' }}>
              {visibleLeaks.length} potential leak{visibleLeaks.length !== 1 ? 's' : ''}
            </span>
            {report.totalEstimatedLoss > 0 && (
              <span>
                <span style={{ color: '#8B8B85' }}>Est. loss: </span>
                <span className="font-semibold" style={{ color: '#D97706' }}>
                  ₹{report.totalEstimatedLoss.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="animate-pulse divide-y divide-slate-100">
            {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-slate-50" />)}
          </div>
        ) : !report ? (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: '#8B8B85' }}>No leakage report found. Run a check to scan for issues.</p>
          </div>
        ) : visibleLeaks.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium" style={{ color: '#166534' }}>No leakage detected in the last check.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ backgroundColor: '#FAFAF7', borderBottom: '1px solid #E2E8F0' }}>
                  {['Provider', 'Lead ID', 'Disbursed Amount', 'Disbursed At', 'Issue', 'Actions'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: '#8B8B85' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleLeaks.map((leak) => (
                  <tr key={leak.submissionId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: '#0A0A0A' }}>
                      {leak.providerName}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: '#2A2A2A' }}>
                      {leak.leadId.slice(0, 10)}…
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold" style={{ color: '#0A0A0A' }}>
                      ₹{leak.disbursedAmount.toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: '#2A2A2A' }}>
                      {fmtDate(leak.disbursedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <IssueBadge issue={leak.issue} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Link
                          to={`/crm/leads/${leak.leadId}/opportunities/${leak.opportunityId}/submissions/${leak.submissionId}`}
                          className="text-xs font-semibold underline"
                          style={{ color: '#0B1538' }}
                        >
                          Investigate →
                        </Link>
                        <button
                          onClick={() => handleMarkResolved(leak)}
                          disabled={resolvingId === leak.submissionId}
                          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50 transition-colors"
                        >
                          <AlertTriangle size={11} />
                          {resolvingId === leak.submissionId ? 'Saving…' : 'Mark resolved'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
