import { useEffect, useMemo, useState } from 'react';
import { Pencil, Phone, MessageCircle, Mail, Handshake, StickyNote, Activity as ActivityIcon } from 'lucide-react';
import {
  collection, onSnapshot, orderBy, query, doc, updateDoc, type Timestamp,
} from 'firebase/firestore';
import { format, isToday, isYesterday } from 'date-fns';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import type { ActivityType } from '../../../types';

interface LeadActivity {
  id: string;
  type: ActivityType;
  content: string;
  by: string;
  byName?: string;
  at: Timestamp | null;
  opportunityId?: string | null;
  // Phase R — GPS point captured by "Log visit here" (field RM meetings)
  location?: { lat: number; lng: number };
}

const TYPE_META: Partial<Record<ActivityType, { label: string; icon: typeof Phone; color: string }>> = {
  call:     { label: 'Call',     icon: Phone,         color: '#60a5fa' },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, color: '#34d399' },
  email:    { label: 'Email',    icon: Mail,          color: '#fbbf24' },
  meeting:  { label: 'Meeting',  icon: Handshake,     color: '#C9A961' },
  note:     { label: 'Note',     icon: StickyNote,    color: 'var(--text-muted)' },
};

const FILTERS = ['all', 'call', 'whatsapp', 'email', 'meeting', 'note'] as const;
type Filter = (typeof FILTERS)[number];

const EDIT_WINDOW_MS = 5 * 60_000;

function dayGroup(d: Date): string {
  if (isToday(d)) return 'TODAY';
  if (isYesterday(d)) return 'YESTERDAY';
  return 'EARLIER';
}

/**
 * Phase P — lead-level activity feed (reads /leads/{leadId}/activities).
 * Type filter chips · TODAY/YESTERDAY/EARLIER grouping · pencil-edit on own
 * items within 5 minutes of logging (matching the rules edit window).
 */
export function LeadActivityFeed({ leadId }: { leadId: string }) {
  const { user } = useAuth();
  const [items, setItems] = useState<LeadActivity[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [editingId, setEditingId] = useState('');
  const [editText, setEditText] = useState('');
  // tick so the 5-min pencil disappears on time without a snapshot
  const [, setTick] = useState(0);

  useEffect(() => {
    const q = query(collection(db, 'leads', leadId, 'activities'), orderBy('at', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LeadActivity));
    }, () => setItems([]));
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => { unsub(); clearInterval(t); };
  }, [leadId]);

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((a) => a.type === filter)),
    [items, filter],
  );

  const groups = useMemo(() => {
    const g = new Map<string, LeadActivity[]>();
    for (const a of filtered) {
      const d = a.at?.toDate?.();
      const key = d ? dayGroup(d) : 'TODAY'; // pending serverTimestamp ⇒ just logged
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(a);
    }
    return ['TODAY', 'YESTERDAY', 'EARLIER'].filter((k) => g.has(k)).map((k) => [k, g.get(k)!] as const);
  }, [filtered]);

  async function saveEdit(a: LeadActivity) {
    const content = editText.trim();
    if (content.length < 5) return;
    try {
      await updateDoc(doc(db, 'leads', leadId, 'activities', a.id), { content });
    } catch { /* window may have just expired — rules reject; UI hides on next tick */ }
    setEditingId('');
  }

  if (items.length === 0) return null;

  return (
    <div className="glass-panel p-6 mt-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <ActivityIcon size={15} style={{ color: '#C9A961' }} /> Activity
        </h3>
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize transition-colors"
              style={filter === f
                ? { backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.4)' }
                : { color: 'var(--text-muted)', border: '1px solid var(--shell-border)' }}>
              {f === 'all' ? 'All' : `${TYPE_META[f]?.label}s`}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        {groups.map(([label, acts]) => (
          <div key={label}>
            <p className="text-[9px] font-bold uppercase tracking-[0.3em] mb-2" style={{ color: 'var(--text-dim)' }}>
              {label}
            </p>
            <div className="space-y-2">
              {acts.map((a) => {
                const meta = TYPE_META[a.type] ?? { label: a.type, icon: StickyNote, color: 'var(--text-muted)' };
                const Icon = meta.icon;
                const atMs = a.at?.toMillis?.();
                const canEdit = a.by === user?.uid && atMs != null && Date.now() - atMs < EDIT_WINDOW_MS;
                const isEditing = editingId === a.id;
                return (
                  <div key={a.id} className="flex items-start gap-3 rounded-xl px-3 py-2.5 border border-(--shell-border)">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                      style={{ backgroundColor: 'var(--shell-hover-soft)', color: meta.color }}>
                      <Icon size={13} />
                    </div>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <input value={editText} onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(a); if (e.key === 'Escape') setEditingId(''); }}
                            autoFocus className="glass-inp flex-1 text-xs" />
                          <button onClick={() => saveEdit(a)}
                            className="text-xs font-semibold px-3 rounded-lg shrink-0"
                            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>Save</button>
                        </div>
                      ) : (
                        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{a.content}</p>
                      )}
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
                        {meta.label} · {a.byName || a.by.slice(0, 6)} · {a.at?.toDate ? format(a.at.toDate(), 'dd MMM, HH:mm') : 'just now'}
                        {a.location && (
                          <a href={`https://maps.google.com/?q=${a.location.lat},${a.location.lng}`}
                            target="_blank" rel="noreferrer"
                            className="ml-1.5 no-underline hover:underline" style={{ color: '#C9A961' }}>
                            · 📍 map
                          </a>
                        )}
                      </p>
                    </div>
                    {canEdit && !isEditing && (
                      <button onClick={() => { setEditingId(a.id); setEditText(a.content); }}
                        title="Edit (within 5 minutes of logging)"
                        className="p-1.5 rounded-lg hover:bg-(--shell-hover-mid) shrink-0"
                        style={{ color: 'var(--text-muted)' }}>
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
