/**
 * TeamPerformancePage — a director's view of their HRMS downline in CRM.
 *
 * Strictly team-scoped: the data comes from GET /api/crm/team/performance, which
 * computes the caller's downline (reportingManagerUid tree) server-side and returns
 * only their reports' aggregates. Non-managers see an empty team.
 *
 * Sections: team KPI chips · "Action needed today" (due callbacks + SLA breaches,
 * click through to the lead) · per-member performance table (target vs achieved).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Phone, AlertTriangle, RefreshCw, ArrowRight, ArrowRightLeft, UserPlus, X } from 'lucide-react';
import { doc, collection, query, where, orderBy, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { MultiSearchableSelect, SearchableSelect } from '../../../components/ui/SearchableSelect';
import { appendFieldHistory } from '../../../lib/fieldHistory';
import { writeNotification } from '../../../lib/notifications';
import type { Lead } from '../../../types';

// Compact lead-status meta — drives the per-member status chips + drill-in pills.
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  interested:     { label: 'Interested',   color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  callback:       { label: 'Callback',     color: '#C9A961', bg: 'rgba(201,169,97,0.14)' },
  new:            { label: 'New',          color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
  no_response:    { label: 'No response',  color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  not_interested: { label: 'Not interest', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  wrong_number:   { label: 'Wrong no.',    color: '#f87171', bg: 'rgba(248,113,113,0.10)' },
  converted:      { label: 'Converted',    color: '#34d399', bg: 'rgba(52,211,153,0.16)' },
};
const STATUS_ORDER = ['interested', 'callback', 'new', 'no_response', 'not_interested', 'wrong_number', 'converted'];
const daysSince = (ms: number) => (ms ? Math.max(0, Math.floor((Date.now() - ms) / 86400000)) : null);
const tsMs = (v: any): number => (v?.toMillis ? v.toMillis() : (typeof v === 'string' ? new Date(v).getTime() : 0));

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}
const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

interface MemberRow {
  uid: string; name: string; designation: string;
  leads: number; newLeads: number; openOpps: number; pipelineValue: number;
  disbursalAmount: number; commission: number; target: number; achievementPct: number;
  overdueSla: number; dueCallbacks: number;
  status: Record<string, number>;   // per-disposition counts (what each rep's customers answered)
  lastActivityMs: number;
}
interface ManagerOption { uid: string; name: string; memberCount: number; }
interface CallbackItem { leadId: string; name: string; phone: string; ownerName: string; callbackAt: string; }
interface SlaItem { leadId: string; name: string; phone: string; ownerName: string; slaDeadlineMs: number; }
interface TeamSummary {
  members: MemberRow[];
  totals: { leads: number; openOpps: number; pipelineValue: number; disbursalAmount: number; target: number; overdueSla: number; dueCallbacks: number };
  actionNeeded: { callbacks: CallbackItem[]; slaBreaches: SlaItem[] };
  period: string;
}

function achColor(pct: number): string {
  return pct >= 80 ? '#34d399' : pct >= 50 ? '#fbbf24' : '#f87171';
}

/**
 * AddTeamMembersModal — admin-only: sets selected employees' HRMS reporting
 * manager to the current user, which is what builds the team (same field the
 * org chart uses). Non-admins can't edit other user docs (rules), so they get
 * guidance instead of this modal.
 */
function AddTeamMembersModal({ managerUid, managerName, onClose, onAdded }: {
  managerUid: string; managerName: string; onClose: () => void; onAdded: () => void;
}) {
  const { employees } = useAllEmployees();
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const options = useMemo(() =>
    employees
      .filter((e) => e.employeeStatus !== 'inactive'
        && e.userId !== managerUid
        && e.reportingManagerUid !== managerUid)
      .map((e) => ({
        value: e.userId,
        label: e.displayName,
        description: [e.designation, e.department].filter(Boolean).join(' · ') || undefined,
      })),
    [employees, managerUid]);

  const handleSave = async () => {
    if (selected.length === 0) { setError('Pick at least one employee.'); return; }
    setSaving(true); setError('');
    try {
      const batch = writeBatch(db);
      for (const uid of selected) {
        batch.update(doc(db, 'users', uid), {
          reportingManagerUid: managerUid,
          reportingManagerName: managerName,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      onAdded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add members.');
    } finally { setSaving(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-md rounded-2xl overflow-visible" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Add team members</h3>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Sets their Reporting Manager to you — same as HRMS → Employees
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard) transition-colors" aria-label="Close">
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
          <MultiSearchableSelect
            options={options}
            value={selected}
            onChange={(v) => { setSelected(v); if (error) setError(''); }}
            placeholder="Select employees…"
            label="Employees"
          />
          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold border transition-opacity hover:opacity-80"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {saving ? 'Adding…' : `Add ${selected.length || ''} member${selected.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * MemberLeadsModal — drill into one team member's leads and MANUALLY reassign
 * selected ones to another team member. Nothing automatic. The manager sees each
 * lead's status/last response so the decision is informed. Writes are batched:
 * primaryOwnerId + assignedToCurrentOwnerAt + field_history + a status_change
 * activity per lead, then one aggregated notification to the new owner.
 *
 * Permission: the leads update rule allows admin OR isManagerOf(currentOwner), so a
 * manager can only move leads of his own reports; a super admin can move anyone's.
 */
function MemberLeadsModal({ source, team, actor, onClose, onDone }: {
  source: MemberRow;
  team: MemberRow[];
  actor: { uid: string; name: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetUid, setTargetUid] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'leads'),
          where('primaryOwnerId', '==', source.uid),
          where('deleted', '==', false),
          orderBy('createdAt', 'desc'),
        ));
        setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead)));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load this member’s leads.');
      } finally { setLoading(false); }
    })();
  }, [source.uid]);

  const targetOptions = useMemo(
    () => team.filter((m) => m.uid !== source.uid).map((m) => ({ value: m.uid, label: m.name, description: m.designation || undefined })),
    [team, source.uid]);
  const targetName = team.find((m) => m.uid === targetUid)?.name ?? '';

  const toggle = (id: string) => setSelected((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const allSelected = leads.length > 0 && selected.size === leads.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)));

  const handleReassign = async () => {
    if (!targetUid) { setError('Pick who to reassign to.'); return; }
    const picked = leads.filter((l) => selected.has(l.id));
    if (picked.length === 0) { setError('Select at least one customer.'); return; }
    setSaving(true); setError('');
    try {
      const CHUNK = 150;  // 3 writes/lead (update + field_history + activity) ≈ 450 ops < 500
      for (let i = 0; i < picked.length; i += CHUNK) {
        const batch = writeBatch(db);
        for (const lead of picked.slice(i, i + CHUNK)) {
          const ref = doc(db, 'leads', lead.id);
          batch.update(ref, {
            primaryOwnerId: targetUid,
            assignedToCurrentOwnerAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          appendFieldHistory(batch, ref, 'primaryOwnerId', lead.primaryOwnerId ?? null, targetUid, actor, 'team_reassign');
          batch.set(doc(collection(ref, 'activities')), {
            type: 'status_change',
            content: `Customer reassigned from ${source.name} to ${targetName} by ${actor.name}`,
            by: actor.uid, byName: actor.name, at: serverTimestamp(),
          });
        }
        await batch.commit();
      }
      // One aggregated notification to the new owner (no per-lead spam).
      writeNotification(targetUid, {
        type: 'new_lead',
        title: `${picked.length} customer${picked.length === 1 ? '' : 's'} assigned to you`,
        body: `${actor.name} moved ${picked.length} customer${picked.length === 1 ? '' : 's'} from ${source.name} to you.`,
        link: '/crm/leads',
      });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reassignment failed (you can only move your own team’s leads).');
    } finally { setSaving(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col" style={{ maxHeight: '88vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{source.name}'s customers</h3>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{leads.length} leads · select and reassign to a teammate</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard) transition-colors" aria-label="Close">
            <X size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-4 px-3.5 py-2.5 rounded-lg text-sm"
            style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#f87171' }}>
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16">
              <div className="w-5 h-5 rounded-full border-2 border-gold border-t-transparent animate-spin" />
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading customers…</span>
            </div>
          ) : leads.length === 0 ? (
            <p className="text-sm text-center py-12" style={{ color: 'var(--text-muted)' }}>No customers assigned to {source.name}.</p>
          ) : (
            <>
              <button onClick={toggleAll} className="text-xs font-semibold mb-2" style={{ color: '#C9A961' }}>
                {allSelected ? 'Clear selection' : `Select all ${leads.length}`}
              </button>
              <div className="space-y-1.5">
                {leads.map((l) => {
                  const meta = STATUS_META[l.leadStatus ?? 'new'] ?? STATUS_META.new;
                  const d = daysSince(tsMs(l.assignedToCurrentOwnerAt) || tsMs(l.createdAt));
                  const isSel = selected.has(l.id);
                  return (
                    <div key={l.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors"
                      style={{ border: `1px solid ${isSel ? 'rgba(201,169,97,0.5)' : 'var(--shell-border)'}`, backgroundColor: isSel ? 'rgba(201,169,97,0.06)' : 'transparent' }}
                      onClick={() => toggle(l.id)}>
                      <input type="checkbox" checked={isSel} onChange={() => toggle(l.id)} onClick={(e) => e.stopPropagation()} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{l.displayName}</p>
                        <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                          {l.phone}{d !== null ? ` · ${d}d with owner` : ''}{l.callbackAt ? ` · callback ${new Date(l.callbackAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
                        </p>
                      </div>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ color: meta.color, backgroundColor: meta.bg }}>{meta.label}</span>
                      <button onClick={(e) => { e.stopPropagation(); navigate(`/crm/leads/${l.id}`); }} className="shrink-0 p-1 rounded hover:bg-(--shell-hover-soft)" aria-label="Open">
                        <ArrowRight size={13} style={{ color: 'var(--text-muted)' }} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {leads.length > 0 && (
          <div className="px-5 py-4 space-y-3" style={{ borderTop: '1px solid var(--shell-border)' }}>
            <SearchableSelect
              options={targetOptions}
              value={targetUid}
              onChange={(v) => { setTargetUid(v); if (error) setError(''); }}
              placeholder="Reassign selected to…"
              label="Reassign to teammate"
            />
            <button onClick={handleReassign} disabled={saving || selected.size === 0 || !targetUid}
              className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              <ArrowRightLeft size={15} />
              {saving ? 'Reassigning…' : `Reassign ${selected.size || ''} customer${selected.size === 1 ? '' : 's'}${targetName ? ` to ${targetName}` : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function TeamPerformancePage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<TeamSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [drillMember, setDrillMember] = useState<MemberRow | null>(null);

  // Only platform admins can change other users' Reporting Manager (rules) AND
  // view any team via the picker (server honours ?managerUid only for admins).
  const isAdmin = profile?.role === 'admin';
  const canEditTeam = isAdmin;

  // Admin/super-admin: list of all managers to pick whose team to inspect.
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [viewUid, setViewUid] = useState('');   // '' = my own team

  useEffect(() => {
    if (!isAdmin || !user) return;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/crm/team/all', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) setManagers((await res.json()).managers ?? []);
      } catch { /* non-fatal — picker just stays empty */ }
    })();
  }, [isAdmin, user]);

  const load = async (p: string) => {
    if (!user) return;
    setLoading(true); setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const mgrParam = isAdmin && viewUid ? `&managerUid=${viewUid}` : '';
      const res = await fetch(`/api/crm/team/performance?period=${p}${mgrParam}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Could not load team (HTTP ${res.status})`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team performance');
    } finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(period); }, [period, user, viewUid]);

  const t = data?.totals;
  const hasTeam = (data?.members.length ?? 0) > 0;

  const Chip = ({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) => (
    <div className="glass-panel p-4" style={{ borderLeft: alert ? '3px solid #f87171' : '3px solid #C9A961' }}>
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: alert ? '#f87171' : 'var(--text-primary)' }}>{value}</p>
      {sub && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontVariationSettings: '"SOFT" 30', fontWeight: 300, color: 'var(--text-primary)' }}>
            My Team
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {isAdmin && viewUid
              ? `${managers.find((m) => m.uid === viewUid)?.name ?? 'Team'}'s reports — status, targets, and manual reassignment`
              : "Your reports' pipeline, targets, and the customers waiting on them"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Super-admin / admin: pick any team to inspect */}
          {isAdmin && managers.length > 0 && (
            <div className="min-w-52">
              <SearchableSelect
                options={[{ value: '', label: 'My team' }, ...managers.map((m) => ({ value: m.uid, label: `${m.name} (${m.memberCount})` }))]}
                value={viewUid}
                onChange={setViewUid}
                placeholder="View a team…"
              />
            </div>
          )}
          {canEditTeam && !viewUid && (
            <button onClick={() => setShowAddMembers(true)}
              className="px-3 py-2 rounded-lg text-sm font-semibold border flex items-center gap-1.5 transition-opacity hover:opacity-80"
              style={{ borderColor: 'rgba(201,169,97,0.35)', color: '#C9A961' }}>
              <UserPlus size={14} /> Add members
            </button>
          )}
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value || currentPeriod())} className="glass-inp text-sm" />
          <button onClick={() => load(period)} className="glass-panel px-3 py-2 text-sm flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20">
          <div className="w-5 h-5 rounded-full border-2 border-gold border-t-transparent animate-spin" />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading team…</span>
        </div>
      ) : error ? (
        <div className="glass-panel p-4 text-sm" style={{ color: '#f87171' }}>{error}</div>
      ) : !hasTeam ? (
        <div className="glass-panel p-10 text-center">
          <Users size={36} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No team assigned yet</p>
          <p className="text-xs mt-1 max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
            Your team is built from the HRMS reporting line — people whose <strong>Reporting Manager</strong> is you
            appear here with their leads and targets.
          </p>
          {canEditTeam ? (
            <button onClick={() => setShowAddMembers(true)}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              <UserPlus size={15} /> Add team members
            </button>
          ) : (
            <p className="text-xs mt-4 max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
              Ask HR or an admin to set your reports' Reporting Manager to you in <strong>HRMS → Employees</strong>.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* KPI chips */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Chip label="Disbursed this month" value={fmtINR(t!.disbursalAmount)} sub={t!.target > 0 ? `of ${fmtINR(t!.target)} target` : 'no target set'} />
            <Chip label="Open pipeline" value={fmtINR(t!.pipelineValue)} sub={`${t!.openOpps} open deals`} />
            <Chip label="Callbacks due now" value={String(t!.dueCallbacks)} sub="customers waiting" alert={t!.dueCallbacks > 0} />
            <Chip label="Leads past SLA" value={String(t!.overdueSla)} sub="need first contact" alert={t!.overdueSla > 0} />
          </div>

          {/* Action needed today */}
          {(data!.actionNeeded.callbacks.length > 0 || data!.actionNeeded.slaBreaches.length > 0) && (
            <div className="grid md:grid-cols-2 gap-4">
              {/* Callbacks due */}
              <div className="glass-panel p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Phone size={15} style={{ color: '#C9A961' }} />
                  <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Callbacks due ({data!.actionNeeded.callbacks.length})</h3>
                </div>
                {data!.actionNeeded.callbacks.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>None due right now 🎉</p>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {data!.actionNeeded.callbacks.slice(0, 25).map((c) => {
                      const overdue = new Date(c.callbackAt).getTime() <= Date.now();
                      return (
                        <button key={c.leadId} onClick={() => navigate(`/crm/leads/${c.leadId}`)}
                          className="w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-(--shell-hover-soft) transition-colors"
                          style={{ border: `1px solid ${overdue ? 'rgba(248,113,113,0.4)' : 'var(--shell-border)'}` }}>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
                            <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{c.phone} · {c.ownerName}</p>
                          </div>
                          <span className="text-[10px] font-semibold whitespace-nowrap" style={{ color: overdue ? '#f87171' : '#C9A961' }}>
                            {new Date(c.callbackAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <ArrowRight size={13} style={{ color: 'var(--text-muted)' }} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* SLA breaches */}
              <div className="glass-panel p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={15} style={{ color: '#f87171' }} />
                  <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Past SLA ({data!.actionNeeded.slaBreaches.length})</h3>
                </div>
                {data!.actionNeeded.slaBreaches.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No SLA breaches 🎉</p>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {data!.actionNeeded.slaBreaches.slice(0, 25).map((sLead) => (
                      <button key={sLead.leadId} onClick={() => navigate(`/crm/leads/${sLead.leadId}`)}
                        className="w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-(--shell-hover-soft) transition-colors"
                        style={{ border: '1px solid rgba(248,113,113,0.4)' }}>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{sLead.name}</p>
                          <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{sLead.phone} · {sLead.ownerName}</p>
                        </div>
                        <span className="text-[10px] font-semibold whitespace-nowrap" style={{ color: '#f87171' }}>
                          {Math.floor((Date.now() - sLead.slaDeadlineMs) / 3600000)}h late
                        </span>
                        <ArrowRight size={13} style={{ color: 'var(--text-muted)' }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Member table */}
          <div className="glass-panel p-0 overflow-hidden">
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--shell-border)' }}>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Team performance — {data!.members.length} reports</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }} className="text-[10px] uppercase tracking-wider">
                    <th className="text-left font-semibold px-4 py-2">Member</th>
                    <th className="text-left font-semibold px-3 py-2">Status of their leads</th>
                    <th className="text-right font-semibold px-3 py-2">Leads</th>
                    <th className="text-right font-semibold px-3 py-2">Pipeline</th>
                    <th className="text-right font-semibold px-3 py-2">Disbursed</th>
                    <th className="text-right font-semibold px-3 py-2">Achieved</th>
                    <th className="text-right font-semibold px-3 py-2">SLA</th>
                    <th className="text-right font-semibold px-3 py-2">Callbacks</th>
                    <th className="text-right font-semibold px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {data!.members.map((m) => {
                    const lastAct = daysSince(m.lastActivityMs);
                    return (
                    <tr key={m.uid} style={{ borderTop: '1px solid var(--shell-border)' }}>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{m.name}</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {m.designation || 'RM'}{lastAct !== null ? ` · active ${lastAct === 0 ? 'today' : `${lastAct}d ago`}` : ''}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {STATUS_ORDER.filter((s) => (m.status?.[s] ?? 0) > 0).map((s) => {
                            const meta = STATUS_META[s];
                            return (
                              <span key={s} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                style={{ color: meta.color, backgroundColor: meta.bg }}>
                                {meta.label} {m.status[s]}
                              </span>
                            );
                          })}
                          {m.leads === 0 && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>no leads</span>}
                        </div>
                      </td>
                      <td className="text-right px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{m.leads}</td>
                      <td className="text-right px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{fmtINR(m.pipelineValue)}</td>
                      <td className="text-right px-3 py-2.5 font-semibold" style={{ color: '#C9A961' }}>{fmtINR(m.disbursalAmount)}</td>
                      <td className="text-right px-3 py-2.5" title={m.target > 0 ? `of ${fmtINR(m.target)} target` : 'no target set'}>
                        {m.target > 0
                          ? <span className="font-bold" style={{ color: achColor(m.achievementPct) }}>{m.achievementPct}%</span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td className="text-right px-3 py-2.5" style={{ color: m.overdueSla > 0 ? '#f87171' : 'var(--text-muted)', fontWeight: m.overdueSla > 0 ? 700 : 400 }}>{m.overdueSla}</td>
                      <td className="text-right px-3 py-2.5" style={{ color: m.dueCallbacks > 0 ? '#C9A961' : 'var(--text-muted)', fontWeight: m.dueCallbacks > 0 ? 700 : 400 }}>{m.dueCallbacks}</td>
                      <td className="text-right px-4 py-2.5">
                        <button onClick={() => setDrillMember(m)}
                          className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1 transition-opacity hover:opacity-80 whitespace-nowrap"
                          style={{ borderColor: 'rgba(201,169,97,0.35)', color: '#C9A961' }}
                          disabled={m.leads === 0}>
                          <ArrowRightLeft size={12} /> Manage
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showAddMembers && user && (
        <AddTeamMembersModal
          managerUid={user.uid}
          managerName={profile?.displayName ?? ''}
          onClose={() => setShowAddMembers(false)}
          onAdded={() => load(period)}
        />
      )}

      {drillMember && user && data && (
        <MemberLeadsModal
          source={drillMember}
          team={data.members}
          actor={{ uid: user.uid, name: profile?.displayName ?? '' }}
          onClose={() => setDrillMember(null)}
          onDone={() => load(period)}
        />
      )}
    </div>
  );
}
