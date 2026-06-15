import { useMemo, useState } from 'react';
import { Users2, Search } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useCrm2Collection, hasCrm2Perm } from '../lib';
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
 * Crm2ClientsPage — Phase 1 minimal Client list (read-only). The full Client
 * Master (add/edit/assign-RM/profile %/loan history, FCL- IDs) lands in Phase 2.
 * Read scope is rule-enforced (admin / crm.leads.read / crm.cases.read).
 */
export function Crm2ClientsPage() {
  const { profile } = useAuth();
  const { rows: clients, loading, error } = useCrm2Collection<WithId<Client>>('clients');
  const [q, setQ] = useState('');

  const canSee = hasCrm2Perm(profile, 'crm.leads.read') || hasCrm2Perm(profile, 'crm.cases.read') || profile?.role === 'admin';

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
            Client master — {clients.length} record{clients.length === 1 ? '' : 's'}. Full add/edit, RM assignment, profile % and loan history arrive in Phase 2.
          </p>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / ID / mobile / PAN…"
            className="glass-inp text-sm pl-9 w-64" />
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
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Clients are created when a lead is converted (Phase 2 adds direct creation).</p>
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
                  <th className="text-left font-semibold px-3 py-2.5">KYC</th>
                  <th className="text-left font-semibold px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const sc = STATUS_COLOR[c.status] ?? STATUS_COLOR.INACTIVE;
                  return (
                    <tr key={c.id} style={{ borderTop: '1px solid var(--shell-border)' }}>
                      <td className="px-4 py-2.5 font-mono text-xs" style={{ color: '#C9A961' }}>{c.id}</td>
                      <td className="px-3 py-2.5 font-semibold" style={{ color: 'var(--text-primary)' }}>{c.name || '—'}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{CONSTITUTION[c.constitution] ?? c.constitution}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{c.ownerRm || '—'}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--text-muted)' }}>{c.kycStatus}</td>
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
    </div>
  );
}
