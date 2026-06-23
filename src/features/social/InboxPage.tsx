/**
 * WhatsApp Inbox — Social Media module, Phase 1.
 *
 * Two-pane: conversation list (leads with WhatsApp activity, newest first) + thread
 * (live messages) + composer. Reads via the Firestore SDK (rule-gated); the reply +
 * mark-read go through /api/crm2/whatsapp/* (server sends via the Graph API). Free
 * text is allowed only inside the 24h customer-care window (else a template is needed,
 * Phase 2). Also embeddable as a lead-detail tab via <WhatsAppThread leadId=… />.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  collection, query, orderBy, limit, onSnapshot, type Timestamp,
} from 'firebase/firestore';
import { format, formatDistanceToNow } from 'date-fns';
import { MessageCircle, Send, Search, ArrowLeft, Loader2, Phone, AlertCircle } from 'lucide-react';
import { db } from '../../lib/firebase';
import { apiCrm2 } from '../crm2/lib';

const TEAL = '#14B8A6';
const OUT_BG = 'rgba(20,184,166,0.16)';   // outbound bubble (our messages)

interface Conversation {
  id: string;
  name: string;
  mobile: string;
  waLastMessageText: string | null;
  waLastMessageAt: Timestamp | null;
  waLastInboundAt: Timestamp | null;
  waUnread: number;
}
interface ThreadMessage {
  id: string;
  direction: 'in' | 'out';
  body: string | null;
  type: string;
  status: string;
  byName: string | null;
  at: Timestamp | null;
}

const tsMs = (t: Timestamp | null | undefined): number => t?.toMillis?.() ?? 0;
const within24h = (lastIn: Timestamp | null): boolean => {
  const ms = tsMs(lastIn);
  return ms > 0 && Date.now() - ms < 24 * 3600 * 1000;
};

// ─── Conversation list hook ─────────────────────────────────────────────────────
function useConversations() {
  const [rows, setRows] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const q = query(collection(db, 'leads'), orderBy('waLastMessageAt', 'desc'), limit(60));
    return onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          name: (x.name as string) || (x.displayName as string) || (x.mobile as string) || 'Unknown',
          mobile: (x.mobile as string) || (x.phone as string) || '',
          waLastMessageText: (x.waLastMessageText as string | null) ?? null,
          waLastMessageAt: (x.waLastMessageAt as Timestamp | null) ?? null,
          waLastInboundAt: (x.waLastInboundAt as Timestamp | null) ?? null,
          waUnread: (x.waUnread as number) ?? 0,
        };
      }));
      setLoading(false);
    }, (e) => { setError(e.message); setLoading(false); });
  }, []);
  return { rows, loading, error };
}

// ─── Thread hook (also used by the lead-detail tab) ─────────────────────────────
export function useWhatsAppThread(leadId: string | null) {
  const [rows, setRows] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!leadId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const q = query(collection(db, 'leads', leadId, 'whatsapp'), orderBy('at', 'asc'), limit(500));
    return onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          direction: (x.direction as 'in' | 'out') ?? 'in',
          body: (x.body as string | null) ?? null,
          type: (x.type as string) ?? 'text',
          status: (x.status as string) ?? '',
          byName: (x.byName as string | null) ?? null,
          at: (x.at as Timestamp | null) ?? null,
        };
      }));
      setLoading(false);
    }, () => setLoading(false));
  }, [leadId]);
  return { rows, loading };
}

// ─── Message bubble ─────────────────────────────────────────────────────────────
function Bubble({ m }: { m: ThreadMessage }) {
  const out = m.direction === 'out';
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[78%] rounded-2xl px-3.5 py-2"
        style={{
          backgroundColor: out ? OUT_BG : 'var(--shell-hover-hard)',
          borderTopRightRadius: out ? 4 : undefined,
          borderTopLeftRadius: out ? undefined : 4,
        }}>
        {m.body
          ? <p className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)' }}>{m.body}</p>
          : <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>[{m.type}]</p>}
        <div className="flex items-center gap-1.5 mt-0.5 justify-end">
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {m.at ? format(m.at.toDate(), 'd MMM, h:mm a') : '…'}
          </span>
          {out && m.status && (
            <span className="text-[10px]" style={{ color: m.status === 'failed' ? '#EF4444' : 'var(--text-muted)' }}>
              · {m.status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Thread + composer (reused on the lead page) ────────────────────────────────
export function WhatsAppThread({ leadId, lastInboundAt, compact = false }: {
  leadId: string; lastInboundAt: Timestamp | null; compact?: boolean;
}) {
  const { rows, loading } = useWhatsAppThread(leadId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const open24h = within24h(lastInboundAt);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [rows.length]);
  // Clear unread once the thread is open.
  useEffect(() => { if (leadId) apiCrm2('POST', `/api/crm2/whatsapp/${leadId}/read`).catch(() => {}); }, [leadId]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setErr('');
    try {
      await apiCrm2('POST', '/api/crm2/whatsapp/send', { leadId, text: body });
      setText('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Send failed');
    } finally { setSending(false); }
  };

  return (
    <div className="flex flex-col" style={{ height: compact ? 460 : '100%' }}>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2" style={{ backgroundColor: 'var(--glass-panel-bg)' }}>
        {loading ? (
          <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin" style={{ color: TEAL }} /></div>
        ) : rows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2" style={{ color: 'var(--text-muted)' }}>
            <MessageCircle size={28} /><p className="text-sm">No messages yet.</p>
          </div>
        ) : (
          <>{rows.map((m) => <Bubble key={m.id} m={m} />)}<div ref={endRef} /></>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 p-3" style={{ borderTop: '1px solid var(--shell-border)' }}>
        {!open24h && (
          <div className="flex items-start gap-2 mb-2 px-3 py-2 rounded-lg text-xs"
            style={{ backgroundColor: 'rgba(245,158,11,0.10)', color: '#B45309' }}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>Outside the 24-hour reply window. Free replies are paused until the customer messages again — approved <b>template</b> messages arrive in Phase 2.</span>
          </div>
        )}
        {err && <p className="text-xs mb-2" style={{ color: '#EF4444' }}>{err}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={open24h ? 'Type a reply…  (Enter to send)' : 'Reply window closed'}
            disabled={!open24h || sending}
            rows={1}
            className="flex-1 resize-none rounded-xl px-3.5 py-2.5 text-sm outline-none disabled:opacity-50"
            style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)', color: 'var(--text-primary)', maxHeight: 120 }}
          />
          <button
            onClick={send}
            disabled={!open24h || sending || !text.trim()}
            className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: TEAL, color: '#fff' }}
            aria-label="Send"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inbox page ─────────────────────────────────────────────────────────────────
export function InboxPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const { rows, loading, error } = useConversations();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(s) || r.mobile.includes(s));
  }, [rows, search]);

  const active = rows.find((r) => r.id === leadId) ?? null;

  return (
    <div className="glass-panel overflow-hidden p-0" style={{ height: 'calc(100vh - 9rem)' }}>
      <div className="flex h-full">
        {/* ── Conversation list ── */}
        <div className={`${leadId ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 shrink-0`}
          style={{ borderRight: '1px solid var(--shell-border)' }}>
          <div className="p-3 shrink-0" style={{ borderBottom: '1px solid var(--shell-border)' }}>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or number…"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg outline-none"
                style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-8 flex justify-center"><Loader2 className="animate-spin" style={{ color: TEAL }} /></div>
            ) : error ? (
              <p className="p-4 text-xs" style={{ color: '#EF4444' }}>{error}</p>
            ) : filtered.length === 0 ? (
              <div className="p-8 flex flex-col items-center gap-2 text-center" style={{ color: 'var(--text-muted)' }}>
                <MessageCircle size={26} />
                <p className="text-sm">{rows.length === 0 ? 'No WhatsApp conversations yet.' : 'No matches.'}</p>
              </div>
            ) : filtered.map((c) => {
              const sel = c.id === leadId;
              return (
                <button key={c.id} onClick={() => navigate(`/social/inbox/${c.id}`)}
                  className="w-full text-left px-3.5 py-3 flex items-center gap-3 transition-colors"
                  style={{ backgroundColor: sel ? OUT_BG : 'transparent', borderBottom: '1px solid var(--shell-border)' }}
                  onMouseEnter={(e) => { if (!sel) e.currentTarget.style.backgroundColor = 'var(--shell-hover-soft)'; }}
                  onMouseLeave={(e) => { if (!sel) e.currentTarget.style.backgroundColor = 'transparent'; }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                    style={{ backgroundColor: TEAL + '22', color: TEAL }}>
                    {c.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
                      <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {c.waLastMessageAt ? formatDistanceToNow(c.waLastMessageAt.toDate(), { addSuffix: false }) : ''}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{c.waLastMessageText ?? '—'}</p>
                      {c.waUnread > 0 && (
                        <span className="shrink-0 text-[10px] font-bold text-white rounded-full px-1.5 min-w-[18px] text-center"
                          style={{ backgroundColor: TEAL }}>{c.waUnread}</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Thread ── */}
        <div className={`${leadId ? 'flex' : 'hidden md:flex'} flex-col flex-1 min-w-0`}>
          {active ? (
            <>
              <div className="h-14 shrink-0 flex items-center gap-3 px-4" style={{ borderBottom: '1px solid var(--shell-border)' }}>
                <button onClick={() => navigate('/social/inbox')} className="md:hidden p-1 -ml-1" aria-label="Back">
                  <ArrowLeft size={18} style={{ color: 'var(--text-primary)' }} />
                </button>
                <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                  style={{ backgroundColor: TEAL + '22', color: TEAL }}>{active.name.slice(0, 2).toUpperCase()}</div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{active.name}</p>
                  <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                    <Phone size={10} /> {active.mobile || '—'}
                  </p>
                </div>
                <a href={`/crm/pipeline/leads`} className="ml-auto text-xs font-medium hidden sm:block" style={{ color: TEAL }}>
                  Open in CRM →
                </a>
              </div>
              <WhatsAppThread leadId={active.id} lastInboundAt={active.waLastInboundAt} />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6" style={{ color: 'var(--text-muted)' }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: TEAL + '18', color: TEAL }}>
                <MessageCircle size={30} />
              </div>
              <p className="text-sm font-medium">Select a conversation</p>
              <p className="text-xs max-w-xs">Customer WhatsApp messages land here automatically, linked to their lead. Replies are free within 24 hours of their last message.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
