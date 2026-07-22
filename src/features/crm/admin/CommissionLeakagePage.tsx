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
  const label = issue === 'no_commission_record' ? 'No Record' : 'No Slab Match';
  return (
    <span className={issue === 'no_commission_record' ? 'badge-glass-danger' : 'badge-glass-warning'}>
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

  // Admin gate. NOTE: the redirect must be returned AFTER every hook below —
  // returning early here would skip them and change the hook count between
  // renders (React #310). The subscription is skipped via `denied` instead, so
  // a non-admin still never reads the collection.
  const denied = profile !== null && profile.role !== 'admin';

  // Subscribe to the most recent leakage report
  useEffect(() => {
    if (denied) return;
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
  }, [denied]);

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

  if (denied) return <Navigate to="/crm/dashboard" replace />;

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div className="flex items-start justify-between">
        <div>
          <h2
            className="text-3xl mb-1"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}
          >
            Commission Leakage
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
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
            backgroundColor: runResult.startsWith('Error') ? 'rgba(248,113,113,0.10)' : 'rgba(52,211,153,0.10)',
            color:           runResult.startsWith('Error') ? '#f87171'  : '#34d399',
            border: `1px solid ${runResult.startsWith('Error') ? 'rgba(248,113,113,0.25)' : 'rgba(52,211,153,0.25)'}`,
          }}
        >
          {runResult}
        </div>
      )}

      {/* Summary card */}
      {!loading && report && (
        <div className="glass-panel p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
            Last Report
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm" style={{ color: 'var(--text-primary)' }}>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>Run at: </span>
              {fmtRunAt(report.runAt)}
            </span>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>Period: </span>
              {fmtDate(report.periodStart)} – {fmtDate(report.periodEnd)}
            </span>
            <span className="font-semibold" style={{ color: visibleLeaks.length > 0 ? '#f87171' : '#34d399' }}>
              {visibleLeaks.length} potential leak{visibleLeaks.length !== 1 ? 's' : ''}
            </span>
            {report.totalEstimatedLoss > 0 && (
              <span>
                <span style={{ color: 'var(--text-muted)' }}>Est. loss: </span>
                <span className="font-semibold" style={{ color: '#C9A961' }}>
                  ₹{report.totalEstimatedLoss.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="animate-pulse divide-y" style={{ borderColor: 'var(--shell-border)' }}>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12" style={{ backgroundColor: 'var(--shell-hover-soft)' }} />
            ))}
          </div>
        ) : !report ? (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No leakage report found. Run a check to scan for issues.</p>
          </div>
        ) : visibleLeaks.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium" style={{ color: '#34d399' }}>No leakage detected in the last check.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ backgroundColor: 'var(--shell-hover-soft)', borderBottom: '1px solid var(--shell-border)' }}>
                  {['Provider', 'Lead ID', 'Disbursed Amount', 'Disbursed At', 'Issue', 'Actions'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleLeaks.map((leak) => (
                  <tr key={leak.submissionId} className="hover:bg-(--shell-hover-soft) transition-colors" style={{ borderBottom: '1px solid var(--shell-border)' }}>
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {leak.providerName}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                      {leak.leadId.slice(0, 10)}…
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      ₹{leak.disbursedAmount.toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>
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
                          style={{ color: '#60a5fa' }}
                        >
                          Investigate →
                        </Link>
                        <button
                          onClick={() => handleMarkResolved(leak)}
                          disabled={resolvingId === leak.submissionId}
                          className="flex items-center gap-1 text-xs disabled:opacity-50 transition-colors hover:opacity-80"
                          style={{ color: 'var(--text-muted)' }}
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
