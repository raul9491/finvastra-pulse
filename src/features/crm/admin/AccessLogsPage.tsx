import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Eye } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { db } from '../../../lib/firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import type { AccessLog, AccessLogAction } from '../../../types';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useAllEmployees } from '../../../lib/hooks/useProfile';

interface LeadViewLog {
  id:           string;
  viewedBy:     string;
  viewedByName: string;
  leadId:       string;
  leadName:     string;
  viewedAt:     { toDate?: () => Date } | string;
}

const ACTION_LABELS: Record<AccessLogAction, string> = {
  pan_view:      'PAN View',
  phone_view:    'Phone View',
  document_view: 'Document View',
};

export function AccessLogsPage() {
  const { profile } = useAuth();
  const { employees } = useAllEmployees();

  const [tab, setTab] = useState<'security' | 'lead_views'>('lead_views');

  // ── Security events (existing /access_logs) ───────────────────────────────
  const [logs,         setLogs]         = useState<AccessLog[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [actorFilter,  setActorFilter]  = useState('');
  const [actionFilter, setActionFilter] = useState<'' | AccessLogAction>('');
  const [fromDate,     setFromDate]     = useState('');
  const [toDate,       setToDate]       = useState('');

  // ── Lead view logs (/lead_view_logs) ──────────────────────────────────────
  const [viewLogs,        setViewLogs]        = useState<LeadViewLog[]>([]);
  const [viewLoading,     setViewLoading]     = useState(true);
  const [viewActorFilter, setViewActorFilter] = useState('');
  const [viewFromDate,    setViewFromDate]    = useState('');
  const [viewToDate,      setViewToDate]      = useState('');

  // Admin gate. The redirect is returned AFTER every hook (see below) — an early
  // return here would skip them and change the hook count between renders
  // (React #310). `denied` keeps a non-admin from subscribing to either log.
  const denied = profile !== null && profile.role !== 'admin';

  const actorOptions = employees.map((e) => ({ value: e.userId, label: e.displayName }));

  useEffect(() => {
    if (denied) return;
    const q = query(collection(db, 'access_logs'), orderBy('accessedAt', 'desc'), limit(100));
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AccessLog)));
      setLoading(false);
    });
    return unsub;
  }, [denied]);

  useEffect(() => {
    if (denied) return;
    const q = query(collection(db, 'lead_view_logs'), orderBy('viewedAt', 'desc'), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      setViewLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeadViewLog)));
      setViewLoading(false);
    });
    return unsub;
  }, [denied]);

  // ── Filtering helpers ─────────────────────────────────────────────────────
  const fmtTs = (ts: AccessLog['accessedAt'] | LeadViewLog['viewedAt']): string => {
    try {
      const d = (ts as { toDate?: () => Date }).toDate ? (ts as { toDate: () => Date }).toDate() : new Date(ts as string);
      return format(d, 'dd MMM yyyy, HH:mm');
    } catch { return '—'; }
  };

  const filtered = logs.filter((log) => {
    if (actorFilter && log.actorId !== actorFilter) return false;
    if (actionFilter && log.action !== actionFilter) return false;
    if (fromDate) { const d = log.accessedAt?.toDate ? log.accessedAt.toDate() : new Date(log.accessedAt as string); if (d < new Date(fromDate)) return false; }
    if (toDate)   { const d = log.accessedAt?.toDate ? log.accessedAt.toDate() : new Date(log.accessedAt as string); const end = new Date(toDate); end.setHours(23,59,59,999); if (d > end) return false; }
    return true;
  });

  const filteredViews = viewLogs.filter((log) => {
    if (viewActorFilter && log.viewedBy !== viewActorFilter) return false;
    if (viewFromDate) { const d = (log.viewedAt as { toDate?: () => Date }).toDate?.() ?? new Date(log.viewedAt as string); if (d < new Date(viewFromDate)) return false; }
    if (viewToDate)   { const d = (log.viewedAt as { toDate?: () => Date }).toDate?.() ?? new Date(log.viewedAt as string); const end = new Date(viewToDate); end.setHours(23,59,59,999); if (d > end) return false; }
    return true;
  });

  // Count views per employee (for the summary)
  const viewsByEmployee = filteredViews.reduce<Record<string, number>>((acc, l) => {
    acc[l.viewedByName] = (acc[l.viewedByName] ?? 0) + 1;
    return acc;
  }, {});

  // Phase P — export the ACTIVE tab's filtered rows as CSV.
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let rows: string[];
    let name: string;
    if (tab === 'lead_views') {
      rows = [
        ['Viewed By', 'Lead', 'Lead ID', 'Viewed At'].map(esc).join(','),
        ...filteredViews.map((l) => [l.viewedByName, l.leadName, l.leadId, fmtTs(l.viewedAt)].map(esc).join(',')),
      ];
      name = 'lead-view-logs';
    } else {
      rows = [
        ['Actor', 'Action', 'Target', 'Accessed At'].map(esc).join(','),
        ...filtered.map((l) => [
          l.actorEmail || l.actorId,
          ACTION_LABELS[l.action] ?? l.action,
          `${l.targetType}:${l.targetId}`,
          fmtTs(l.accessedAt),
        ].map(esc).join(',')),
      ];
      name = 'security-access-logs';
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const topViewers = Object.entries(viewsByEmployee).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (denied) return <Navigate to="/crm/dashboard" replace />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl mb-1"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            Access Logs
          </h2>
          <p className="text-sm" style={{ color: 'var(--shell-text-dim)' }}>
            Audit trail for sensitive data access and lead views.
          </p>
        </div>
        {/* Phase P — CSV export of the active tab's FILTERED rows */}
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg shrink-0"
          style={{ color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' }}>
          ⬇ Export CSV
        </button>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2">
        {([
          { key: 'lead_views', label: '👁 Lead Views', count: viewLogs.length },
          { key: 'security',   label: '🔒 Security Events', count: logs.length },
        ] as const).map(({ key, label, count }) => (
          <button key={key} onClick={() => setTab(key)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={tab === key
              ? { backgroundColor: '#C9A961', color: '#0B1538' }
              : { backgroundColor: 'var(--glass-panel-bg)', color: 'var(--shell-text-secondary)', border: '1px solid var(--shell-border)' }}>
            {label}
            <span className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: tab === key ? 'rgba(0,0,0,0.15)' : 'var(--shell-hover-hard)' }}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* ── TAB: LEAD VIEWS ──────────────────────────────────────────────────── */}
      {tab === 'lead_views' && (
        <>
          {/* Who's looking the most — summary strip */}
          {topViewers.length > 0 && (
            <div className="glass-panel p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--shell-text-dim)' }}>
                Top viewers (last 200 events)
              </p>
              <div className="flex flex-wrap gap-3">
                {topViewers.map(([name, count]) => (
                  <div key={name} className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                    style={{ backgroundColor: 'var(--glass-panel-bg)', border: '1px solid var(--shell-border)' }}>
                    <Eye size={12} style={{ color: 'var(--shell-text-dim)' }} />
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{name}</span>
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <SearchableSelect options={[{ value: '', label: 'All employees' }, ...actorOptions]}
              value={viewActorFilter} onChange={setViewActorFilter} label="Filter by employee" />
            <input type="date" value={viewFromDate} onChange={(e) => setViewFromDate(e.target.value)}
              className="glass-inp text-sm px-3 py-2 rounded-lg" />
            <input type="date" value={viewToDate} onChange={(e) => setViewToDate(e.target.value)}
              className="glass-inp text-sm px-3 py-2 rounded-lg" />
            {(viewActorFilter || viewFromDate || viewToDate) && (
              <button onClick={() => { setViewActorFilter(''); setViewFromDate(''); setViewToDate(''); }}
                className="text-xs font-semibold px-3 py-2 rounded-lg transition-opacity hover:opacity-70"
                style={{ color: 'var(--shell-text-secondary)', border: '1px solid var(--shell-border)' }}>
                Clear
              </button>
            )}
          </div>

          {/* Table */}
          <div className="glass-panel overflow-hidden">
            {viewLoading ? (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--shell-text-dim)' }}>Loading…</div>
            ) : filteredViews.length === 0 ? (
              <div className="p-12 text-center text-sm" style={{ color: 'var(--shell-text-dim)' }}>
                No lead view events yet. They appear here as soon as someone opens a lead.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--shell-border)', backgroundColor: 'var(--glass-panel-bg)' }}>
                    {['When', 'Employee', 'Lead Name', 'Lead ID'].map((h) => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest"
                        style={{ color: 'var(--shell-text-dim)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredViews.map((log) => (
                    <tr key={log.id} className="nav-item-hover transition-colors"
                      style={{ borderBottom: '1px solid var(--shell-border)' }}>
                      <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--shell-text-secondary)' }}>
                        {fmtTs(log.viewedAt)}
                      </td>
                      <td className="px-5 py-3 font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                        {log.viewedByName || log.viewedBy.slice(0, 8)}
                      </td>
                      <td className="px-5 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>
                        {log.leadName}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--shell-text-dim)' }}>
                        {log.leadId.slice(0, 10)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── TAB: SECURITY EVENTS ─────────────────────────────────────────────── */}
      {tab === 'security' && (
        <>
          {/* Filters */}
          <div className="glass-panel p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <SearchableSelect options={actorOptions} value={actorFilter} onChange={setActorFilter} label="Filter by actor" />
              <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value as '' | AccessLogAction)} className="glass-inp text-sm">
                <option value="">All actions</option>
                <option value="pan_view">PAN View</option>
                <option value="phone_view">Phone View</option>
                <option value="document_view">Document View</option>
              </select>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="glass-inp text-sm" />
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="glass-inp text-sm" />
            </div>
            {(actorFilter || actionFilter || fromDate || toDate) && (
              <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--shell-border)' }}>
                <p className="text-xs" style={{ color: 'var(--shell-text-dim)' }}>Showing {filtered.length} of {logs.length}</p>
                <button onClick={() => { setActorFilter(''); setActionFilter(''); setFromDate(''); setToDate(''); }}
                  className="text-xs font-semibold hover:opacity-70" style={{ color: 'var(--shell-text-secondary)' }}>Clear</button>
              </div>
            )}
          </div>

          <div className="glass-panel overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--shell-text-dim)' }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-sm" style={{ color: 'var(--shell-text-dim)' }}>No security events found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--glass-panel-bg)', borderBottom: '1px solid var(--shell-border)' }}>
                      {['When', 'Actor', 'Action', 'Target', 'IP', 'Device'].map((h) => (
                        <th key={h} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest"
                          style={{ color: 'var(--shell-text-dim)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((log) => (
                      <tr key={log.id} className="nav-item-hover transition-colors"
                        style={{ borderBottom: '1px solid var(--shell-border)' }}>
                        <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--shell-text-secondary)' }}>{fmtTs(log.accessedAt)}</td>
                        <td className="px-5 py-3">
                          <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                            {employees.find((e) => e.userId === log.actorId)?.displayName ?? log.actorEmail}
                          </p>
                        </td>
                        <td className="px-5 py-3">
                          <span className="badge-glass-warning">{ACTION_LABELS[log.action] ?? log.action}</span>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--shell-text-secondary)' }}>{log.targetId.slice(0, 12)}…</td>
                        <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--shell-text-dim)' }}>{log.ipAddress || '—'}</td>
                        <td className="px-5 py-3 text-xs" style={{ color: 'var(--shell-text-dim)', maxWidth: 200 }}>
                          <span title={log.userAgent}>{log.userAgent?.slice(0, 35)}{(log.userAgent?.length ?? 0) > 35 ? '…' : ''}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
