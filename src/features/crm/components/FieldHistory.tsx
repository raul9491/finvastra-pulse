import { useEffect, useRef, useState } from 'react';
import { History, X } from 'lucide-react';
import {
  collection, query, orderBy, limit, onSnapshot, type DocumentReference,
} from 'firebase/firestore';
import { doc as fsDoc } from 'firebase/firestore';
import { format, formatDistanceToNow } from 'date-fns';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { isSuperAdmin } from '../../../config/hrmsConfig';
import type { FieldChange } from '../../../types';

function fmtVal(v: unknown): string {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'number') return v.toLocaleString('en-IN');
  return String(v);
}

function useFieldChanges(parentPath: string[], field: string, max: number, enabled: boolean) {
  const [changes, setChanges] = useState<FieldChange[]>([]);
  useEffect(() => {
    if (!enabled) { setChanges([]); return; }
    const parentRef: DocumentReference = fsDoc(db, parentPath.join('/'));
    const q = query(
      collection(parentRef, 'field_history', field, 'changes'),
      orderBy('changedAt', 'desc'),
      limit(max),
    );
    return onSnapshot(q,
      (snap) => setChanges(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FieldChange)),
      () => setChanges([]));
  }, [parentPath.join('/'), field, max, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return changes;
}

/**
 * Phase P — small history icon next to a field label (admin/manager only).
 * Popover shows the last 5 changes; "View full history" opens a modal with all.
 *
 * parentPath: path segments of the PARENT doc, e.g. ['leads', leadId] or
 * ['leads', leadId, 'opportunities', oppId].
 */
export function FieldHistory({ parentPath, field, label }: {
  parentPath: string[];
  field: string;
  label?: string;
}) {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  const canSee = profile?.role === 'admin' || profile?.crmRole === 'manager' ||
    (user ? isSuperAdmin(user.uid, profile) : false);

  const recent = useFieldChanges(parentPath, field, 5, canSee && open);
  const all = useFieldChanges(parentPath, field, 200, canSee && full);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (!canSee) return null;

  const row = (c: FieldChange) => (
    <div key={c.id} className="text-xs py-1.5" style={{ borderBottom: '1px solid var(--shell-border)' }}>
      <p style={{ color: 'var(--text-primary)' }}>
        <span style={{ color: 'var(--text-muted)' }}>{fmtVal(c.oldValue)}</span>
        <span style={{ color: 'var(--text-dim)' }}> → </span>
        <span className="font-semibold">{fmtVal(c.newValue)}</span>
      </p>
      <p className="mt-0.5" style={{ color: 'var(--text-dim)' }}>
        by {c.changedByName || c.changedBy.slice(0, 6)} ·{' '}
        {c.changedAt?.toDate ? formatDistanceToNow(c.changedAt.toDate(), { addSuffix: true }) : 'just now'}
        {c.context ? ` · ${c.context}` : ''}
      </p>
    </div>
  );

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={`Change history — ${label ?? field}`}
        className="p-0.5 rounded hover:bg-(--shell-hover-mid) align-middle"
        style={{ color: 'var(--text-dim)' }}
      >
        <History size={12} />
      </button>

      {open && (
        <div className="absolute z-40 top-6 left-0 w-72 rounded-xl p-3 shadow-xl glass-modal-panel">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
            {label ?? field} — last changes
          </p>
          {recent.length === 0
            ? <p className="text-xs py-2" style={{ color: 'var(--text-dim)' }}>No recorded changes yet.</p>
            : recent.map(row)}
          {recent.length >= 5 && (
            <button onClick={() => { setFull(true); setOpen(false); }}
              className="text-[11px] font-semibold mt-2" style={{ color: '#C9A961' }}>
              View full history →
            </button>
          )}
        </div>
      )}

      {full && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 glass-modal-overlay" onClick={() => setFull(false)}>
          <div className="glass-modal-panel w-full max-w-md flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <div className="glass-modal-header flex items-center justify-between px-5 py-3.5 shrink-0">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Full history — {label ?? field}
              </h3>
              <button onClick={() => setFull(false)} style={{ color: 'var(--text-muted)' }}><X size={16} /></button>
            </div>
            <div className="px-5 py-3 overflow-y-auto">
              {all.length === 0
                ? <p className="text-xs py-3" style={{ color: 'var(--text-dim)' }}>No recorded changes.</p>
                : all.map((c) => (
                  <div key={c.id} className="text-xs py-2" style={{ borderBottom: '1px solid var(--shell-border)' }}>
                    <p style={{ color: 'var(--text-primary)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>{fmtVal(c.oldValue)}</span>
                      <span style={{ color: 'var(--text-dim)' }}> → </span>
                      <span className="font-semibold">{fmtVal(c.newValue)}</span>
                    </p>
                    <p className="mt-0.5" style={{ color: 'var(--text-dim)' }}>
                      {c.changedByName || c.changedBy} · {c.changedAt?.toDate ? format(c.changedAt.toDate(), 'dd MMM yyyy, HH:mm') : '—'}
                      {c.context ? ` · ${c.context}` : ''}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
