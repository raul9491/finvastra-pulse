import { useState, useMemo, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Search, Save, RotateCcw, CheckCircle2, Lock,
  AlertCircle, ChevronDown,
} from 'lucide-react';
import { updateDoc, doc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getIdToken } from 'firebase/auth';
import { auth, db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import type { UserProfile, CrmRole, MisAccess } from '../../../types';
import { isSuperAdmin } from '../../../config/hrmsConfig';

// ─── Types ────────────────────────────────────────────────────────────────────

type PermDraft = {
  role:          'admin' | 'employee';
  hrmsAccess:    boolean;
  isHrmsManager: boolean;
  crmAccess:     boolean;
  crmRole:       CrmRole;
  misAccess:     MisAccess | null;
};

function toDraft(e: UserProfile): PermDraft {
  return {
    role:          e.role === 'admin' ? 'admin' : 'employee',
    hrmsAccess:    e.hrmsAccess !== false,
    isHrmsManager: e.isHrmsManager === true,
    crmAccess:     e.crmAccess === true,
    crmRole:       e.crmRole ?? null,
    misAccess:     e.misAccess ?? null,
  };
}

function isDirty(a: PermDraft, b: PermDraft): boolean {
  return a.role !== b.role
      || a.hrmsAccess !== b.hrmsAccess
      || a.isHrmsManager !== b.isHrmsManager
      || a.crmAccess !== b.crmAccess
      || a.crmRole !== b.crmRole
      || a.misAccess !== b.misAccess;
}

// ─── Sync claims helper ───────────────────────────────────────────────────────

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

// ─── Styled select helper ─────────────────────────────────────────────────────

const SEL = 'text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none ' +
            'focus:ring-2 focus:ring-navy/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

// ─── Single employee permission row ──────────────────────────────────────────

function PermRow({
  employee,
  draft,
  dirty,
  onChange,
}: {
  employee: UserProfile;
  draft: PermDraft;
  dirty: boolean;
  onChange: (patch: Partial<PermDraft>) => void;
}) {
  const initials = employee.displayName
    .split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  const rowBg  = dirty ? 'rgba(201,169,97,0.05)' : '';
  const rowShadow = dirty ? 'inset 3px 0 0 #C9A961' : 'inset 3px 0 0 transparent';

  return (
    <tr
      className="border-b border-slate-100 transition-colors"
      style={{ backgroundColor: rowBg, boxShadow: rowShadow }}
    >
      {/* Employee */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          {employee.photoURL ? (
            <img src={employee.photoURL} alt=""
              className="w-8 h-8 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink truncate">{employee.displayName}</p>
            <p className="text-xs text-mute truncate">{employee.email}</p>
          </div>
        </div>
      </td>

      {/* Role */}
      <td className="px-3 py-3">
        <select
          value={draft.role}
          onChange={(e) => onChange({ role: e.target.value as 'admin' | 'employee' })}
          className={SEL}
          style={{
            borderColor: draft.role === 'admin' ? '#C9A961' : '#E2E8F0',
            color:       draft.role === 'admin' ? '#7A6030' : '#475569',
            fontWeight:  draft.role === 'admin' ? 600 : 400,
          }}
        >
          <option value="employee">Employee</option>
          <option value="admin">Admin</option>
        </select>
      </td>

      {/* HRMS Access */}
      <td className="px-3 py-3 text-center">
        <input
          type="checkbox"
          checked={draft.hrmsAccess}
          onChange={(e) => onChange({ hrmsAccess: e.target.checked })}
          className="w-4 h-4 rounded cursor-pointer"
          style={{ accentColor: '#0B1538' }}
        />
      </td>

      {/* HR Manager */}
      <td className="px-3 py-3 text-center">
        <input
          type="checkbox"
          checked={draft.isHrmsManager}
          onChange={(e) => onChange({ isHrmsManager: e.target.checked })}
          className="w-4 h-4 rounded cursor-pointer"
          style={{ accentColor: '#0B1538' }}
        />
      </td>

      {/* CRM Access toggle */}
      <td className="px-3 py-3 text-center">
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={draft.crmAccess}
            onChange={(e) => onChange({ crmAccess: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-slate-200 peer-checked:bg-navy rounded-full peer-focus:ring-2
            peer-focus:ring-navy/20 transition-colors after:content-[''] after:absolute after:top-0.5
            after:left-0.5 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform
            peer-checked:after:translate-x-4" />
        </label>
      </td>

      {/* CRM Role */}
      <td className="px-3 py-3">
        <select
          value={draft.crmRole ?? ''}
          disabled={!draft.crmAccess}
          onChange={(e) => onChange({ crmRole: (e.target.value || null) as CrmRole })}
          className={SEL}
        >
          <option value="">— none —</option>
          <option value="viewer">Viewer</option>
          <option value="lead_generator">Generator</option>
          <option value="lead_convertor">Convertor</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
      </td>

      {/* MIS Access */}
      <td className="px-3 py-3">
        <select
          value={draft.misAccess ?? ''}
          onChange={(e) => onChange({ misAccess: (e.target.value || null) as MisAccess | null })}
          className={SEL}
        >
          <option value="">No access</option>
          <option value="viewer">Viewer</option>
          <option value="admin">Admin</option>
        </select>
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function SuperAdminPermissionsPage() {
  const { user, profile } = useAuth();
  const { employees, loading } = useAllEmployees();

  const initialized = useRef(false);
  const [originals,  setOriginals]  = useState<Record<string, PermDraft>>({});
  const [drafts,     setDrafts]     = useState<Record<string, PermDraft>>({});
  const [saving,     setSaving]     = useState(false);
  const [showSaved,  setShowSaved]  = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [search,     setSearch]     = useState('');
  const [filter,     setFilter]     = useState<'all' | 'changed' | 'admins' | 'crm' | 'mis'>('all');

  // ── Initialize drafts once when employees first load ─────────────────────
  useEffect(() => {
    if (initialized.current || loading || employees.length === 0) return;
    initialized.current = true;
    const map: Record<string, PermDraft> = {};
    employees
      .filter((e) => !isSuperAdmin(e.userId))
      .forEach((e) => { map[e.userId] = toDraft(e); });
    setOriginals(map);
    setDrafts({ ...map });
  }, [employees, loading]);

  // ── Dirty UIDs ────────────────────────────────────────────────────────────
  const dirtyUids = useMemo(() =>
    Object.keys(drafts).filter((uid) => {
      const orig  = originals[uid];
      const draft = drafts[uid];
      return orig && draft && isDirty(draft, orig);
    }),
    [drafts, originals],
  );

  // ── Editable employees list (non-super-admin, sorted alphabetically) ─────
  const editableEmployees = useMemo(() =>
    employees
      .filter((e) => !isSuperAdmin(e.userId))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [employees],
  );

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    return editableEmployees.filter((e) => {
      const draft = drafts[e.userId];
      if (!draft) return false;
      if (search) {
        const q = search.toLowerCase();
        const match = e.displayName.toLowerCase().includes(q)
                   || (e.email?.toLowerCase().includes(q) ?? false);
        if (!match) return false;
      }
      if (filter === 'changed') return dirtyUids.includes(e.userId);
      if (filter === 'admins')  return draft.role === 'admin';
      if (filter === 'crm')     return draft.crmAccess;
      if (filter === 'mis')     return draft.misAccess != null;
      return true;
    });
  }, [editableEmployees, drafts, search, filter, dirtyUids]);

  // ── All hooks declared — guard comes after ────────────────────────────────
  if (!isSuperAdmin(user?.uid ?? '')) return <Navigate to="/hrms/dashboard" replace />;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const updateDraft = (uid: string, changes: Partial<PermDraft>) => {
    setDrafts((prev) => {
      const curr = prev[uid];
      if (!curr) return prev;
      const updated = { ...curr, ...changes };
      // Auto-clear CRM role when CRM access is revoked
      if (changes.crmAccess === false) updated.crmRole = null;
      return { ...prev, [uid]: updated };
    });
  };

  const handleDiscard = () => {
    setDrafts({ ...originals });
  };

  const handleSave = async () => {
    if (dirtyUids.length === 0 || saving) return;
    setSaving(true);
    setShowSaved(false);
    try {
      for (const uid of dirtyUids) {
        const draft = drafts[uid];
        const patch = {
          role:          draft.role,
          hrmsAccess:    draft.hrmsAccess,
          isHrmsManager: draft.isHrmsManager,
          crmAccess:     draft.crmAccess,
          crmRole:       draft.crmAccess ? draft.crmRole : null,
          misAccess:     draft.misAccess,
        };
        await updateDoc(doc(db, 'users', uid), patch);
        await addDoc(collection(db, 'audit_logs'), {
          actor:      user!.uid,
          action:     'super_admin_permissions_update',
          targetPath: `/users/${uid}`,
          patch,
          at:         serverTimestamp(),
        });
        await syncClaims(uid);
      }
      // Commit — new baseline equals current drafts
      const committed = { ...originals };
      dirtyUids.forEach((uid) => { committed[uid] = { ...drafts[uid] }; });
      setOriginals(committed);
      setSavedCount(dirtyUids.length);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 5000);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const thCls = 'px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-left whitespace-nowrap';

  const filterChips = [
    { key: 'all',     label: 'All',       count: editableEmployees.length },
    { key: 'changed', label: 'Changed',   count: dirtyUids.length },
    { key: 'admins',  label: 'Admins',    count: Object.values(drafts).filter((d) => d.role === 'admin').length },
    { key: 'crm',     label: 'Has CRM',   count: Object.values(drafts).filter((d) => d.crmAccess).length },
    { key: 'mis',     label: 'Has MIS',   count: Object.values(drafts).filter((d) => d.misAccess != null).length },
  ] as const;

  return (
    <div className="pb-32">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Lock size={18} style={{ color: '#C9A961' }} />
            <h2 className="text-3xl text-ink"
              style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300 }}>
              Permission Manager
            </h2>
          </div>
          <p className="text-sm text-mute">
            {loading
              ? 'Loading…'
              : `${editableEmployees.length} employees · edit freely, then save once`}
          </p>
        </div>

        {/* Super Admin badge */}
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mt-1"
          style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#9A7E3F' }}>
          ★ Super Admin Only
        </span>
      </div>

      {/* ── Saved confirmation banner ─────────────────────────────────────── */}
      {showSaved && (
        <div className="mb-5 flex items-center gap-3 px-5 py-4 rounded-2xl"
          style={{ backgroundColor: '#ECFDF5', border: '1px solid #6EE7B7' }}>
          <CheckCircle2 size={18} style={{ color: '#059669' }} className="shrink-0" />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#065F46' }}>
              Permissions saved — {savedCount} employee{savedCount === 1 ? '' : 's'} updated
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#047857' }}>
              Auth tokens refreshed · Changes take effect on next sign-in
            </p>
          </div>
        </div>
      )}

      {/* ── Legend / column guide ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4 text-xs text-mute">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border-l-2 inline-block" style={{ borderColor: '#C9A961', backgroundColor: 'rgba(201,169,97,0.1)' }} />
          Row highlighted = unsaved change
        </span>
        <span>HRMS = can access HR module</span>
        <span>HR Mgr = leave approvals + admin attendance</span>
        <span>CRM On = enable CRM module access</span>
      </div>

      {/* ── Filter chips + search ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="text-sm border border-slate-200 rounded-lg pl-9 pr-4 py-2 bg-white outline-none
              focus:ring-2 focus:ring-navy/10 w-52"
          />
        </div>
        {filterChips.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className="text-xs px-3 py-1.5 rounded-full font-semibold transition-colors"
            style={{
              backgroundColor: filter === key ? '#0B1538' : '#F1F5F9',
              color:           filter === key ? '#C9A961' : '#475569',
            }}
          >
            {label}
            {(key !== 'all' || true) && (
              <span className="ml-1.5 opacity-70">{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Permissions table ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="animate-pulse divide-y divide-slate-100">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-[56px] bg-slate-50" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ backgroundColor: '#FAFAF7', borderBottom: '1px solid #E2E8F0' }}>
                  <th className={`${thCls} pl-4 w-64`} style={{ color: '#8B8B85' }}>Employee</th>
                  <th className={thCls} style={{ color: '#8B8B85' }}>Role</th>
                  <th className={`${thCls} text-center`} style={{ color: '#8B8B85' }}>HRMS</th>
                  <th className={`${thCls} text-center`} style={{ color: '#8B8B85' }}>HR Mgr</th>
                  <th className={`${thCls} text-center`} style={{ color: '#8B8B85' }}>CRM On</th>
                  <th className={thCls} style={{ color: '#8B8B85' }}>CRM Role</th>
                  <th className={thCls} style={{ color: '#8B8B85' }}>MIS Access</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-16 text-center text-sm text-mute">
                      {filter === 'changed'
                        ? 'No unsaved changes yet — start editing rows above.'
                        : 'No employees match your search.'}
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((emp) => {
                    const draft = drafts[emp.userId];
                    if (!draft) return null;
                    return (
                      <PermRow
                        key={emp.userId}
                        employee={emp}
                        draft={draft}
                        dirty={dirtyUids.includes(emp.userId)}
                        onChange={(patch) => updateDraft(emp.userId, patch)}
                      />
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Count footer ─────────────────────────────────────────────────── */}
      {!loading && filteredRows.length > 0 && (
        <p className="text-xs text-mute mt-3 text-right">
          {filteredRows.length} of {editableEmployees.length} employees shown
        </p>
      )}

      {/* ── Fixed save bar — appears when there are unsaved changes ──────── */}
      {(dirtyUids.length > 0 || saving) && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4
            px-5 py-3.5 rounded-2xl shadow-2xl"
          style={{ backgroundColor: '#0B1538', border: '1px solid #C9A961', minWidth: '340px' }}
        >
          {saving ? (
            <>
              <div className="w-4 h-4 border-2 border-gold/40 border-t-gold rounded-full animate-spin shrink-0"
                style={{ borderColor: 'rgba(201,169,97,0.3)', borderTopColor: '#C9A961' }} />
              <span className="text-sm flex-1 animate-pulse" style={{ color: '#C9A961' }}>
                Saving permissions…
              </span>
            </>
          ) : (
            <>
              {/* Change count badge */}
              <span className="text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full shrink-0"
                style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                {dirtyUids.length} change{dirtyUids.length === 1 ? '' : 's'}
              </span>

              <span className="text-xs flex-1" style={{ color: '#94A3B8' }}>
                Not yet saved
              </span>

              {/* Discard */}
              <button
                onClick={handleDiscard}
                className="flex items-center gap-1.5 text-xs transition-colors hover:text-slate-200"
                style={{ color: '#64748B' }}
              >
                <RotateCcw size={13} />
                Discard
              </button>

              <div className="w-px h-5" style={{ backgroundColor: '#1B2A4E' }} />

              {/* Save */}
              <button
                onClick={handleSave}
                className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl
                  transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
              >
                <Save size={15} />
                Save Changes
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
