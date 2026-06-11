import { useEffect, useMemo, useState } from 'react';
import { Share2, X, Trash2 } from 'lucide-react';
import {
  collection, query, where, onSnapshot, doc, writeBatch,
  arrayUnion, arrayRemove, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../features/auth/AuthContext';
import { useAllEmployees } from '../../lib/hooks/useProfile';
import { isSuperAdmin } from '../../config/hrmsConfig';
import { SHAREABLE_PAGES, pageIcon, type PageKey } from '../../config/shareablePages';
import { SearchableSelect } from './SearchableSelect';
import { writeNotification } from '../../lib/notifications';
import { useToast } from './Toast';
import type { PageShare } from '../../types';

// ─── Share / revoke mutations (batched with sharedModules maintenance) ────────

async function createShare(
  pageKey: PageKey,
  target: { uid: string; name: string; email: string },
  actor: { uid: string; name: string },
  note: string,
): Promise<void> {
  const page = SHAREABLE_PAGES[pageKey];
  const batch = writeBatch(db);
  const shareRef = doc(collection(db, 'page_shares'));
  batch.set(shareRef, {
    grantedTo:      target.uid,
    grantedToName:  target.name,
    grantedToEmail: target.email,
    grantedBy:      actor.uid,
    grantedByName:  actor.name,
    pageKey,
    pageTitle:      page.title,
    pageRoute:      page.route,
    module:         page.module,
    icon:           page.icon,
    active:         true,
    grantedAt:      serverTimestamp(),
    revokedAt:      null,
    revokedBy:      null,
    revokedByName:  null,
    note:           note.trim() || null,
  });
  // Same batch: grant module-level data access (see rules sharedModules note).
  batch.update(doc(db, 'users', target.uid), { sharedModules: arrayUnion(page.module) });
  await batch.commit();

  writeNotification(target.uid, {
    type:  'share_granted',
    title: `${actor.name} shared ${page.title} with you`,
    body:  note.trim() || `You now have access to ${page.title}.`,
    link:  page.route,
  }).catch(() => {});
}

export async function revokeShare(
  share: PageShare,
  actor: { uid: string; name: string },
): Promise<void> {
  // Does the user hold any OTHER active share in this module? If not, the
  // module flag comes off — in the same batch as the revoke.
  const others = await getDocs(query(
    collection(db, 'page_shares'),
    where('grantedTo', '==', share.grantedTo),
    where('active', '==', true),
    where('module', '==', share.module),
  ));
  const hasOther = others.docs.some((d) => d.id !== share.id);

  const batch = writeBatch(db);
  batch.update(doc(db, 'page_shares', share.id), {
    active:        false,
    revokedAt:     serverTimestamp(),
    revokedBy:     actor.uid,
    revokedByName: actor.name,
  });
  if (!hasOther) {
    batch.update(doc(db, 'users', share.grantedTo), { sharedModules: arrayRemove(share.module) });
  }
  await batch.commit();

  writeNotification(share.grantedTo, {
    type:  'share_revoked',
    title: `Your access to ${share.pageTitle} has been removed`,
    body:  `Shared access revoked by ${actor.name}.`,
  }).catch(() => {});
}

// ─── Modal ─────────────────────────────────────────────────────────────────────

function SharePageModal({ pageKey, onClose }: { pageKey: PageKey; onClose: () => void }) {
  const { user, profile } = useAuth();
  const { employees } = useAllEmployees();
  const toast = useToast();
  const page = SHAREABLE_PAGES[pageKey];
  const Icon = pageIcon(pageKey);

  const [activeShares, setActiveShares] = useState<PageShare[]>([]);
  const [selectedUid, setSelectedUid] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<PageShare | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'page_shares'),
      where('pageKey', '==', pageKey),
      where('active', '==', true),
    );
    return onSnapshot(q, (snap) => {
      setActiveShares(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PageShare));
    }, () => setActiveShares([]));
  }, [pageKey]);

  const sharedUids = useMemo(() => new Set(activeShares.map((s) => s.grantedTo)), [activeShares]);

  const candidates = useMemo(
    () => employees.filter((e) =>
      (e.employeeStatus ?? 'active') === 'active' &&
      !isSuperAdmin(e.userId, e) &&
      !sharedUids.has(e.userId)),
    [employees, sharedUids],
  );

  const actor = { uid: user?.uid ?? '', name: profile?.displayName ?? '' };

  async function handleShare() {
    const target = candidates.find((e) => e.userId === selectedUid);
    if (!target) return;
    setBusy(true);
    try {
      await createShare(pageKey, { uid: target.userId, name: target.displayName, email: target.email }, actor, note);
      toast.success(`${page.title} shared with ${target.displayName}`);
      setSelectedUid(''); setNote('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Share failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(share: PageShare) {
    setBusy(true);
    try {
      await revokeShare(share, actor);
      toast.success(`Access revoked for ${share.grantedToName}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setBusy(false);
      setConfirmRevoke(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-md flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="glass-modal-header flex items-center justify-between px-6 py-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
              <Icon size={17} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                Share {page.title}
              </h3>
              <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{page.description}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-mid)" style={{ color: 'var(--text-muted)' }}>
            <X size={17} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          {/* Currently shared with */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
              Currently shared with
            </p>
            {activeShares.length === 0 ? (
              <p className="text-sm py-2" style={{ color: 'var(--text-dim)' }}>Not shared with anyone yet.</p>
            ) : (
              <div className="space-y-2">
                {activeShares.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-(--shell-border)">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                      style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
                      {s.grantedToName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{s.grantedToName}</p>
                      <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{s.grantedToEmail}</p>
                    </div>
                    {confirmRevoke?.id === s.id ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => handleRevoke(s)} disabled={busy}
                          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                          style={{ backgroundColor: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.30)' }}>
                          {busy ? '…' : 'Confirm'}
                        </button>
                        <button onClick={() => setConfirmRevoke(null)}
                          className="text-[11px] px-2 py-1.5 rounded-lg border border-(--shell-border)" style={{ color: 'var(--text-muted)' }}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmRevoke(s)} title="Revoke access"
                        className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg shrink-0"
                        style={{ color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}>
                        <Trash2 size={11} /> Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Share with someone */}
          <div className="space-y-3 pt-1" style={{ borderTop: '1px solid var(--shell-border)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest pt-3" style={{ color: 'var(--text-muted)' }}>
              Share with someone
            </p>
            <SearchableSelect
              options={candidates.map((e) => ({
                value: e.userId,
                label: e.displayName,
                description: e.email,
              }))}
              value={selectedUid}
              onChange={setSelectedUid}
              placeholder="Select an employee…"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional) — e.g. 'For the FY26 audit'"
              className="glass-inp w-full text-sm"
            />
            <button onClick={handleShare} disabled={!selectedUid || busy}
              className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 transition-opacity"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              {busy ? 'Sharing…' : 'Share Access'}
            </button>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
              Sharing is permanent until revoked. The person sees only this page in their navigation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Button (shell headers; renders only for super admins on shareable pages) ──

export function SharePageButton({ pageKey }: { pageKey: PageKey | null }) {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);

  if (!pageKey || !user || !isSuperAdmin(user.uid, profile)) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Share ${SHAREABLE_PAGES[pageKey].title}`}
        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
        style={{ color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' }}
      >
        <Share2 size={13} />
        <span className="hidden sm:inline">Share</span>
      </button>
      {open && <SharePageModal pageKey={pageKey} onClose={() => setOpen(false)} />}
    </>
  );
}
