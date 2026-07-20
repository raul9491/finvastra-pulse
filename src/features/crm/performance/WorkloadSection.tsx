/**
 * Workload — the "who is handling what" roster (Performance hub ?tab=workload,
 * managers/admins). One row per person with their OPEN counts across all three
 * entity types: Customers (old model) · Leads (CRM 2.0) · Cases. Data from
 * GET /api/crm/workload (45s cache). Zero configuration — read and act.
 */
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getAuth } from 'firebase/auth';
import { RefreshCw, Search, X, Inbox } from 'lucide-react';
import { useAllEmployees } from '../../../lib/hooks/useProfile';

type WorkRow = {
  uid: string; name: string;
  customers: number; leads: number; cases: number; shared: number; total: number;
};

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

const COLS = [
  { key: 'customers', label: 'Customers', color: '#60a5fa', hint: 'Open old-model customers they own (not closed/rejected)' },
  { key: 'leads',     label: 'Leads',     color: '#C9A961', hint: 'Active CRM 2.0 leads assigned to them (not converted/closed)' },
  { key: 'cases',     label: 'Cases',     color: '#34d399', hint: 'Cases they handle that are not yet completed/closed' },
] as const;

export function WorkloadSection() {
  const { employees } = useAllEmployees();
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [unassigned, setUnassigned] = useState({ customers: 0, leads: 0, cases: 0 });
  const [idle, setIdle] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const photoByUid = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) if (e.photoURL) m.set(e.userId, e.photoURL);
    return m;
  }, [employees]);

  const load = async (fresh = false) => {
    setLoading(true); setError('');
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const r = await fetch(`/api/crm/workload${fresh ? '?fresh=1' : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `Failed (${r.status})`);
      setRows(data.rows ?? []);
      setUnassigned(data.unassigned ?? { customers: 0, leads: 0, cases: 0 });
      setIdle(data.idle ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the workload');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => !q || r.name.toLowerCase().includes(q));
  const totals = useMemo(() => rows.reduce((a, r) => ({
    customers: a.customers + r.customers, leads: a.leads + r.leads, cases: a.cases + r.cases,
  }), { customers: 0, leads: 0, cases: 0 }), [rows]);

  const unassignedTotal = unassigned.customers + unassigned.leads + unassigned.cases;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="relative flex-1 min-w-40 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search person…"
            className="w-full text-xs pl-8 pr-7 py-2 rounded-lg outline-none"
            style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)', color: 'var(--text-primary)' }} />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X size={12} style={{ color: 'var(--text-dim)' }} />
            </button>
          )}
        </div>
        <button onClick={() => void load(true)} disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
          style={{ border: '1px solid var(--shell-border)', color: 'var(--text-muted)' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="glass-panel p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading the roster…</div>
      ) : error ? (
        <div className="glass-panel p-6 text-sm" style={{ color: '#f87171' }}>{error}</div>
      ) : (
        <>
          {/* Unassigned bucket — the work nobody is holding */}
          {unassignedTotal > 0 && (
            <div className="glass-panel p-4 flex flex-wrap items-center gap-3"
              style={{ border: '1px solid rgba(248,113,113,0.35)' }}>
              <Inbox size={16} style={{ color: '#f87171' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Nobody is holding these yet:
              </p>
              {unassigned.customers > 0 && (
                <Link to="/crm/import/queue" className="text-xs font-semibold px-2.5 py-1 rounded-full hover:opacity-80"
                  style={{ backgroundColor: 'rgba(96,165,250,0.14)', color: '#60a5fa' }}>
                  {unassigned.customers} customer{unassigned.customers === 1 ? '' : 's'} → distribute
                </Link>
              )}
              {unassigned.leads > 0 && (
                <Link to="/crm/pipeline/leads" className="text-xs font-semibold px-2.5 py-1 rounded-full hover:opacity-80"
                  style={{ backgroundColor: 'rgba(201,169,97,0.14)', color: '#C9A961' }}>
                  {unassigned.leads} lead{unassigned.leads === 1 ? '' : 's'} in queue → assign
                </Link>
              )}
              {unassigned.cases > 0 && (
                <Link to="/crm/pipeline/cases" className="text-xs font-semibold px-2.5 py-1 rounded-full hover:opacity-80"
                  style={{ backgroundColor: 'rgba(52,211,153,0.14)', color: '#34d399' }}>
                  {unassigned.cases} case{unassigned.cases === 1 ? '' : 's'} without a handler
                </Link>
              )}
            </div>
          )}

          {/* Roster */}
          <div className="glass-panel p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--shell-border)' }}>
                    <th className="text-left font-semibold px-3 py-2.5">Person</th>
                    {COLS.map((c) => (
                      <th key={c.key} className="text-center font-semibold px-3 py-2.5 whitespace-nowrap" title={c.hint}>
                        <span style={{ color: c.color }}>{c.label}</span>
                      </th>
                    ))}
                    <th className="text-center font-semibold px-3 py-2.5">Total</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                      {q ? 'Nobody matches your search.' : 'Nothing is being handled right now.'}
                    </td></tr>
                  )}
                  {filtered.map((r) => {
                    const photo = photoByUid.get(r.uid);
                    return (
                      <tr key={r.uid} style={{ borderTop: '1px solid var(--shell-border)' }}>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2.5">
                            {photo ? (
                              <img src={photo} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                            ) : (
                              <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                                style={{ backgroundColor: 'rgba(201,169,97,0.18)', color: '#C9A961' }}>
                                {initials(r.name)}
                              </span>
                            )}
                            <span className="font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{r.name}</span>
                            {r.shared > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                style={{ backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-muted)' }}
                                title="Cases shared with them as a collaborator">
                                +{r.shared} shared
                              </span>
                            )}
                          </span>
                        </td>
                        {COLS.map((c) => (
                          <td key={c.key} className="px-3 py-2.5 text-center">
                            {r[c.key] > 0 ? (
                              <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                                style={{ backgroundColor: `${c.color}1f`, color: c.color }}>
                                {r[c.key]}
                              </span>
                            ) : (
                              <span className="text-xs" style={{ color: 'var(--text-dim)' }}>—</span>
                            )}
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-center text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{r.total}</td>
                        <td className="px-3 py-2.5 text-right">
                          <Link to={`/crm/performance?tab=team&uid=${r.uid}`}
                            className="text-[11px] font-semibold whitespace-nowrap" style={{ color: '#C9A961' }}>
                            Details →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--shell-border-mid)' }}>
                      <td className="px-3 py-2.5 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>TEAM TOTAL</td>
                      {COLS.map((c) => (
                        <td key={c.key} className="px-3 py-2.5 text-center text-xs font-bold" style={{ color: c.color }}>
                          {totals[c.key]}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-center text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        {totals.customers + totals.leads + totals.cases}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-dim)', borderTop: '1px solid var(--shell-border)' }}>
              Open work only — closed, converted and rejected records don't count.
              {idle > 0 ? ` ${idle} CRM teammate${idle === 1 ? '' : 's'} currently holding nothing.` : ''}
              {' '}Refreshes ~45s after changes.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
