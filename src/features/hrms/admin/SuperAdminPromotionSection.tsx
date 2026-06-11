import { useEffect, useMemo, useState } from 'react';
import { Crown, ShieldAlert, Copy, Check, UserMinus2 } from 'lucide-react';
import {
  collection, onSnapshot, orderBy, query, doc, updateDoc, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { getIdToken } from 'firebase/auth';
import { format } from 'date-fns';
import { auth, db } from '../../../lib/firebase';
import { isSuperAdmin, SUPER_ADMIN_UIDS } from '../../../config/hrmsConfig';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { buildHrEmailHtml, sendHrEmailNotification } from '../../../lib/notifications';
import { useToast } from '../../../components/ui/Toast';
import type { UserProfile, SuperAdminLogEntry } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function callSyncClaims(uid: string): Promise<void> {
  const u = auth.currentUser;
  if (!u) return;
  const token = await getIdToken(u);
  await fetch(`/api/admin/users/${uid}/sync-claims`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

function buildCommands(allSaUids: string[], targetUid: string, action: 'promote' | 'demote') {
  const gcloud = `gcloud run services update pulse-api --update-env-vars SUPER_ADMIN_UIDS=${allSaUids.join(',')} --region asia-south1`;
  const rules = action === 'promote'
    ? `Manually ADD '${targetUid}' to BOTH isSuperAdminUid() and isSuperAdminTarget(userId) lists in firestore.rules, then run: firebase deploy --only firestore:rules`
    : `Manually REMOVE '${targetUid}' from BOTH isSuperAdminUid() and isSuperAdminTarget(userId) lists in firestore.rules (if present), then run: firebase deploy --only firestore:rules`;
  return { gcloud, rules };
}

/** Email every current super admin about a promotion/demotion. Fire-and-forget. */
function notifyAllSuperAdmins(
  saUids: string[],
  action: 'promote' | 'demote',
  targetName: string,
  actorName: string,
) {
  const subject = action === 'promote'
    ? `${targetName} has been promoted to Super Admin`
    : `${targetName} is no longer a Super Admin`;
  const html = buildHrEmailHtml({
    title: subject,
    lines: [
      { label: 'Action',    value: action === 'promote' ? 'Promotion' : 'Demotion' },
      { label: 'Employee',  value: targetName },
      { label: 'Performed by', value: actorName },
      { label: 'When',      value: format(new Date(), 'dd MMM yyyy, HH:mm') },
    ],
    note: 'Reminder: Firestore rules and the Cloud Run SUPER_ADMIN_UIDS env var must be updated manually for rules-level super-admin powers to apply. The exact commands were shown on screen.',
  });
  for (const uid of saUids) {
    sendHrEmailNotification({ employeeId: uid, subject, htmlBody: html }).catch(() => {});
  }
}

// ─── Post-action commands panel ───────────────────────────────────────────────

function CommandsPanel({ cmds, onDismiss }: {
  cmds: { gcloud: string; rules: string };
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const fullText = `${cmds.gcloud}\n\n${cmds.rules}`;

  async function copy() {
    try { await navigator.clipboard.writeText(fullText); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard unavailable — text is visible to copy manually */ }
  }

  return (
    <div className="rounded-2xl p-5 space-y-3"
      style={{ backgroundColor: 'rgba(201,169,97,0.08)', border: '1px solid rgba(201,169,97,0.35)' }}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold flex items-center gap-2" style={{ color: '#C9A961' }}>
          <ShieldAlert size={15} /> Manual steps required (run these to complete the change)
        </p>
        <div className="flex items-center gap-2">
          <button onClick={copy}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' }}>
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy all'}
          </button>
          <button onClick={onDismiss} className="text-xs px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>Dismiss</button>
        </div>
      </div>
      <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-all rounded-lg p-3"
        style={{ backgroundColor: 'rgba(0,0,0,0.25)', color: 'var(--text-primary)' }}>
        {cmds.gcloud}
      </pre>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{cmds.rules}</p>
      <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
        Until these run, the new status works in the app UI but NOT in Firestore rules
        (sharing, super-admin protection) or server endpoints.
      </p>
    </div>
  );
}

// ─── Promote / Demote modal ───────────────────────────────────────────────────

function PromotionModal({ mode, employees, actor, onDone, onClose }: {
  mode: 'promote' | 'demote';
  employees: UserProfile[];
  actor: { uid: string; name: string };
  onDone: (cmds: { gcloud: string; rules: string }) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [selectedUid, setSelectedUid] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => (
    mode === 'promote'
      ? employees.filter((e) => (e.employeeStatus ?? 'active') === 'active' && !isSuperAdmin(e.userId, e))
      // Demote: only doc-flag SAs (the 3 hardcoded are permanent) and never yourself
      : employees.filter((e) => e.superAdmin === true &&
          !(SUPER_ADMIN_UIDS as readonly string[]).includes(e.userId) &&
          e.userId !== actor.uid)
  ), [mode, employees, actor.uid]);

  const target = candidates.find((e) => e.userId === selectedUid) ?? null;
  const nameMatches = !!target && confirmText.trim() === target.displayName;

  async function handleConfirm() {
    if (!target || !nameMatches) return;
    setBusy(true);
    try {
      // 1. Flip the doc flag
      await updateDoc(doc(db, 'users', target.userId), { superAdmin: mode === 'promote' });
      // 2. Refresh the target's claims
      await callSyncClaims(target.userId);
      // 3. Append-only log
      await addDoc(collection(db, 'super_admin_log'), {
        promotedUid:    target.userId,
        promotedName:   target.displayName,
        promotedBy:     actor.uid,
        promotedByName: actor.name,
        action:         mode,
        reason:         reason.trim() || null,
        promotedAt:     serverTimestamp(),
      });
      // 4. Email all current SAs (hardcoded + doc-flagged, post-action)
      const docFlagged = employees.filter((e) => e.superAdmin === true).map((e) => e.userId);
      const postSet = new Set<string>([...SUPER_ADMIN_UIDS, ...docFlagged]);
      if (mode === 'promote') postSet.add(target.userId); else postSet.delete(target.userId);
      notifyAllSuperAdmins([...postSet], mode, target.displayName, actor.name);
      // 5. Print + copy commands
      onDone(buildCommands([...postSet], target.userId, mode));
      toast.success(mode === 'promote'
        ? `${target.displayName} promoted to Super Admin`
        : `${target.displayName} demoted`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          {mode === 'promote' ? <Crown size={18} style={{ color: '#C9A961' }} /> : <UserMinus2 size={18} style={{ color: '#f87171' }} />}
          {mode === 'promote' ? 'Promote to Super Admin' : 'Demote Super Admin'}
        </h3>

        <div className="rounded-xl p-3.5 text-xs leading-relaxed"
          style={{ backgroundColor: 'rgba(201,169,97,0.08)', border: '1px solid rgba(201,169,97,0.35)', color: 'var(--text-muted)' }}>
          {mode === 'promote' ? (
            <>A super admin can manage every permission, share any page, and promote/demote others.
            This change is fully audited and all current super admins are notified by email.
            Rules + server recognition additionally need the printed manual commands.</>
          ) : (
            <>Demotion removes app-level super-admin powers immediately. The printed manual
            commands must also run to update rules and the server. The three founding super
            admins cannot be demoted, and you cannot demote yourself.</>
          )}
        </div>

        <SearchableSelect
          options={candidates.map((e) => ({ value: e.userId, label: e.displayName, description: e.email }))}
          value={selectedUid}
          onChange={(v) => { setSelectedUid(v); setConfirmText(''); }}
          placeholder={candidates.length ? 'Select employee…' : 'No eligible employees'}
        />

        {target && (
          <>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional — recorded in the audit log)"
              className="glass-inp w-full text-sm"
            />
            <div>
              <p className="text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Type <strong style={{ color: 'var(--text-primary)' }}>{target.displayName}</strong> to confirm:
              </p>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={target.displayName}
                className="glass-inp w-full text-sm"
              />
            </div>
          </>
        )}

        <div className="flex gap-3 justify-end pt-1">
          <button onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg border border-(--shell-border)" style={{ color: 'var(--text-primary)' }}>
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={!nameMatches || busy}
            className="text-sm font-semibold px-5 py-2 rounded-lg disabled:opacity-40"
            style={mode === 'promote'
              ? { backgroundColor: '#C9A961', color: '#0B1538' }
              : { backgroundColor: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.30)' }}>
            {busy ? 'Working…' : mode === 'promote' ? 'Promote' : 'Demote'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Section (rendered at the bottom of SuperAdminPermissionsPage) ────────────

export function SuperAdminPromotionSection({ employees, actorUid, actorName }: {
  employees: UserProfile[];
  actorUid: string;
  actorName: string;
}) {
  const [modal, setModal] = useState<'promote' | 'demote' | null>(null);
  const [cmds, setCmds] = useState<{ gcloud: string; rules: string } | null>(null);
  const [log, setLog] = useState<SuperAdminLogEntry[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'super_admin_log'), orderBy('promotedAt', 'desc'));
    return onSnapshot(q,
      (snap) => setLog(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SuperAdminLogEntry)),
      () => setLog([]));
  }, []);

  const actor = { uid: actorUid, name: actorName };
  const hasDemotable = employees.some((e) =>
    e.superAdmin === true && !(SUPER_ADMIN_UIDS as readonly string[]).includes(e.userId) && e.userId !== actorUid);

  return (
    <div className="mt-10 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Crown size={16} style={{ color: '#C9A961' }} /> Super Admin Management
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Promotions are audited, all super admins are emailed, and the required manual
            rules/server commands are printed after each change.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setModal('promote')}
            className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            <Crown size={13} /> Promote to Super Admin
          </button>
          {hasDemotable && (
            <button onClick={() => setModal('demote')}
              className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg"
              style={{ color: '#f87171', border: '1px solid rgba(248,113,113,0.30)' }}>
              <UserMinus2 size={13} /> Demote
            </button>
          )}
        </div>
      </div>

      {cmds && <CommandsPanel cmds={cmds} onDismiss={() => setCmds(null)} />}

      {/* Log table */}
      {log.length > 0 && (
        <div className="glass-panel overflow-x-auto">
          <table className="w-full glass-table">
            <thead>
              <tr>
                {['Action', 'Employee', 'By', 'Reason', 'When'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5">
                    <span className={l.action === 'promote' ? 'badge-glass-warning' : 'badge-glass-danger'}>
                      {l.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sm" style={{ color: 'var(--text-primary)' }}>{l.promotedName}</td>
                  <td className="px-4 py-2.5 text-sm" style={{ color: 'var(--text-muted)' }}>{l.promotedByName}</td>
                  <td className="px-4 py-2.5 text-sm max-w-50 truncate" style={{ color: 'var(--text-muted)' }}>{l.reason ?? '—'}</td>
                  <td className="px-4 py-2.5 text-sm whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                    {l.promotedAt?.toDate ? format(l.promotedAt.toDate(), 'dd MMM yyyy, HH:mm') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <PromotionModal
          mode={modal}
          employees={employees}
          actor={actor}
          onDone={setCmds}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
