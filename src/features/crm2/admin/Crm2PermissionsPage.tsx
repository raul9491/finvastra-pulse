/**
 * Pipeline → Permissions — grant/revoke the CRM 2.0 permission keys per user.
 *
 * Saves via POST /api/crm2/perms/:uid which updates users/{uid}.perms, re-stamps
 * custom claims AND bumps claimsRefreshedAt — the target's open sessions
 * force-refresh their token immediately (PLAN.md claims-staleness fix), so
 * revocations apply without re-login. Platform admins implicitly hold all keys
 * and are shown read-only.
 */
import { useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useToast } from '../../../components/ui/Toast';
import { apiCrm2 } from '../lib';
import { CRM2_PERM_KEYS, type Crm2PermKey } from '../../../types/crm2';
import type { UserProfile } from '../../../types';

const KEY_GROUPS: Array<{ label: string; keys: Crm2PermKey[] }> = [
  { label: 'CRM',    keys: ['crm.leads.read', 'crm.leads.write', 'crm.cases.read', 'crm.cases.write', 'crm.masters.write'] },
  { label: 'Payout', keys: ['payout.read', 'payout.write', 'payout.amounts.read'] },
  { label: 'MIS & Recon', keys: ['mis.read', 'recon.read', 'recon.write'] },
];

type EmployeeRow = UserProfile & { perms?: Partial<Record<Crm2PermKey, boolean>> };

function PermsModal({ user, onClose }: { user: EmployeeRow; onClose: () => void }) {
  const toast = useToast();
  const [perms, setPerms] = useState<Partial<Record<Crm2PermKey, boolean>>>(() => ({ ...(user.perms ?? {}) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = (k: Crm2PermKey) => setPerms((p) => ({ ...p, [k]: !p[k] }));

  const handleSave = async () => {
    setBusy(true); setError('');
    try {
      await apiCrm2('POST', `/api/crm2/perms/${user.userId}`, { perms });
      toast.success(`Permissions updated for ${user.displayName} — applies immediately`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-md rounded-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{user.displayName}</h3>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{user.employeeId ?? user.userId} · Pipeline permissions</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close">
            <X size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {error && (
            <div className="px-3.5 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#f87171' }}>
              {error}
            </div>
          )}
          {KEY_GROUPS.map((g) => (
            <div key={g.label}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>{g.label}</p>
              <div className="space-y-1.5">
                {g.keys.map((k) => (
                  <label key={k} className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer border transition-colors"
                    style={{ borderColor: perms[k] ? 'rgba(201,169,97,0.4)' : 'var(--shell-border)',
                             backgroundColor: perms[k] ? 'rgba(201,169,97,0.08)' : 'transparent' }}>
                    <input type="checkbox" checked={perms[k] === true} onChange={() => toggle(k)} />
                    <span className="text-sm font-mono" style={{ color: perms[k] ? '#C9A961' : 'var(--text-secondary)' }}>{k}</span>
                    {k === 'payout.amounts.read' && (
                      <span className="ml-auto text-[10px] font-bold uppercase" style={{ color: '#fbbf24' }}>money</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={handleSave} disabled={busy}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {busy ? 'Saving…' : 'Save & Apply'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Crm2PermissionsPage() {
  const { profile } = useAuth();
  const { employees } = useAllEmployees();
  const [editFor, setEditFor] = useState<EmployeeRow | null>(null);
  const [search, setSearch] = useState('');

  if (profile?.role !== 'admin') {
    return (
      <div className="glass-panel p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        Admin only.
      </div>
    );
  }

  const rows = (employees as EmployeeRow[])
    .filter((e) => e.employeeStatus !== 'inactive')
    .filter((e) => !search || e.displayName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (a.employeeId ?? '').localeCompare(b.employeeId ?? ''));

  const heldCount = (e: EmployeeRow) =>
    e.role === 'admin' ? CRM2_PERM_KEYS.length : CRM2_PERM_KEYS.filter((k) => e.perms?.[k] === true).length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          Pipeline Permissions
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Grant the CRM 2.0 keys per user. Changes apply to open sessions immediately.
        </p>
      </div>

      <input className="glass-inp text-sm w-72" placeholder="Search employees…"
        value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="glass-panel p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              <th className="text-left font-semibold px-4 py-2.5">Employee</th>
              <th className="text-left font-semibold px-3 py-2.5">Keys held</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.userId} style={{ borderTop: '1px solid var(--shell-border)' }}>
                <td className="px-4 py-2.5">
                  <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{e.displayName}</p>
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{e.employeeId ?? '—'} · {e.designation ?? ''}</p>
                </td>
                <td className="px-3 py-2.5">
                  {e.role === 'admin' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#C9A961' }}>
                      <ShieldCheck size={13} /> all (admin)
                    </span>
                  ) : (
                    <span className="text-xs" style={{ color: heldCount(e) > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {heldCount(e)} / {CRM2_PERM_KEYS.length}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {e.role !== 'admin' && (
                    <button onClick={() => setEditFor(e)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-opacity hover:opacity-80"
                      style={{ borderColor: 'rgba(201,169,97,0.35)', color: '#C9A961' }}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editFor && <PermsModal user={editFor} onClose={() => setEditFor(null)} />}
    </div>
  );
}
