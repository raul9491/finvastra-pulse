import { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { Search, Shield, Users } from 'lucide-react';
import { updateDoc, doc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getIdToken } from 'firebase/auth';
import { auth, db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import type { UserProfile, CrmRole, MisAccess } from '../../../types';

async function syncClaims(targetUid: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) return;
  try {
    const token = await getIdToken(currentUser);
    await fetch(`/api/admin/users/${targetUid}/sync-claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    console.warn('[sync-claims] non-fatal:', e);
  }
}

// ─── Labels ───────────────────────────────────────────────────────────────────

const CRM_ROLE_LABELS: Record<NonNullable<CrmRole>, string> = {
  viewer:         'Viewer',
  lead_generator: 'Generator',
  lead_convertor: 'Convertor',
  manager:        'Manager',
  admin:          'Admin',
};

const MIS_LABELS: Record<NonNullable<MisAccess>, string> = {
  viewer: 'Viewer',
  admin:  'Admin',
};

// ─── Pill helpers ─────────────────────────────────────────────────────────────

function CrmPill({ role }: { role: CrmRole }) {
  if (!role) return <span className="text-xs text-mute">—</span>;
  const colors: Record<NonNullable<CrmRole>, { bg: string; text: string }> = {
    viewer:         { bg: '#F1F5F9', text: '#475569' },
    lead_generator: { bg: '#EFF6FF', text: '#1D4ED8' },
    lead_convertor: { bg: '#F0FDF4', text: '#166534' },
    manager:        { bg: '#FFFBEB', text: '#92400E' },
    admin:          { bg: '#FEF3C7', text: '#92400E' },
  };
  const c = colors[role];
  return (
    <span className="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
      style={{ backgroundColor: c.bg, color: c.text }}>
      {CRM_ROLE_LABELS[role]}
    </span>
  );
}

function MisPill({ access }: { access: MisAccess | undefined }) {
  if (!access) return <span className="text-xs text-mute">—</span>;
  return (
    <span className="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
      style={{ backgroundColor: '#F0FDF4', color: '#166534' }}>
      {MIS_LABELS[access]}
    </span>
  );
}

// ─── Inline permission row ────────────────────────────────────────────────────

function AccessRow({
  employee,
  adminUserId,
  selected,
  onSelect,
}: {
  employee: UserProfile;
  adminUserId: string;
  selected: boolean;
  onSelect: (checked: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);

  const sel = 'text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:ring-2 focus:ring-navy/10';

  async function save(patch: Partial<UserProfile>) {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', employee.userId), patch as Record<string, unknown>);
      await addDoc(collection(db, 'audit_logs'), {
        actor:      adminUserId,
        action:     'access_management_update',
        targetPath: `/users/${employee.userId}`,
        patch,
        at: serverTimestamp(),
      });
      await syncClaims(employee.userId);
    } finally {
      setSaving(false);
    }
  }

  const initials = employee.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <tr className={`border-b border-slate-100 transition-colors ${saving ? 'opacity-60' : 'hover:bg-slate-50/60'}`}>
      {/* Checkbox */}
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          className="w-4 h-4 rounded" />
      </td>

      {/* Employee */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {employee.photoURL ? (
            <img src={employee.photoURL} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              {initials}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-ink">{employee.displayName}</p>
            <p className="text-xs text-mute">{employee.email}</p>
          </div>
        </div>
      </td>

      {/* CRM Access toggle */}
      <td className="px-4 py-3">
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox"
            checked={employee.crmAccess === true}
            onChange={(e) => save({ crmAccess: e.target.checked, ...(e.target.checked ? {} : { crmRole: null, crmCanImport: false }) })}
            className="sr-only peer" />
          <div className="w-9 h-5 bg-slate-200 peer-checked:bg-navy rounded-full peer-focus:ring-2
            peer-focus:ring-navy/20 transition-colors after:content-[''] after:absolute after:top-0.5
            after:left-0.5 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform
            peer-checked:after:translate-x-4" />
        </label>
      </td>

      {/* CRM Role */}
      <td className="px-4 py-3">
        {employee.crmAccess ? (
          <select
            value={employee.crmRole ?? ''}
            onChange={(e) => save({ crmRole: (e.target.value || null) as CrmRole })}
            className={sel}
          >
            <option value="">— no role —</option>
            {(Object.keys(CRM_ROLE_LABELS) as NonNullable<CrmRole>[]).map((r) => (
              <option key={r} value={r}>{CRM_ROLE_LABELS[r]}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-mute">—</span>
        )}
      </td>

      {/* Import access */}
      <td className="px-4 py-3 text-center">
        {employee.crmAccess && employee.crmRole && employee.crmRole !== 'viewer' ? (
          <input type="checkbox"
            checked={employee.crmCanImport === true || employee.crmRole === 'manager' || employee.crmRole === 'admin'}
            disabled={employee.crmRole === 'manager' || employee.crmRole === 'admin'}
            onChange={(e) => save({ crmCanImport: e.target.checked })}
            className="w-4 h-4 rounded"
            title={employee.crmRole === 'manager' ? 'Managers always have import access' : 'Toggle bulk import access'} />
        ) : (
          <span className="text-xs text-mute">—</span>
        )}
      </td>

      {/* HRMS Manager */}
      <td className="px-4 py-3 text-center">
        <input type="checkbox"
          checked={employee.isHrmsManager === true}
          onChange={(e) => save({ isHrmsManager: e.target.checked })}
          className="w-4 h-4 rounded" />
      </td>

      {/* MIS Access */}
      <td className="px-4 py-3">
        <select
          value={employee.misAccess ?? ''}
          onChange={(e) => save({ misAccess: (e.target.value || null) as MisAccess | null })}
          className={sel}
        >
          <option value="">No access</option>
          <option value="viewer">Viewer</option>
          <option value="admin">Admin</option>
        </select>
      </td>
    </tr>
  );
}

// ─── Bulk action bar ──────────────────────────────────────────────────────────

function BulkBar({
  selectedIds,
  employees,
  adminUserId,
  onDone,
}: {
  selectedIds: string[];
  employees: UserProfile[];
  adminUserId: string;
  onDone: () => void;
}) {
  const [working, setWorking] = useState(false);

  async function applyBulk(patch: Partial<UserProfile>) {
    setWorking(true);
    try {
      for (const uid of selectedIds) {
        await updateDoc(doc(db, 'users', uid), patch as Record<string, unknown>);
        await addDoc(collection(db, 'audit_logs'), {
          actor: adminUserId, action: 'bulk_access_update',
          targetPath: `/users/${uid}`, patch, at: serverTimestamp(),
        });
        await syncClaims(uid);
      }
      onDone();
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-xl"
      style={{ backgroundColor: '#0B1538', border: '1px solid #1B2A4E' }}>
      <span className="text-sm font-semibold" style={{ color: '#C9A961' }}>
        {selectedIds.length} selected
      </span>
      <div className="w-px h-5" style={{ backgroundColor: '#1B2A4E' }} />

      <button onClick={() => applyBulk({ crmAccess: true })} disabled={working}
        className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-50">
        Enable CRM
      </button>
      <button onClick={() => applyBulk({ crmAccess: false, crmRole: null, crmCanImport: false })} disabled={working}
        className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-50">
        Remove CRM
      </button>

      <div className="w-px h-5" style={{ backgroundColor: '#1B2A4E' }} />

      <select disabled={working}
        className="text-xs bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-2.5 py-1.5 outline-none"
        defaultValue=""
        onChange={(e) => { if (e.target.value) applyBulk({ crmRole: e.target.value as CrmRole }); e.target.value = ''; }}>
        <option value="" disabled>Set CRM role…</option>
        {(Object.keys(CRM_ROLE_LABELS) as NonNullable<CrmRole>[]).map((r) => (
          <option key={r} value={r}>{CRM_ROLE_LABELS[r]}</option>
        ))}
      </select>

      <select disabled={working}
        className="text-xs bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-2.5 py-1.5 outline-none"
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'none') applyBulk({ misAccess: null });
          else if (v) applyBulk({ misAccess: v as MisAccess });
          e.target.value = '';
        }}>
        <option value="" disabled>Set MIS access…</option>
        <option value="none">No MIS access</option>
        <option value="viewer">MIS Viewer</option>
        <option value="admin">MIS Admin</option>
      </select>

      {working && <span className="text-xs animate-pulse" style={{ color: '#C9A961' }}>Saving…</span>}

      <button onClick={onDone}
        className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 transition-colors">
        Clear
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AccessManagementPage() {
  const { user, profile } = useAuth();
  const { employees, loading } = useAllEmployees();
  const [search, setSearch]         = useState('');
  const [filter, setFilter]         = useState<'all' | 'crm' | 'mis' | 'hrms_admin'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  if (profile?.role !== 'admin') return <Navigate to="/hrms/dashboard" replace />;

  const filtered = useMemo(() => {
    return employees.filter((e) => {
      if (search) {
        const q = search.toLowerCase();
        if (!e.displayName.toLowerCase().includes(q) && !e.email.toLowerCase().includes(q)) return false;
      }
      if (filter === 'crm')        return e.crmAccess === true;
      if (filter === 'mis')        return e.misAccess != null;
      if (filter === 'hrms_admin') return e.isHrmsManager === true;
      return true;
    });
  }, [employees, search, filter]);

  const allSelected = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.userId));

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(filtered.map((e) => e.userId)) : new Set());
  }

  const filterChips: Array<{ key: typeof filter; label: string; count: number }> = [
    { key: 'all',        label: 'All',          count: employees.length },
    { key: 'crm',        label: 'Has CRM',       count: employees.filter((e) => e.crmAccess).length },
    { key: 'mis',        label: 'Has MIS',       count: employees.filter((e) => e.misAccess).length },
    { key: 'hrms_admin', label: 'HRMS Manager',  count: employees.filter((e) => e.isHrmsManager).length },
  ];

  const thCls = 'px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-left text-mute';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl mb-1 text-ink"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300 }}>
            Access & Permissions
          </h2>
          <p className="text-sm text-mute">
            {loading ? 'Loading…' : `${employees.length} team members · changes save instantly`}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-mute">
          <Shield size={14} /> <span>All changes are audit-logged</span>
        </div>
      </div>

      {/* Filter chips + search */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="text-sm border border-slate-200 rounded-lg pl-9 pr-4 py-2 bg-white outline-none focus:ring-2 focus:ring-navy/10 w-52" />
        </div>
        {filterChips.map(({ key, label, count }) => (
          <button key={key} onClick={() => setFilter(key)}
            className="text-xs px-3 py-1.5 rounded-full font-semibold transition-colors"
            style={{
              backgroundColor: filter === key ? '#0B1538' : '#F1F5F9',
              color:           filter === key ? '#C9A961' : '#475569',
            }}>
            {label} <span className="ml-1 opacity-70">{count}</span>
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mb-4 text-xs text-mute">
        <span className="flex items-center gap-1.5"><Users size={12} /> CRM roles:</span>
        {(Object.entries(CRM_ROLE_LABELS) as [NonNullable<CrmRole>, string][]).map(([r, l]) => (
          <CrmPill key={r} role={r} />
        ))}
        <span className="text-slate-300">·</span>
        <span>MIS:</span>
        <MisPill access="viewer" />
        <MisPill access="admin" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="animate-pulse divide-y divide-slate-100">
            {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-slate-50" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ backgroundColor: '#FAFAF7', borderBottom: '1px solid #E2E8F0' }}>
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox"
                      checked={allSelected}
                      onChange={(e) => toggleAll(e.target.checked)}
                      className="w-4 h-4 rounded" />
                  </th>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>CRM Access</th>
                  <th className={thCls}>CRM Role</th>
                  <th className={`${thCls} text-center`}>Import</th>
                  <th className={`${thCls} text-center`}>HRMS Admin</th>
                  <th className={thCls}>MIS Access</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center text-sm text-mute">
                      No team members match your filter.
                    </td>
                  </tr>
                ) : filtered.map((emp) => (
                  <AccessRow
                    key={emp.userId}
                    employee={emp}
                    adminUserId={user!.uid}
                    selected={selectedIds.has(emp.userId)}
                    onSelect={(checked) => {
                      const next = new Set(selectedIds);
                      if (checked) next.add(emp.userId); else next.delete(emp.userId);
                      setSelectedIds(next);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <BulkBar
          selectedIds={[...selectedIds]}
          employees={employees}
          adminUserId={user!.uid}
          onDone={() => setSelectedIds(new Set())}
        />
      )}
    </div>
  );
}
