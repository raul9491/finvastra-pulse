import { useRef, useState } from 'react';
import { Phone, MessageCircle, Mail, Handshake, StickyNote, Check } from 'lucide-react';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import type { ActivityType } from '../../../types';

const TYPES: { key: ActivityType; label: string; icon: typeof Phone }[] = [
  { key: 'call',     label: 'Call',     icon: Phone },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'email',    label: 'Email',    icon: Mail },
  { key: 'meeting',  label: 'Meeting',  icon: Handshake },
  { key: 'note',     label: 'Note',     icon: StickyNote },
];

const MIN_CHARS = 5;

/**
 * Phase P — one-tap activity logging. Writes to the LEAD-level activity feed
 * (/leads/{leadId}/activities) so it works on raw leads with zero
 * opportunities; opportunityId is attached when provided for context.
 */
export function QuickLogBar({ leadId, opportunityId, onLogged, markFirstContact }: {
  leadId: string;
  opportunityId?: string;
  onLogged?: () => void;
  // Old-model leads: pass !lead.firstContactedAt so the first log stamps the
  // Stage-2 SLA end (set-once). The server sweep also backfills authoritatively.
  markFirstContact?: boolean;
}) {
  const { user, profile } = useAuth();
  const [type, setType] = useState<ActivityType>('call');
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const tooShort = text.trim().length < MIN_CHARS;

  async function submit() {
    if (!user || tooShort || busy) { setTouched(true); return; }
    const content = text.trim();
    // Optimistic clear — the write is fast and failure is surfaced by restoring.
    setText(''); setTouched(false); setBusy(true);
    try {
      await addDoc(collection(db, 'leads', leadId, 'activities'), {
        type,
        content,
        by:     user.uid,
        byName: profile?.displayName ?? '',
        at:     serverTimestamp(),
        opportunityId: opportunityId ?? null,
      });
      // Stamp first-contact once (Stage-2 SLA end) for old-model leads.
      if (markFirstContact) {
        updateDoc(doc(db, 'leads', leadId), { firstContactedAt: serverTimestamp() }).catch(() => {});
      }
      setFlash(true);
      setTimeout(() => setFlash(false), 1500);
      onLogged?.();
    } catch {
      setText(content); // restore on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {/* Type icons */}
      <div className="flex items-center gap-1 flex-wrap">
        {TYPES.map(({ key, label, icon: Icon }) => {
          const active = type === key;
          return (
            <button key={key} type="button"
              onClick={() => { setType(key); inputRef.current?.focus(); }}
              title={label}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors"
              style={{
                color: active ? '#C9A961' : 'var(--text-muted)',
                borderBottom: active ? '2px solid #C9A961' : '2px solid transparent',
              }}>
              <Icon size={14} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}
        {flash && (
          <span className="ml-auto flex items-center gap-1 text-xs font-semibold" style={{ color: '#34d399' }}>
            <Check size={13} /> Logged ✓
          </span>
        )}
      </div>

      {/* Input + Log */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          onBlur={() => text.length > 0 && setTouched(true)}
          placeholder={`Log a ${TYPES.find((t) => t.key === type)?.label.toLowerCase()}… (what happened?)`}
          className="glass-inp flex-1 text-sm"
        />
        <button onClick={submit} disabled={busy || tooShort}
          className="text-sm font-semibold px-4 rounded-lg disabled:opacity-40 shrink-0"
          style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
          {busy ? '…' : 'Log'}
        </button>
      </div>
      {touched && tooShort && text.length > 0 && (
        <p className="text-[11px]" style={{ color: '#f87171' }}>At least {MIN_CHARS} characters.</p>
      )}
    </div>
  );
}
