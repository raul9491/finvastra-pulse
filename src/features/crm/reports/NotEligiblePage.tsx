/**
 * Not-Eligible register — /crm/reports/not-eligible (managers / admins / SAs).
 *
 * The complete view of every customer (old model) and lead (CRM 2.0) rejected
 * as Not eligible, with the failed CIBIL score and/or reason, who marked it,
 * their owner and when. Data comes from GET /api/crm/not-eligible (server
 * combines both models + resolves names); CSV export for offline storage.
 */
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getAuth } from 'firebase/auth';
import { UserX, Search, RefreshCw, Download, X } from 'lucide-react';
import { PageHeader } from '../../../components/ui/primitives';

type NeRow = {
  id: string; model: 'customer' | 'lead';
  name: string; mobile: string | null;
  creditScore: number | null; reason: string | null;
  markedBy: string | null; markedAt: number | null;
  owner: string | null; link: string;
};

const fmtWhen = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '—';

export function NotEligiblePage() {
  const [rows, setRows] = useState<NeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const load = async (fresh = false) => {
    setLoading(true); setError('');
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const r = await fetch(`/api/crm/not-eligible${fresh ? '?fresh=1' : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `Failed (${r.status})`);
      setRows(data.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the register');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => rows.filter((r) => !q
    || r.name.toLowerCase().includes(q)
    || (r.mobile ?? '').includes(q)
    || (r.reason ?? '').toLowerCase().includes(q)
    || (r.markedBy ?? '').toLowerCase().includes(q)
    || (r.owner ?? '').toLowerCase().includes(q)), [rows, q]);

  const stats = useMemo(() => {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const scored = rows.filter((r) => r.creditScore != null);
    return {
      total: rows.length,
      thisMonth: rows.filter((r) => (r.markedAt ?? 0) >= monthStart.getTime()).length,
      avgScore: scored.length ? Math.round(scored.reduce((s, r) => s + (r.creditScore ?? 0), 0) / scored.length) : null,
      reasonOnly: rows.filter((r) => r.creditScore == null && r.reason).length,
    };
  }, [rows]);

  const exportCsv = () => {
    const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Name', 'Mobile', 'Source', 'CIBIL Score', 'Reason', 'Marked By', 'Owner', 'When', 'Record ID'];
    const body = filtered.map((r) => [
      esc(r.name), esc(r.mobile), esc(r.model === 'customer' ? 'Customers' : 'Leads'),
      esc(r.creditScore), esc(r.reason), esc(r.markedBy), esc(r.owner), esc(fmtWhen(r.markedAt)), esc(r.id),
    ].join(','));
    const blob = new Blob([[head.map(esc).join(','), ...body].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `not-eligible-register-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Not Eligible"
        subtitle="Every customer and lead rejected on CIBIL / credit or another eligibility reason — the complete register."
        pinKey="crm.not-eligible"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => void load(true)} disabled={loading}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
              style={{ border: '1px solid var(--shell-border)', color: 'var(--text-muted)' }}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={exportCsv} disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              <Download size={13} /> Export CSV
            </button>
          </div>
        }
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          ['Total rejected', stats.total, '#fb7185'],
          ['This month', stats.thisMonth, '#fbbf24'],
          ['Avg CIBIL (scored)', stats.avgScore ?? '—', '#60a5fa'],
          ['Other-reason only', stats.reasonOnly, '#8b5cf6'],
        ] as const).map(([label, val, color]) => (
          <div key={label} className="glass-panel p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p className="text-xl font-bold mt-0.5" style={{ color }}>{val}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, mobile, reason, who marked…"
          className="w-full text-sm pl-9 pr-8 py-2.5 rounded-lg outline-none"
          style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)', color: 'var(--text-primary)' }} />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <X size={13} style={{ color: 'var(--text-dim)' }} />
          </button>
        )}
      </div>

      {/* Register */}
      {loading ? (
        <div className="glass-panel p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading the register…</div>
      ) : error ? (
        <div className="glass-panel p-6 text-sm" style={{ color: '#f87171' }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel p-10 text-center">
          <UserX size={28} className="mx-auto mb-2" style={{ color: 'var(--text-dim)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {q ? 'No rejections match your search.' : 'No customers or leads have been marked Not eligible yet.'}
          </p>
        </div>
      ) : (
        <div className="glass-panel p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--shell-border)' }}>
                  {['Name', 'Mobile', 'Source', 'CIBIL', 'Reason', 'Marked by', 'Owner', 'When', ''].map((h) => (
                    <th key={h} className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={`${r.model}_${r.id}`} style={{ borderTop: '1px solid var(--shell-border)' }}>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{r.name}</td>
                    <td className="px-3 py-2.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{r.mobile ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={r.model === 'customer'
                          ? { backgroundColor: 'rgba(96,165,250,0.14)', color: '#60a5fa' }
                          : { backgroundColor: 'rgba(201,169,97,0.14)', color: '#C9A961' }}>
                        {r.model === 'customer' ? 'Customers' : 'Leads'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: r.creditScore != null ? '#fb7185' : 'var(--text-dim)' }}>
                      {r.creditScore ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs max-w-56" style={{ color: 'var(--text-secondary)' }}>
                      <span className="line-clamp-2">{r.reason ?? '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{r.markedBy ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{r.owner ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{fmtWhen(r.markedAt)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Link to={r.link} className="text-[11px] font-semibold whitespace-nowrap" style={{ color: '#C9A961' }}>Open →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-dim)', borderTop: '1px solid var(--shell-border)' }}>
            {filtered.length} of {rows.length} rejection{rows.length === 1 ? '' : 's'} shown · data refreshes ~45s after a lead is marked
          </p>
        </div>
      )}
    </div>
  );
}
