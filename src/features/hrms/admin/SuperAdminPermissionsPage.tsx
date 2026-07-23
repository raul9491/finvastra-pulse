import { useState, useMemo, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Search, Save, RotateCcw, CheckCircle2, Lock, AlertCircle, RefreshCw,
} from 'lucide-react';
import { updateDoc, doc, addDoc, collection, serverTimestamp, writeBatch } from 'firebase/firestore';
import { getIdToken } from 'firebase/auth';
import { auth, db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import type { UserProfile, CrmRole, MisAccess, ConvertorVertical } from '../../../types';
import { isSuperAdmin, SUPER_ADMIN_UIDS, SUPER_ADMIN_LABELS } from '../../../config/hrmsConfig';
import { SuperAdminPromotionSection } from './SuperAdminPromotionSection';
import { ConnectorAccountsSection } from './ConnectorAccountsSection';
import { appendFieldHistory } from '../../../lib/fieldHistory';

// Ajay is the first super admin UID — his permissions need a one-time fix
const AJAY_UID: string = SUPER_ADMIN_UIDS[0];

// ─── CRM role display labels ───────────────────────────────────────────────────
// 'viewer' kept for read-only display of legacy data; not offered as a new option
const CRM_ROLE_DISPLAY: Record<NonNullable<CrmRole>, string> = {
  admin:          'Admin',
  manager:        'Manager',
  lead_generator: 'Generator',
  lead_convertor: 'Convertor',
  viewer:         'Viewer',
};

const VERTICAL_DISPLAY: Record<NonNullable<ConvertorVertical>, string> = {
  loan:      'Loan',
  wealth:    'Wealth',
  insurance: 'Insurance',
};
const VERTICALS = ['loan', 'wealth', 'insurance'] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type PermDraft = {
  role:              'admin' | 'employee';
  hrmsAccess:        boolean;
  isHrmsManager:     boolean;
  crmAccess:         boolean;
  crmRole:           CrmRole;
  convertorVerticals: ('loan' | 'wealth' | 'insurance')[];
  misAccess:         MisAccess | null;
  commandCentreAccess: boolean;
};

type FilterKey = 'all' | 'changed' | 'admins' | 'crm' | 'mis' | 'super_admin';

function toDraft(e: UserProfile): PermDraft {
  return {
    role:              e.role === 'admin' ? 'admin' : 'employee',
    hrmsAccess:        e.hrmsAccess !== false,
    isHrmsManager:     e.isHrmsManager === true,
    crmAccess:         e.crmAccess === true,
    crmRole:           e.crmRole ?? null,
    convertorVerticals: e.convertorVerticals ?? (e.convertorVertical ? [e.convertorVertical] : []),
    misAccess:         e.misAccess ?? null,
    commandCentreAccess: e.commandCentreAccess === true,
  };
}

function isDirty(a: PermDraft, b: PermDraft): boolean {
  return a.role !== b.role
      || a.hrmsAccess !== b.hrmsAccess
      || a.isHrmsManager !== b.isHrmsManager
      || a.crmAccess !== b.crmAccess
      || a.crmRole !== b.crmRole
      || [...a.convertorVerticals].sort().join(',') !== [...b.convertorVerticals].sort().join(',')
      || a.misAccess !== b.misAccess
      || a.commandCentreAccess !== b.commandCentreAccess;
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

// Bulk re-stamp custom claims for every user (server iterates /users).
async function syncAllClaims(): Promise<{ synced: number; skipped: number; noAuth: number; total: number }> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Not signed in');
  const token = await getIdToken(currentUser);
  const res = await fetch('/api/admin/sync-all-claims', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Sync failed');
  return res.json();
}

// ─── Styled helpers ───────────────────────────────────────────────────────────
// Theme-aware: text + surface + border all come from CSS vars so the page follows
// dark/light. Gold/green/amber accents stay fixed (semantic).

const SEL = 'text-xs border rounded-lg px-2 py-1.5 outline-none text-(--text-primary) ' +
            'border-(--shell-border) bg-(--glass-panel-bg) ' +
            'focus:ring-2 focus:ring-gold/30 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

// Column header with tooltip — wraps in a <span title="…">
function ThTip({ children, tip }: { children: React.ReactNode; tip: string }) {
  return (
    <span title={tip} className="cursor-help border-b border-dashed border-(--shell-border)">
      {children}
    </span>
  );
}

// ─── Read-only super admin row ────────────────────────────────────────────────

function SuperAdminRow({ employee }: { employee: UserProfile }) {
  const initials = employee.displayName
    .split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const hierarchyLabel = SUPER_ADMIN_LABELS[employee.userId] ?? '';
  const crmRoleDisplay = employee.crmRole
    ? (CRM_ROLE_DISPLAY[employee.crmRole] ?? employee.crmRole)
    : '—';
  const _verticals = employee.convertorVerticals ?? (employee.convertorVertical ? [employee.convertorVertical] : []);
  const verticalDisplay = _verticals.length ? _verticals.map((v) => VERTICAL_DISPLAY[v]).join(', ') : null;

  return (
    <tr
      className="border-b"
      style={{ backgroundColor: 'rgba(201,169,97,0.06)', borderColor: 'rgba(201,169,97,0.18)' }}
    >
      {/* Employee */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          {employee.photoURL ? (
            <img src={employee.photoURL} alt=""
              className="w-8 h-8 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ backgroundColor: '#9A7E3F', color: '#FAFAF7' }}>
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-(--text-primary)">{employee.displayName}</p>
              <span
                className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                style={{
                  backgroundColor: 'rgba(201,169,97,0.15)',
                  border: '1px solid #C9A961',
                  color: '#C9A961',
                  letterSpacing: '0.1em',
                }}
              >
                SUPER ADMIN
              </span>
            </div>
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{hierarchyLabel}</p>
          </div>
        </div>
      </td>

      {/* Role — read-only badge */}
      <td className="px-3 py-3">
        <span className="text-xs font-semibold px-2 py-1 rounded-lg"
          style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
          {employee.role === 'admin' ? 'Admin' : 'Employee'}
        </span>
      </td>

      {/* HRMS — always accessible */}
      <td className="px-3 py-3 text-center">
        <span className="text-base" style={{ color: '#10B981' }}>✓</span>
      </td>

      {/* HR Mgr */}
      <td className="px-3 py-3 text-center">
        <span className="text-base" style={{ color: employee.isHrmsManager ? '#10B981' : 'var(--text-muted)' }}>
          {employee.isHrmsManager ? '✓' : '—'}
        </span>
      </td>

      {/* CRM On */}
      <td className="px-3 py-3 text-center">
        <span className="text-base" style={{ color: employee.crmAccess ? '#10B981' : 'var(--text-muted)' }}>
          {employee.crmAccess ? '✓' : '—'}
        </span>
      </td>

      {/* CRM Role + vertical if convertor */}
      <td className="px-3 py-3">
        <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{crmRoleDisplay}</span>
        {employee.crmRole === 'lead_convertor' && verticalDisplay && (
          <p className="text-[10px] capitalize mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {verticalDisplay}
          </p>
        )}
      </td>

      {/* MIS Access */}
      <td className="px-3 py-3">
        <span className="text-xs capitalize" style={{ color: 'var(--text-primary)' }}>
          {employee.misAccess ?? '—'}
        </span>
      </td>

      {/* Lock icon */}
      <td className="px-3 py-3 text-center">
        <Lock size={13} style={{ color: 'var(--text-muted)' }} />
      </td>
    </tr>
  );
}

// ─── Editable employee row ────────────────────────────────────────────────────

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

  const rowBg     = dirty ? 'rgba(201,169,97,0.08)' : '';
  const rowShadow = dirty ? 'inset 3px 0 0 #C9A961' : 'inset 3px 0 0 transparent';

  const isConvertor = draft.crmRole === 'lead_convertor';

  return (
    <tr
      className="border-b border-(--shell-border) transition-colors"
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
              style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-(--text-primary) truncate">{employee.displayName}</p>
            <p className="text-xs text-(--text-muted) truncate">{employee.email}</p>
          </div>
        </div>
      </td>

      {/* Role — segmented Employee | Admin */}
      <td className="px-3 py-3">
        <div className="inline-flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--shell-border)' }}>
          {(['employee', 'admin'] as const).map((r) => {
            const active = draft.role === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => onChange({ role: r })}
                className="text-xs font-semibold px-2.5 py-1.5 transition-colors"
                style={{
                  backgroundColor: active ? (r === 'admin' ? '#C9A961' : '#1B2A4E') : 'var(--glass-panel-bg)',
                  color:           active ? (r === 'admin' ? '#0B1538' : '#FAFAF7') : 'var(--text-muted)',
                }}
              >
                {r === 'admin' ? 'Admin' : 'Employee'}
              </button>
            );
          })}
        </div>
      </td>

      {/* HRMS Access */}
      <td className="px-3 py-3 text-center">
        <input
          type="checkbox"
          checked={draft.hrmsAccess}
          onChange={(e) => onChange({ hrmsAccess: e.target.checked })}
          className="w-4 h-4 rounded cursor-pointer"
          style={{ accentColor: '#C9A961' }}
        />
      </td>

      {/* HR Manager */}
      <td className="px-3 py-3 text-center">
        <input
          type="checkbox"
          checked={draft.isHrmsManager}
          onChange={(e) => onChange({ isHrmsManager: e.target.checked })}
          className="w-4 h-4 rounded cursor-pointer"
          style={{ accentColor: '#C9A961' }}
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
          <div className="w-9 h-5 bg-(--shell-hover-hard) peer-checked:bg-gold rounded-full peer-focus:ring-2
            peer-focus:ring-gold/30 transition-colors after:content-[''] after:absolute after:top-0.5
            after:left-0.5 after:w-4 after:h-4 after:bg-(--glass-panel-bg) after:rounded-full after:transition-transform
            peer-checked:after:translate-x-4" />
        </label>
        {/* Command Centre grant — admins always have it; a grantee also needs CRM access to enter the module */}
        <label className="flex items-center justify-center gap-1 mt-1.5 text-[10px] cursor-pointer"
          title="Show the cross-module Command Centre. Admins always have it. A non-admin grantee also needs CRM access (to enter the CRM module) and HR-manager (for the HR sections to populate)."
          style={{ color: 'var(--text-muted)' }}>
          <input
            type="checkbox"
            checked={draft.commandCentreAccess}
            onChange={(e) => onChange({ commandCentreAccess: e.target.checked })}
            className="w-3 h-3 rounded cursor-pointer"
            style={{ accentColor: '#C9A961' }}
          />
          ⌘ Cmd Centre
        </label>
      </td>

      {/* CRM Role + Convertor Vertical (stacked in same cell) */}
      <td className="px-3 py-3 min-w-40">
        {/* CRM Role — "Viewer" removed; only valid roles shown */}
        <select
          value={draft.crmRole ?? ''}
          disabled={!draft.crmAccess}
          onChange={(e) => {
            const role = (e.target.value || null) as CrmRole;
            // Clear verticals when moving away from Convertor
            onChange({ crmRole: role, convertorVerticals: role === 'lead_convertor' ? draft.convertorVerticals : [] });
          }}
          className={SEL}
        >
          <option value="">— none —</option>
          <option value="lead_generator">Generator</option>
          <option value="lead_convertor">Convertor</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>

        {/* Convertor verticals — multi-select ticks (one convertor can cover several) */}
        {isConvertor && (
          <div className="mt-2">
            <p className="text-[9px] font-bold uppercase tracking-wider mb-1"
              style={{ color: draft.convertorVerticals.length ? 'var(--text-muted)' : '#D97706' }}>
              Verticals {draft.convertorVerticals.length === 0 && '· ⚠ pick at least one'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {VERTICALS.map((v) => {
                const on = draft.convertorVerticals.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      const next = on
                        ? draft.convertorVerticals.filter((x) => x !== v)
                        : [...draft.convertorVerticals, v];
                      onChange({ convertorVerticals: next });
                    }}
                    className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors"
                    style={{
                      backgroundColor: on ? 'rgba(201,169,97,0.18)' : 'var(--glass-panel-bg)',
                      borderColor:     on ? '#C9A961' : 'var(--shell-border)',
                      color:           on ? '#C9A961' : 'var(--text-muted)',
                    }}
                  >
                    <span style={{ width: 9, display: 'inline-block' }}>{on ? '✓' : ''}</span>{VERTICAL_DISPLAY[v]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
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

      {/* Spacer to match SA row lock icon column */}
      <td className="px-3 py-3" />
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
  const [syncingSA,  setSyncingSA]  = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncAllMsg, setSyncAllMsg] = useState('');
  const [showSaved,  setShowSaved]  = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [search,     setSearch]     = useState('');
  const [filter,     setFilter]     = useState<FilterKey>('all');

  // ── Initialize drafts once when employees first load ─────────────────────
  useEffect(() => {
    if (initialized.current || loading || employees.length === 0) return;
    initialized.current = true;
    const map: Record<string, PermDraft> = {};
    employees
      .filter((e) => !isSuperAdmin(e.userId, e))
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

  // ── Super admin accounts (read-only rows at top of table) ─────────────────
  const superAdminEmployees = useMemo(() =>
    employees
      .filter((e) => isSuperAdmin(e.userId, e))
      .sort((a, b) =>
        (SUPER_ADMIN_UIDS as readonly string[]).indexOf(a.userId) -
        (SUPER_ADMIN_UIDS as readonly string[]).indexOf(b.userId),
      ),
    [employees],
  );

  // ── Editable employees list (non-super-admin, sorted alphabetically) ─────
  const editableEmployees = useMemo(() =>
    employees
      .filter((e) => !isSuperAdmin(e.userId, e))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [employees],
  );

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    // "Super Admin" chip: show only SA section — return empty regular rows
    if (filter === 'super_admin') return [];

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
  if (!isSuperAdmin(user?.uid ?? '', profile)) return <Navigate to="/hrms/dashboard" replace />;

  // ── Ajay permission check (after guard) ──────────────────────────────────
  // FAPL-000 needs: role=admin, crmAccess=true, crmRole=admin, misAccess=admin
  const ajayProfile  = superAdminEmployees.find((e) => e.userId === AJAY_UID);
  const ajayNeedsFix = !loading && ajayProfile != null && (
    ajayProfile.crmRole !== 'admin' ||
    ajayProfile.crmAccess !== true  ||
    ajayProfile.misAccess !== 'admin' ||
    ajayProfile.role !== 'admin'
  );

  // ── Handlers ──────────────────────────────────────────────────────────────

  const updateDraft = (uid: string, changes: Partial<PermDraft>) => {
    setDrafts((prev) => {
      const curr = prev[uid];
      if (!curr) return prev;
      const updated = { ...curr, ...changes };
      // Auto-clear role + vertical when CRM access is revoked
      if (changes.crmAccess === false) {
        updated.crmRole            = null;
        updated.convertorVerticals = [];
      }
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
        const before = originals[uid];
        const patch = {
          role:              draft.role,
          hrmsAccess:        draft.hrmsAccess,
          isHrmsManager:     draft.isHrmsManager,
          crmAccess:         draft.crmAccess,
          crmRole:            draft.crmAccess ? draft.crmRole : null,
          // Multi-vertical for Convertors; null for everyone else (legacy single deprecated → cleared)
          convertorVerticals: draft.crmRole === 'lead_convertor' ? draft.convertorVerticals : null,
          convertorVertical:  null,
          misAccess:          draft.misAccess,
          commandCentreAccess: draft.commandCentreAccess,
        };
        // Phase P — user-doc update + field_history diffs (crmRole/misAccess)
        // in the SAME batch.
        {
          const userRef = doc(db, 'users', uid);
          const batch = writeBatch(db);
          batch.update(userRef, patch);
          const actor = { uid: user!.uid, name: profile?.displayName ?? '' };
          appendFieldHistory(batch, userRef, 'crmRole', before?.crmRole ?? null, patch.crmRole, actor, 'permission_manager');
          appendFieldHistory(batch, userRef, 'misAccess', before?.misAccess ?? null, patch.misAccess, actor, 'permission_manager');
          await batch.commit();
        }
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

  // Fix Ajay's missing CRM/MIS permissions (one-time correction, idempotent)
  const handleSyncAjayPerms = async () => {
    setSyncingSA(true);
    try {
      const patch = {
        role:      'admin'  as const,
        crmAccess: true,
        crmRole:   'admin'  as CrmRole,
        misAccess: 'admin'  as MisAccess,
      };
      await updateDoc(doc(db, 'users', AJAY_UID), patch);
      await addDoc(collection(db, 'audit_logs'), {
        actor:      user!.uid,
        action:     'super_admin_perm_fix',
        targetPath: `/users/${AJAY_UID}`,
        patch,
        at:         serverTimestamp(),
      });
      await syncClaims(AJAY_UID);
      // useAllEmployees is onSnapshot — the row will auto-update and
      // ajayNeedsFix will become false without any extra state
    } catch (e) {
      console.error('[sync-ajay-perms]', e);
    } finally {
      setSyncingSA(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const thCls = 'px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-left whitespace-nowrap text-(--text-muted)';

  const filterChips: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all',         label: 'All',          count: editableEmployees.length },
    { key: 'super_admin', label: 'Super Admins',  count: superAdminEmployees.length },
    { key: 'changed',     label: 'Changed',       count: dirtyUids.length },
    { key: 'admins',      label: 'Admins',        count: Object.values(drafts).filter((d) => d.role === 'admin').length },
    { key: 'crm',         label: 'Has CRM',       count: Object.values(drafts).filter((d) => d.crmAccess).length },
    { key: 'mis',         label: 'Has MIS',       count: Object.values(drafts).filter((d) => d.misAccess != null).length },
  ];

  // Whether to show regular employee rows (hidden on SA filter)
  const showRegularRows = filter !== 'super_admin';

  return (
    <div className="pb-32">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Lock size={18} style={{ color: '#C9A961' }} />
            <h2 className="text-3xl text-(--text-primary)"
              style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300 }}>
              Permission Manager
            </h2>
          </div>
          <p className="text-sm text-(--text-muted)">
            {loading
              ? 'Loading…'
              : `${editableEmployees.length} employees · edit freely, then save once`}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {/* Super Admin badge */}
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mt-1"
            style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
            ★ Super Admin Only
          </span>
          {/* Re-sync all custom claims — restamps every user's token claims from their profile */}
          <button
            onClick={async () => {
              if (!window.confirm('Re-stamp Firebase custom claims for every user from their current profile? This lowers Firestore read usage (rules read claims first). Safe to run anytime.')) return;
              setSyncingAll(true); setSyncAllMsg('');
              try {
                const r = await syncAllClaims();
                setSyncAllMsg(`✓ Synced ${r.synced} of ${r.total}${r.noAuth ? ` · ${r.noAuth} have no login yet` : ''}${r.skipped ? ` · ${r.skipped} skipped` : ''}. Users get the new claims on their next sign-in / token refresh.`);
              } catch (e) {
                setSyncAllMsg(`✗ ${e instanceof Error ? e.message : 'Sync failed'}`);
              } finally {
                setSyncingAll(false);
              }
            }}
            disabled={syncingAll}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-(--shell-border) disabled:opacity-50"
            style={{ color: 'var(--text-muted)' }}>
            <RefreshCw size={13} className={syncingAll ? 'animate-spin' : ''} />
            {syncingAll ? 'Syncing…' : 'Re-sync all claims'}
          </button>
        </div>
      </div>

      {syncAllMsg && (
        <div className="mb-5 px-4 py-3 rounded-xl text-sm"
          style={{ backgroundColor: syncAllMsg.startsWith('✓') ? 'rgba(16,185,129,0.12)' : 'rgba(220,38,38,0.10)',
                   color: syncAllMsg.startsWith('✓') ? '#10B981' : '#DC2626',
                   border: `1px solid ${syncAllMsg.startsWith('✓') ? 'rgba(16,185,129,0.35)' : 'rgba(220,38,38,0.3)'}` }}>
          {syncAllMsg}
        </div>
      )}

      {/* ── Saved confirmation banner ─────────────────────────────────────── */}
      {showSaved && (
        <div className="mb-5 flex items-center gap-3 px-5 py-4 rounded-2xl"
          style={{ backgroundColor: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.4)' }}>
          <CheckCircle2 size={18} style={{ color: '#10B981' }} className="shrink-0" />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#10B981' }}>
              Permissions saved — {savedCount} employee{savedCount === 1 ? '' : 's'} updated
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Auth tokens refreshed · Changes take effect on next sign-in
            </p>
          </div>
        </div>
      )}

      {/* ── Legend / column guide ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4 text-xs text-(--text-muted)">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border-l-2 inline-block"
            style={{ borderColor: '#C9A961', backgroundColor: 'rgba(201,169,97,0.1)' }} />
          Row highlighted = unsaved change
        </span>
        <span>HRMS = can access HR module</span>
        <span>HR Mgr = leave approvals + admin attendance</span>
        <span>CRM On = enable CRM module access</span>
      </div>

      {/* ── Filter chips + search ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-muted) pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="text-sm border rounded-lg pl-9 pr-4 py-2 outline-none w-52
              text-(--text-primary) border-(--shell-border) bg-(--glass-panel-bg)
              placeholder:text-(--text-muted) focus:ring-2 focus:ring-gold/30"
          />
        </div>
        {filterChips.map(({ key, label, count }) => {
          const active = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className="text-xs px-3 py-1.5 rounded-full font-semibold transition-colors border"
              style={{
                backgroundColor: active ? (key === 'super_admin' ? '#9A7E3F' : '#C9A961') : 'var(--glass-panel-bg)',
                color:       active ? '#0B1538' : 'var(--text-muted)',
                borderColor: active ? 'transparent' : 'var(--shell-border)',
              }}
            >
              {key === 'super_admin' && active && '★ '}
              {label}
              <span className="ml-1.5 opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {/* ── Permissions table ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border overflow-hidden bg-(--glass-panel-bg) border-(--shell-border)">
        {loading ? (
          <div className="animate-pulse divide-y divide-(--shell-border)">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-14" style={{ backgroundColor: 'var(--glass-panel-bg)' }} />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ backgroundColor: 'var(--glass-panel-bg)', borderBottom: '1px solid var(--shell-border)' }}>
                  <th className={`${thCls} pl-4 w-64`}>Employee</th>
                  <th className={thCls}>Role</th>
                  <th className={`${thCls} text-center`}>
                    <ThTip tip="Can access the HR module">HRMS</ThTip>
                  </th>
                  <th className={`${thCls} text-center`}>
                    <ThTip tip="Can approve leave requests and manage attendance">HR Mgr</ThTip>
                  </th>
                  <th className={`${thCls} text-center`}>
                    <ThTip tip="Can use the CRM module">CRM On</ThTip>
                  </th>
                  <th className={thCls}>
                    <ThTip tip="Their role within CRM — Generator, Convertor, Manager, or Admin">CRM Role</ThTip>
                  </th>
                  <th className={thCls}>
                    <ThTip tip="Can view or administer commission reconciliation data">MIS Access</ThTip>
                  </th>
                  <th className={`${thCls} w-8`} />
                </tr>
              </thead>
              <tbody>
                {/* ── Super admin accounts — always shown, always locked ── */}
                {superAdminEmployees.length > 0 && (
                  <>
                    {/* Super admin section header */}
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-2"
                        style={{
                          backgroundColor: 'rgba(201,169,97,0.10)',
                          borderBottom: '1px solid rgba(201,169,97,0.2)',
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-widest"
                            style={{ color: '#C9A961' }}>
                            ★ Super Admin Accounts — Protected · Read Only
                          </span>
                          {/* Ajay fix button — shown only if his permissions are incorrect */}
                          {ajayNeedsFix && (
                            <button
                              onClick={handleSyncAjayPerms}
                              disabled={syncingSA}
                              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg
                                transition-colors disabled:opacity-50"
                              style={{
                                backgroundColor: 'rgba(217,119,6,0.15)',
                                color: '#D97706',
                                border: '1px solid rgba(217,119,6,0.4)',
                              }}
                            >
                              <AlertCircle size={11} />
                              {syncingSA ? 'Fixing…' : "Fix Ajay's Permissions"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* One read-only row per super admin */}
                    {superAdminEmployees.map((emp) => (
                      <SuperAdminRow key={emp.userId} employee={emp} />
                    ))}

                    {/* Divider before regular employees (hidden on SA filter) */}
                    {showRegularRows && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-1.5"
                          style={{ backgroundColor: 'var(--glass-panel-bg)', borderBottom: '1px solid var(--shell-border)' }}
                        >
                          <span className="text-[10px] font-bold uppercase tracking-widest"
                            style={{ color: 'var(--text-muted)' }}>
                            All Employees
                          </span>
                        </td>
                      </tr>
                    )}
                  </>
                )}

                {/* ── Regular editable rows (hidden when SA filter active) ── */}
                {showRegularRows && (
                  filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-16 text-center text-sm text-(--text-muted)">
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
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Count footer ─────────────────────────────────────────────────── */}
      {!loading && showRegularRows && filteredRows.length > 0 && (
        <p className="text-xs text-(--text-muted) mt-3 text-right">
          {filteredRows.length} of {editableEmployees.length} employees shown
        </p>
      )}

      {/* ── Partner (connector) logins — external channel partners ────────── */}
      <ConnectorAccountsSection employees={employees} />

      {/* ── Phase P: Super Admin promotion / demotion + audit log ─────────── */}
      <SuperAdminPromotionSection
        employees={employees}
        actorUid={user?.uid ?? ''}
        actorName={profile?.displayName ?? ''}
      />

      {/* ── Fixed save bar — appears when there are unsaved changes ──────── */}
      {(dirtyUids.length > 0 || saving) && (
        <div
          className="fixed bottom-6 left-[calc(50%+7.5rem)] -translate-x-1/2 z-50 flex items-center gap-4
            px-5 py-3.5 rounded-2xl shadow-2xl"
          style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid #C9A961', minWidth: '340px' }}
        >
          {saving ? (
            <>
              <div className="w-4 h-4 border-2 rounded-full animate-spin shrink-0"
                style={{ borderColor: 'rgba(201,169,97,0.3)', borderTopColor: '#C9A961' }} />
              <span className="text-sm flex-1 animate-pulse" style={{ color: '#C9A961' }}>
                Saving permissions…
              </span>
            </>
          ) : (
            <>
              <span className="text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full shrink-0"
                style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                {dirtyUids.length} change{dirtyUids.length === 1 ? '' : 's'}
              </span>

              <span className="text-xs flex-1" style={{ color: 'var(--text-muted)' }}>
                Not yet saved
              </span>

              <button
                onClick={handleDiscard}
                className="flex items-center gap-1.5 text-xs transition-colors hover:text-(--text-primary)"
                style={{ color: 'var(--text-muted)' }}
              >
                <RotateCcw size={13} />
                Discard
              </button>

              <div className="w-px h-5" style={{ backgroundColor: 'var(--shell-border)' }} />

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
