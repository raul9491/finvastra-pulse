import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AlertTriangle, Search as SearchIcon, X, UserCheck, CheckCircle2, Ban } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '../../auth/AuthContext';
import {
  useDisputes, assignDisputeToMe, addDisputeNote, resolveDispute, setDisputeStatus,
} from '../hooks/useDisputes';
import { useToast } from '../../../components/ui/Toast';
import type { CommissionDispute, DisputeStatus } from '../../../types';

const STATUS_META: Record<DisputeStatus, { label: string; cls: string }> = {
  open:          { label: 'Open',          cls: 'badge-glass-danger' },
  investigating: { label: 'Investigating', cls: 'badge-glass-warning' },
  resolved:      { label: 'Resolved',      cls: 'badge-glass-success' },
  written_off:   { label: 'Written off',   cls: 'badge-glass-muted' },
};

const PRIORITY_META = {
  high:   { label: 'High',   color: '#f87171' },
  medium: { label: 'Medium', color: '#fbbf24' },
  low:    { label: 'Low',    color: 'var(--text-muted)' },
} as const;

const rupee = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const fmtTs = (ts: { toDate?: () => Date } | null | undefined) =>
  ts?.toDate ? format(ts.toDate(), 'dd MMM yyyy, HH:mm') : '—';

type FilterChip = 'all' | 'high' | 'open' | 'resolved';

// ─── Detail modal ─────────────────────────────────────────────────────────────

function DisputeDetailModal({ d, actor, onClose }: {
  d: CommissionDispute;
  actor: { uid: string; name: string };
  onClose: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');
  const [resolveMode, setResolveMode] = useState<'resolved' | 'written_off' | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(false); }
  }

  const sm = STATUS_META[d.status];
  const isClosed = d.status === 'resolved' || d.status === 'written_off';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-lg flex flex-col max-h-[88vh]" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-6 py-4 shrink-0">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {d.providerName} · {d.leadName}
            </h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Created {fmtTs(d.createdAt)} by {d.createdBy === 'system' ? 'auto-reconciliation' : d.createdBy}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-mid)" style={{ color: 'var(--text-muted)' }}>
            <X size={17} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {/* Numbers */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Expected', value: rupee(d.expectedAmount), color: 'var(--text-primary)' },
              { label: 'Received', value: rupee(d.receivedAmount), color: 'var(--text-primary)' },
              { label: 'Variance', value: `${d.variance > 0 ? '+' : ''}${rupee(d.variance)} (${d.variancePct}%)`, color: d.variance < 0 ? '#f87171' : '#34d399' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl p-3 border border-(--shell-border)">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
                <p className="text-sm font-bold" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>

          {/* Status timeline */}
          <div className="text-xs space-y-1.5" style={{ color: 'var(--text-muted)' }}>
            <p><span className={sm.cls}>{sm.label}</span></p>
            {d.assignedToName && <p>Assigned to <strong style={{ color: 'var(--text-primary)' }}>{d.assignedToName}</strong> · {fmtTs(d.assignedAt)}</p>}
            {d.resolution && (
              <p>Resolution: <span style={{ color: 'var(--text-primary)' }}>{d.resolution}</span> · {fmtTs(d.resolvedAt)}</p>
            )}
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-3 text-xs font-semibold">
            {d.leadId && (
              <Link to={`/crm/leads/${d.leadId}/opportunities/${d.opportunityId}`} style={{ color: '#C9A961' }}>
                View CRM opportunity →
              </Link>
            )}
            <Link to="/crm/commissions" style={{ color: '#C9A961' }}>Commission records →</Link>
          </div>

          {/* Notes (append-only) */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Notes</p>
            {(d.notes ?? []).length === 0 && <p className="text-xs" style={{ color: 'var(--text-dim)' }}>No notes yet.</p>}
            <div className="space-y-2">
              {(d.notes ?? []).map((n, i) => (
                <div key={i} className="text-xs rounded-lg p-2.5 border border-(--shell-border)">
                  <p style={{ color: 'var(--text-primary)' }}>{n.text}</p>
                  <p className="mt-1" style={{ color: 'var(--text-dim)' }}>{n.byName} · {fmtTs(n.at)}</p>
                </div>
              ))}
            </div>
            {!isClosed && (
              <div className="flex gap-2 mt-2">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an investigation note…"
                  className="glass-inp flex-1 text-xs" />
                <button disabled={!note.trim() || busy}
                  onClick={() => run(async () => {
                    await addDisputeNote(d.id, note.trim(), actor.uid, actor.name);
                    if (d.status === 'open') await setDisputeStatus(d.id, 'investigating');
                    setNote('');
                  }, 'Note added')}
                  className="text-xs font-semibold px-3 rounded-lg disabled:opacity-40 shrink-0"
                  style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                  Add
                </button>
              </div>
            )}
          </div>

          {/* Actions */}
          {!isClosed && (
            <div className="space-y-3 pt-2" style={{ borderTop: '1px solid var(--shell-border)' }}>
              <div className="flex flex-wrap gap-2 pt-3">
                {d.assignedTo !== actor.uid && (
                  <button disabled={busy}
                    onClick={() => run(() => assignDisputeToMe(d.id, actor.uid, actor.name), 'Assigned to you')}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-(--shell-border)"
                    style={{ color: 'var(--text-primary)' }}>
                    <UserCheck size={13} /> Assign to me
                  </button>
                )}
                <button disabled={busy} onClick={() => setResolveMode('resolved')}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg"
                  style={{ color: '#34d399', border: '1px solid rgba(52,211,153,0.30)' }}>
                  <CheckCircle2 size={13} /> Resolve
                </button>
                <button disabled={busy} onClick={() => setResolveMode('written_off')}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg"
                  style={{ color: 'var(--text-muted)', border: '1px solid var(--shell-border)' }}>
                  <Ban size={13} /> Write off
                </button>
              </div>

              {resolveMode && (
                <div className="space-y-2">
                  <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2}
                    placeholder={resolveMode === 'resolved' ? 'How was this resolved? (e.g. bank paid the shortfall on …)' : 'Reason for writing this off…'}
                    className="glass-inp w-full text-xs resize-none" />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setResolveMode(null)} className="text-xs px-3 py-1.5" style={{ color: 'var(--text-muted)' }}>Cancel</button>
                    <button disabled={!resolution.trim() || busy}
                      onClick={() => run(async () => {
                        await resolveDispute(d.id, resolution.trim(), actor.uid, resolveMode);
                        onClose();
                      }, resolveMode === 'resolved' ? 'Dispute resolved' : 'Dispute written off')}
                      className="text-xs font-semibold px-4 py-1.5 rounded-lg disabled:opacity-40"
                      style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                      Confirm
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DisputesPage() {
  const { user, profile } = useAuth();
  const canSee = profile?.role === 'admin' || profile?.misAccess != null ||
    (profile?.sharedModules ?? []).includes('mis');
  const { disputes, loading } = useDisputes(!!user && canSee);

  const [chip, setChip] = useState<FilterChip>('all');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<CommissionDispute | null>(null);

  const stats = useMemo(() => ({
    open:          disputes.filter((d) => d.status === 'open').length,
    investigating: disputes.filter((d) => d.status === 'investigating').length,
    resolved:      disputes.filter((d) => d.status === 'resolved').length,
    atRisk:        disputes.filter((d) => d.status === 'open' || d.status === 'investigating')
                           .reduce((s, d) => s + Math.abs(Math.min(d.variance, 0)), 0),
  }), [disputes]);

  const filtered = useMemo(() => disputes.filter((d) => {
    if (chip === 'high' && d.priority !== 'high') return false;
    if (chip === 'open' && d.status !== 'open') return false;
    if (chip === 'resolved' && d.status !== 'resolved') return false;
    if (search) {
      const q = search.toLowerCase();
      return d.providerName.toLowerCase().includes(q) || d.leadName.toLowerCase().includes(q);
    }
    return true;
  }), [disputes, chip, search]);

  if (profile && !canSee) return <Navigate to="/" replace />;

  const actor = { uid: user?.uid ?? '', name: profile?.displayName ?? '' };
  const live = detail ? disputes.find((x) => x.id === detail.id) ?? detail : null;
  const thCls = 'px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-left whitespace-nowrap';

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          Commission Disputes
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Auto-raised when reconciliation finds a variance above 5% — track every rupee to resolution.
        </p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Open',           value: String(stats.open),          color: '#f87171' },
          { label: 'Investigating',  value: String(stats.investigating), color: '#fbbf24' },
          { label: 'Resolved',       value: String(stats.resolved),      color: '#34d399' },
          { label: 'Total at risk',  value: rupee(stats.atRisk),         color: '#C9A961' },
        ].map(({ label, value, color }) => (
          <div key={label} className="glass-panel p-4">
            <p className="text-xl font-bold" style={{ color }}>{value}</p>
            <p className="text-[10px] font-semibold uppercase tracking-widest mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(['all', 'high', 'open', 'resolved'] as FilterChip[]).map((c) => (
          <button key={c} onClick={() => setChip(c)}
            className="text-xs font-semibold px-3 py-1.5 rounded-full capitalize transition-colors"
            style={chip === c
              ? { backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.4)' }
              : { color: 'var(--text-muted)', border: '1px solid var(--shell-border)' }}>
            {c === 'high' ? 'High priority' : c}
          </button>
        ))}
        <div className="relative flex-1 min-w-[180px] ml-auto">
          <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Provider or customer…"
            className="glass-inp pl-9 w-full text-sm" />
        </div>
      </div>

      {/* Table */}
      <div className="glass-panel overflow-x-auto">
        <table className="w-full glass-table min-w-175">
          <thead>
            <tr>
              <th className={thCls}>Provider</th>
              <th className={thCls}>Customer</th>
              <th className={`${thCls} text-right`}>Expected</th>
              <th className={`${thCls} text-right`}>Received</th>
              <th className={`${thCls} text-right`}>Variance</th>
              <th className={thCls}>Priority</th>
              <th className={thCls}>Status</th>
              <th className={thCls}>Assigned</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} className="text-center py-12">
                <AlertTriangle size={28} className="mx-auto mb-2" style={{ color: 'var(--text-dim)' }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No disputes — every reconciled rupee matches.</p>
              </td></tr>
            )}
            {filtered.map((d) => {
              const pm = PRIORITY_META[d.priority];
              const sm = STATUS_META[d.status];
              return (
                <tr key={d.id} onClick={() => setDetail(d)} className="cursor-pointer">
                  <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{d.providerName}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>{d.leadName}</td>
                  <td className="px-4 py-3 text-sm text-right whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{rupee(d.expectedAmount)}</td>
                  <td className="px-4 py-3 text-sm text-right whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{rupee(d.receivedAmount)}</td>
                  <td className="px-4 py-3 text-sm text-right whitespace-nowrap font-semibold" style={{ color: d.variance < 0 ? '#f87171' : '#34d399' }}>
                    {d.variance > 0 ? '+' : ''}{rupee(d.variance)}
                  </td>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: pm.color }}>{pm.label}</td>
                  <td className="px-4 py-3"><span className={sm.cls}>{sm.label}</span></td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>{d.assignedToName ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {live && <DisputeDetailModal d={live} actor={actor} onClose={() => setDetail(null)} />}
    </div>
  );
}
