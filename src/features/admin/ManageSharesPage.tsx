import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Share2, Users, Trophy, Search, RotateCcw, Trash2 } from 'lucide-react';
import { collection, onSnapshot, doc, writeBatch, arrayUnion } from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import { isSuperAdmin } from '../../config/hrmsConfig';
import { revokeShare } from '../../components/ui/SharePageButton';
import { useToast } from '../../components/ui/Toast';
import type { PageShare, ShareableModule } from '../../types';

const MODULE_BADGE: Record<ShareableModule, { label: string; color: string }> = {
  crm:  { label: 'CRM',  color: '#60a5fa' },
  hrms: { label: 'HRMS', color: '#34d399' },
  mis:  { label: 'MIS',  color: '#C9A961' },
};

/**
 * /admin/shares — super-admin console for ALL page shares (active + revoked).
 * Standalone page (no module shell) with a minimal header.
 */
export function ManageSharesPage() {
  const { user, profile, loading } = useAuth();
  const toast = useToast();

  const [shares, setShares] = useState<PageShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState<ShareableModule | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'revoked' | 'all'>('active');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'page_shares'), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PageShare);
      rows.sort((a, b) => (b.grantedAt?.toMillis?.() ?? 0) - (a.grantedAt?.toMillis?.() ?? 0));
      setShares(rows);
      setSharesLoading(false);
    }, () => setSharesLoading(false));
    return unsub;
  }, []);

  const active = useMemo(() => shares.filter((s) => s.active), [shares]);

  const stats = useMemo(() => {
    const employees = new Set(active.map((s) => s.grantedTo)).size;
    const counts = new Map<string, number>();
    for (const s of active) counts.set(s.pageTitle, (counts.get(s.pageTitle) ?? 0) + 1);
    let topPage = '—';
    let topN = 0;
    counts.forEach((n, title) => { if (n > topN) { topN = n; topPage = title; } });
    return { total: active.length, employees, topPage };
  }, [active]);

  const filtered = useMemo(() => shares.filter((s) => {
    if (moduleFilter !== 'all' && s.module !== moduleFilter) return false;
    if (statusFilter === 'active' && !s.active) return false;
    if (statusFilter === 'revoked' && s.active) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.grantedToName.toLowerCase().includes(q) ||
             s.grantedToEmail.toLowerCase().includes(q) ||
             s.pageTitle.toLowerCase().includes(q);
    }
    return true;
  }), [shares, moduleFilter, statusFilter, search]);

  // ── Guards ───────────────────────────────────────────────────────────────────
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!isSuperAdmin(user.uid, profile)) return <Navigate to="/" replace />;

  const actor = { uid: user.uid, name: profile?.displayName ?? '' };

  async function handleRevoke(share: PageShare) {
    setBusyId(share.id);
    try {
      await revokeShare(share, actor);
      toast.success(`Access revoked for ${share.grantedToName}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setBusyId('');
    }
  }

  async function handleRestore(share: PageShare) {
    setBusyId(share.id);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'page_shares', share.id), {
        active: true, revokedAt: null, revokedBy: null, revokedByName: null,
      });
      batch.update(doc(db, 'users', share.grantedTo), { sharedModules: arrayUnion(share.module) });
      await batch.commit();
      toast.success(`Access restored for ${share.grantedToName}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setBusyId('');
    }
  }

  const fmtDate = (ts: PageShare['grantedAt']) =>
    ts?.toDate ? format(ts.toDate(), 'dd MMM yyyy') : '—';

  const thCls = 'px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-left whitespace-nowrap';

  return (
    <div className="min-h-screen px-4 sm:px-8 py-6" style={{ backgroundColor: 'transparent' }}>
      <div className="max-w-5xl mx-auto">

        {/* Minimal header */}
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm mb-6 transition-opacity hover:opacity-70"
          style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft size={15} /> Back to launcher
        </Link>
        <div className="mb-6">
          <h1 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            Manage Shares
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Every page shared outside its team — grant history, revoke and restore. Super admins only.
          </p>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Active shares',               value: String(stats.total),    icon: Share2, color: '#C9A961' },
            { label: 'Employees with shared access', value: String(stats.employees), icon: Users,  color: '#60a5fa' },
            { label: 'Most-shared page',             value: stats.topPage,           icon: Trophy, color: '#34d399' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="glass-panel p-4 flex items-center gap-3">
              <Icon size={18} style={{ color }} />
              <div className="min-w-0">
                <p className="text-lg font-bold truncate" style={{ color: 'var(--text-primary)' }}>{value}</p>
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee or page…"
              className="glass-inp pl-9 w-full text-sm" />
          </div>
          <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value as ShareableModule | 'all')}
            className="glass-inp text-sm cursor-pointer">
            <option value="all">All modules</option>
            <option value="crm">CRM</option>
            <option value="hrms">HRMS</option>
            <option value="mis">MIS</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'active' | 'revoked' | 'all')}
            className="glass-inp text-sm cursor-pointer">
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
            <option value="all">All</option>
          </select>
        </div>

        {/* Table */}
        <div className="glass-panel overflow-x-auto">
          <table className="w-full glass-table min-w-175">
            <thead>
              <tr>
                <th className={thCls}>Employee</th>
                <th className={thCls}>Page</th>
                <th className={thCls}>Module</th>
                <th className={thCls}>Shared By</th>
                <th className={thCls}>Shared On</th>
                <th className={thCls}>Status</th>
                <th className={thCls}></th>
              </tr>
            </thead>
            <tbody>
              {sharesLoading && (
                <tr><td colSpan={7} className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>
              )}
              {!sharesLoading && filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>
                  No shares match these filters.
                </td></tr>
              )}
              {filtered.map((s) => {
                const mb = MODULE_BADGE[s.module];
                return (
                  <tr key={s.id} style={{ opacity: s.active ? 1 : 0.55 }}>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{s.grantedToName}</p>
                      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{s.grantedToEmail}</p>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>{s.pageTitle}</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: `${mb.color}1F`, color: mb.color }}>{mb.label}</span>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>{s.grantedByName}</td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{fmtDate(s.grantedAt)}</td>
                    <td className="px-4 py-3">
                      {s.active
                        ? <span className="badge-glass-success">Active</span>
                        : <span className="badge-glass-muted">Revoked</span>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {s.active ? (
                        <button onClick={() => handleRevoke(s)} disabled={busyId === s.id}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                          style={{ color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}>
                          <Trash2 size={11} /> {busyId === s.id ? '…' : 'Revoke'}
                        </button>
                      ) : (
                        <button onClick={() => handleRestore(s)} disabled={busyId === s.id}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                          style={{ color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }}>
                          <RotateCcw size={11} /> {busyId === s.id ? '…' : 'Restore'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {shares.some((s) => !s.active) && statusFilter !== 'revoked' && (
          <p className="text-[11px] mt-3" style={{ color: 'var(--text-dim)' }}>
            Revoked shares are kept as history — switch the status filter to see them.
          </p>
        )}
      </div>
    </div>
  );
}
