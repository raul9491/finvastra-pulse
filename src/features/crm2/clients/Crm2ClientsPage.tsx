import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users2, Search, Plus } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useCrm2Collection, hasCrm2Perm } from '../lib';
import { ClientFormModal, clientCompletionPct } from './ClientFormModal';
import type { Client } from '../../../types/crm2';

type WithId<T> = T & { id: string };

const CONSTITUTION: Record<string, string> = {
  INDIVIDUAL: 'Individual', PROPRIETORSHIP: 'Proprietorship', PARTNERSHIP: 'Partnership',
  LLP: 'LLP', PVT_LTD: 'Pvt Ltd', HUF: 'HUF',
};
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  ACTIVE: { bg: 'rgba(52,211,153,0.14)', fg: '#34d399' },
  INACTIVE: { bg: 'var(--shell-hover-hard)', fg: 'var(--text-muted)' },
  BLACKLISTED: { bg: 'rgba(248,113,113,0.14)', fg: '#f87171' },
};

/**
 * Crm2ClientsPage — Client Master list. RMs see their own clients (read scope is
 * rule-enforced); admins/managers see the org. Add → ClientFormModal; row → the
 * client detail workspace. Direct create is gated by crm.cases.write.
 */
export function Crm2ClientsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { rows: clients, loading, error } = useCrm2Collection<WithId<Client>>('clients');
  const { employees } = useAllEmployees();
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);

  const isAdmin = profile?.role === 'admin';
  const canSee = hasCrm2Perm(profile, 'crm.leads.read') || hasCrm2Perm(profile, 'crm.cases.read') || isAdmin;
  const canWrite = hasCrm2Perm(profile, 'crm.cases.write');

  const faplOptions = useMemo(() =>
    employees.filter((e) => e.employeeStatus !== 'inactive' && e.employeeId)
      .map((e) => ({ value: e.employeeId!, label: `${e.displayName} (${e.employeeId})` })),
    [employees]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return clients;
    return clients.filter((c) =>
      c.name?.toLowerCase().includes(s) || c.id.toLowerCase().includes(s)
      || c.primaryContact?.mobile?.includes(s) || (c.panLast4 ?? '').includes(s));
  }, [clients, q]);

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            Clients
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Client master — {clients.length} record{clients.length === 1 ? '' : 's'}. Open a client for its profile, loan history and repeat cases.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / ID / mobile / PAN…"
              className="glass-inp text-sm pl-9 w-64" />
          </div>
          {canWrite && (
            <button onClick={() => setShowNew(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold shrink-0"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              <Plus size={15} /> Add Client
            </button>
          )}
        </div>
      </div>

      {!canSee ? (
        <div className="glass-panel p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          You don’t have access to clients. Ask an admin for the <strong>crm.leads.read</strong> or <strong>crm.cases.read</strong> permission.
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 py-16 justify-center">
          <div className="w-5 h-5 rounded-full border-2 border-gold border-t-transparent animate-spin" />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading clients…</span>
        </div>
      ) : error ? (
        <div className="glass-panel p-4 text-sm" style={{ color: '#f87171' }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel p-10 text-center">
          <Users2 size={34} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{q ? 'No clients match your search' : 'No clients yet'}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {canWrite ? 'Add a client directly, or convert a qualified lead.' : 'Clients are created when a lead is converted.'}
          </p>
        </div>
      ) : (
        <div className="glass-panel p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left font-semibold px-4 py-2.5">Client ID</th>
                  <th className="text-left font-semibold px-3 py-2.5">Name</th>
                  <th className="text-left font-semibold px-3 py-2.5">Constitution</th>
                  <th className="text-left font-semibold px-3 py-2.5">Owner RM</th>
                  <th className="text-left font-semibold px-3 py-2.5">Profile</th>
                  <th className="text-left font-semibold px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const sc = STATUS_COLOR[c.status] ?? STATUS_COLOR.INACTIVE;
                  const pct = clientCompletionPct(c);
                  return (
                    <tr key={c.id} onClick={() => navigate(`/crm/pipeline/clients/${c.id}`)}
                      className="cursor-pointer hover:bg-(--shell-hover-soft) transition-colors"
                      style={{ borderTop: '1px solid var(--shell-border)' }}>
                      <td className="px-4 py-2.5 font-mono text-xs" style={{ color: '#C9A961' }}>{c.id}</td>
                      <td className="px-3 py-2.5 font-semibold" style={{ color: 'var(--text-primary)' }}>{c.name || '—'}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{CONSTITUTION[c.constitution] ?? c.constitution}</td>
                      <td className="px-3 py-2.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{c.ownerRm || '—'}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 80 ? '#34d399' : pct >= 50 ? '#C9A961' : '#f87171' }} />
                          </div>
                          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{pct}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: sc.bg, color: sc.fg }}>{c.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showNew && canWrite && (
        <ClientFormModal mode="create" canAssignRm={isAdmin} faplOptions={faplOptions}
          onClose={() => setShowNew(false)} onSaved={(id) => navigate(`/crm/pipeline/clients/${id}`)} />
      )}
    </div>
  );
}
