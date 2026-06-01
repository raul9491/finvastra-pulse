import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useAuth } from '../../auth/AuthContext';
import { db } from '../../../lib/firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import type { AccessLog, AccessLogAction } from '../../../types';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useAllEmployees } from '../../../lib/hooks/useProfile';

const ACTION_LABELS: Record<AccessLogAction, string> = {
  pan_view:      'PAN View',
  phone_view:    'Phone View',
  document_view: 'Document View',
};

export function AccessLogsPage() {
  const { profile } = useAuth();
  const { employees } = useAllEmployees();

  const [logs,       setLogs]       = useState<AccessLog[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState<'' | AccessLogAction>('');
  const [fromDate,   setFromDate]   = useState('');
  const [toDate,     setToDate]     = useState('');

  // Admin gate
  if (profile !== null && profile.role !== 'admin') {
    return <Navigate to="/crm/dashboard" replace />;
  }

  // Build actor options for SearchableSelect
  const actorOptions = employees.map((e) => ({
    value: e.userId,
    label: e.displayName,
    description: e.email,
  }));

  useEffect(() => {
    // Base query: latest 100 logs ordered by accessedAt desc.
    // Additional filters are applied client-side to avoid composite index requirements.
    const q = query(
      collection(db, 'access_logs'),
      orderBy('accessedAt', 'desc'),
      limit(100),
    );

    const unsub = onSnapshot(q, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AccessLog));
      setLogs(all);
      setLoading(false);
    });

    return unsub;
  }, []);

  // Client-side filtering
  const filtered = logs.filter((log) => {
    if (actorFilter && log.actorId !== actorFilter) return false;
    if (actionFilter && log.action !== actionFilter) return false;
    if (fromDate) {
      const logDate = log.accessedAt?.toDate ? log.accessedAt.toDate() : new Date(log.accessedAt);
      if (logDate < new Date(fromDate)) return false;
    }
    if (toDate) {
      const logDate = log.accessedAt?.toDate ? log.accessedAt.toDate() : new Date(log.accessedAt);
      // Include the entire toDate day
      const endOfDay = new Date(toDate);
      endOfDay.setHours(23, 59, 59, 999);
      if (logDate > endOfDay) return false;
    }
    return true;
  });

  const formatDate = (ts: AccessLog['accessedAt']): string => {
    try {
      const d = ts?.toDate ? ts.toDate() : new Date(ts);
      return format(d, 'dd MMM yyyy, HH:mm:ss');
    } catch {
      return '—';
    }
  };

  const actorName = (log: AccessLog): string => {
    const emp = employees.find((e) => e.userId === log.actorId);
    return emp ? emp.displayName : log.actorEmail || log.actorId.slice(0, 8);
  };

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div>
        <h2 className="text-3xl mb-1"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          Access Logs
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Sensitive data access events — PAN views, phone reveals, document downloads.
        </p>
      </div>

      {/* Filters */}
      <div className="glass-panel p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Filters</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Actor filter */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Actor</label>
            <SearchableSelect
              options={actorOptions}
              value={actorFilter}
              onChange={setActorFilter}
              placeholder="All actors"
              label="Filter by actor"
            />
          </div>

          {/* Action filter */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Action</label>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value as '' | AccessLogAction)}
              className="glass-inp w-full text-sm"
            >
              <option value="">All actions</option>
              <option value="pan_view">PAN View</option>
              <option value="phone_view">Phone View</option>
              <option value="document_view">Document View</option>
            </select>
          </div>

          {/* From date */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="glass-inp w-full text-sm"
            />
          </div>

          {/* To date */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="glass-inp w-full text-sm"
            />
          </div>
        </div>

        {/* Active filter summary */}
        {(actorFilter || actionFilter || fromDate || toDate) && (
          <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Showing {filtered.length} of {logs.length} events
            </p>
            <button
              onClick={() => { setActorFilter(''); setActionFilter(''); setFromDate(''); setToDate(''); }}
              className="text-xs font-semibold hover:underline"
              style={{ color: 'var(--text-muted)' }}>
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading access logs…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No access events found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Date / Time', 'Actor', 'Action', 'Target ID', 'IP Address', 'User Agent'].map((col) => (
                    <th key={col}
                      className="px-5 py-4 text-left text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: 'var(--text-muted)' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <tr key={log.id} className="hover:bg-white/5 transition-colors"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <td className="px-5 py-4 whitespace-nowrap font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                      {formatDate(log.accessedAt)}
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{actorName(log)}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{log.actorEmail}</p>
                    </td>
                    <td className="px-5 py-4">
                      <span className="badge-glass-warning">
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                      {log.targetId.slice(0, 12)}…
                    </td>
                    <td className="px-5 py-4 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                      {log.ipAddress || '—'}
                    </td>
                    <td className="px-5 py-4 text-xs" style={{ color: 'var(--text-muted)', maxWidth: 240 }}>
                      <span title={log.userAgent}>
                        {log.userAgent ? log.userAgent.slice(0, 40) + (log.userAgent.length > 40 ? '…' : '') : '—'}
                      </span>
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
