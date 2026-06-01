import { type ElementType, useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { format, parseISO, addMonths, subMonths } from 'date-fns';
import {
  Receipt, Building2, Heart, Landmark, FileText, Archive, BookOpen,
  ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, Clock, X,
} from 'lucide-react';
import {
  collection, query, where, getDocs, addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import type { ComplianceRecord, ComplianceType, ComplianceStatus } from '../../../types';

// ─── Static metadata ──────────────────────────────────────────────────────────

const TYPE_META: Record<ComplianceType, { icon: ElementType; title: string; iconColor: string }> = {
  tds_deposit:          { icon: Receipt,  title: 'TDS Deposit',          iconColor: '#3B82F6' },
  pf_deposit:           { icon: Building2, title: 'PF Deposit',           iconColor: '#8B5CF6' },
  esic_deposit:         { icon: Heart,    title: 'ESIC Deposit',          iconColor: '#EC4899' },
  pt_deposit:           { icon: Landmark, title: 'PT Deposit',            iconColor: '#F59E0B' },
  tds_quarterly_return: { icon: FileText, title: 'TDS Quarterly Return',  iconColor: '#0EA5E9' },
  pf_annual_return:     { icon: Archive,  title: 'PF Annual Return',      iconColor: '#10B981' },
  pt_annual_return:     { icon: BookOpen, title: 'PT Annual Return',      iconColor: '#F97316' },
};

const STATUS_META: Record<ComplianceStatus, { label: string; bg: string; text: string }> = {
  upcoming: { label: 'Upcoming', bg: '#F1F5F9', text: '#475569' },
  due_soon: { label: 'Due Soon', bg: '#FEF3C7', text: '#92400E' },
  overdue:  { label: 'Overdue',  bg: '#FEE2E2', text: '#991B1B' },
  filed:    { label: 'Filed',    bg: '#D1FAE5', text: '#065F46' },
};

// ─── Status computation (deterministic — based on today vs dueDate) ───────────

function computeStatus(dueDate: string, filedAt: unknown): ComplianceStatus {
  if (filedAt) return 'filed';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = parseISO(dueDate);
  const sevenBefore = new Date(due);
  sevenBefore.setDate(sevenBefore.getDate() - 7);
  if (today > due) return 'overdue';
  if (today >= sevenBefore) return 'due_soon';
  return 'upcoming';
}

// ─── Seed generator ───────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, '0'); }

type SeedItem = Omit<ComplianceRecord, 'id' | 'createdAt' | 'amount' | 'filedAt' | 'filedBy' | 'referenceNumber' | 'notes'>;

function generateComplianceItems(year: number, month: number): SeedItem[] {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const monthStr  = `${year}-${pad2(month)}`;
  const lastDay   = new Date(year, month, 0).getDate(); // day-0 of next month = last day of this month

  function make(type: ComplianceType, description: string, dueDate: string): SeedItem {
    return { type, description, dueDate, month: monthStr, year, status: computeStatus(dueDate, null) };
  }

  const items: SeedItem[] = [
    make('tds_deposit', 'TDS Deposit — Section 200 Income Tax Act',
      `${nextYear}-${pad2(nextMonth)}-07`),
    make('pf_deposit', 'PF Deposit — EPFO (Employee + Employer)',
      `${nextYear}-${pad2(nextMonth)}-15`),
    make('pt_deposit', 'Professional Tax Deposit — Telangana',
      `${year}-${pad2(month)}-${pad2(lastDay)}`),
    make('esic_deposit', 'ESIC Deposit (if applicable — salary < ₹21,000)',
      `${nextYear}-${pad2(nextMonth)}-21`),
  ];

  // Quarterly TDS Return — added in the last month of each quarter
  // Q1 Apr-Jun → June → due 31 Jul
  // Q2 Jul-Sep → Sep  → due 31 Oct
  // Q3 Oct-Dec → Dec  → due 31 Jan (next year)
  // Q4 Jan-Mar → Mar  → due 31 May
  if (month === 6)  items.push(make('tds_quarterly_return', 'TDS Quarterly Return — Q1 (Apr–Jun)', `${year}-07-31`));
  if (month === 9)  items.push(make('tds_quarterly_return', 'TDS Quarterly Return — Q2 (Jul–Sep)', `${year}-10-31`));
  if (month === 12) items.push(make('tds_quarterly_return', 'TDS Quarterly Return — Q3 (Oct–Dec)', `${nextYear}-01-31`));
  if (month === 3)  items.push(make('tds_quarterly_return', 'TDS Quarterly Return — Q4 (Jan–Mar)', `${year}-05-31`));

  // Annual returns — seeded in March (end of Indian financial year)
  if (month === 3) {
    items.push(make('pf_annual_return', 'PF Annual Return — EPF Misc Provisions Act', `${year}-06-30`));
    items.push(make('pt_annual_return', 'Professional Tax Annual Return — Telangana', `${year}-04-30`));
  }

  return items;
}

// ─── Mark Filed Modal ─────────────────────────────────────────────────────────

interface MarkFiledModalProps {
  record: ComplianceRecord;
  actorUid: string;
  onClose: () => void;
  onSaved: () => void;
}

function MarkFiledModal({ record, actorUid, onClose, onSaved }: MarkFiledModalProps) {
  const [refNum, setRefNum] = useState(record.referenceNumber ?? '');
  const [amount, setAmount] = useState<string>(record.amount != null ? String(record.amount) : '');
  const [notes,  setNotes]  = useState(record.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const meta = TYPE_META[record.type];

  async function handleSave() {
    if (!refNum.trim()) { setErr('Challan / reference number is required.'); return; }
    setSaving(true);
    try {
      await updateDoc(doc(db, 'compliance_records', record.id), {
        status:          'filed',
        filedAt:         serverTimestamp(),
        filedBy:         actorUid,
        referenceNumber: refNum.trim(),
        amount:          amount ? Number(amount) : null,
        notes:           notes.trim() || null,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const inp = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-navy/10';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <div className="rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl" style={{ backgroundColor: '#FFFFFF' }}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold" style={{ color: '#0A0A0A' }}>Mark as Filed</h3>
          <button onClick={onClose}><X size={18} style={{ color: '#8B8B85' }} /></button>
        </div>
        <p className="text-sm mb-4" style={{ color: '#475569' }}>
          <span className="font-medium" style={{ color: '#0A0A0A' }}>{meta.title}</span>
          {' — '}Due {format(parseISO(record.dueDate), 'd MMM yyyy')}
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest block mb-1.5" style={{ color: '#8B8B85' }}>
              Challan / Reference No. <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <input className={inp} value={refNum}
              onChange={(e) => { setRefNum(e.target.value); setErr(''); }}
              placeholder="e.g. 0123456789" />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest block mb-1.5" style={{ color: '#8B8B85' }}>
              Amount Deposited (₹, optional)
            </label>
            <input className={inp} type="number" min={0} value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 45000" />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest block mb-1.5" style={{ color: '#8B8B85' }}>
              Notes (optional)
            </label>
            <textarea className={`${inp} h-20 resize-none`} value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any remarks…" />
          </div>
          {err && <p className="text-xs" style={{ color: '#DC2626' }}>{err}</p>}
        </div>

        <div className="flex gap-3 justify-end mt-6">
          <button onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg border border-slate-200"
            style={{ color: '#2A2A2A' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="text-sm px-5 py-2 rounded-lg font-semibold disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {saving ? 'Saving…' : 'Confirm Filed'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── View Details Modal ───────────────────────────────────────────────────────

function ViewDetailsModal({ record, onClose, onEdit }: {
  record: ComplianceRecord;
  onClose: () => void;
  onEdit: () => void;
}) {
  const meta = TYPE_META[record.type];
  const filedDate = record.filedAt
    ? format((record.filedAt as { toDate(): Date }).toDate(), 'd MMM yyyy')
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <div className="rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl" style={{ backgroundColor: '#FFFFFF' }}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold" style={{ color: '#0A0A0A' }}>Filing Details</h3>
          <button onClick={onClose}><X size={18} style={{ color: '#8B8B85' }} /></button>
        </div>

        <div className="space-y-3 text-sm" style={{ color: '#2A2A2A' }}>
          <div className="flex justify-between">
            <span style={{ color: '#8B8B85' }}>Type</span>
            <span className="font-medium">{meta.title}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: '#8B8B85' }}>Due Date</span>
            <span>{format(parseISO(record.dueDate), 'd MMM yyyy')}</span>
          </div>
          {record.referenceNumber && (
            <div className="flex justify-between">
              <span style={{ color: '#8B8B85' }}>Reference No.</span>
              <span className="font-mono">{record.referenceNumber}</span>
            </div>
          )}
          {record.amount != null && (
            <div className="flex justify-between">
              <span style={{ color: '#8B8B85' }}>Amount</span>
              <span>₹{record.amount.toLocaleString('en-IN')}</span>
            </div>
          )}
          {filedDate && (
            <div className="flex justify-between">
              <span style={{ color: '#8B8B85' }}>Filed On</span>
              <span>{filedDate}</span>
            </div>
          )}
          {record.notes && (
            <div>
              <span style={{ color: '#8B8B85' }}>Notes</span>
              <p className="mt-1 p-3 rounded-lg text-xs" style={{ backgroundColor: '#F8FAFC' }}>{record.notes}</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end mt-6">
          <button onClick={onEdit}
            className="text-sm px-4 py-2 rounded-lg border border-slate-200"
            style={{ color: '#2A2A2A' }}>Edit</button>
          <button onClick={onClose}
            className="text-sm px-5 py-2 rounded-lg font-semibold"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Compliance Card ──────────────────────────────────────────────────────────

function ComplianceCard({ record, onMarkFiled, onView }: {
  record: ComplianceRecord;
  onMarkFiled: () => void;
  onView: () => void;
}) {
  const meta   = TYPE_META[record.type];
  const status = computeStatus(record.dueDate, record.filedAt);
  const sm     = STATUS_META[status];
  const Icon   = meta.icon;

  const dueFmt = format(parseISO(record.dueDate), 'd MMM yyyy');
  const filedDate = record.filedAt
    ? format((record.filedAt as { toDate(): Date }).toDate(), 'd MMM yyyy')
    : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4 hover:shadow-sm transition-shadow">
      {/* Top row: icon + title + status pill */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${meta.iconColor}18` }}>
          <Icon size={18} style={{ color: meta.iconColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm" style={{ color: '#0A0A0A' }}>{meta.title}</p>
          <p className="text-xs mt-0.5 truncate" style={{ color: '#8B8B85' }}>{record.description}</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0"
          style={{ backgroundColor: sm.bg, color: sm.text }}>
          {sm.label}
        </span>
      </div>

      {/* Due date */}
      <div className="flex items-center gap-1.5 text-xs" style={{ color: '#475569' }}>
        <Clock size={12} />
        <span>Due {dueFmt}</span>
      </div>

      {/* Filed info */}
      {status === 'filed' && (
        <div className="rounded-lg p-3 text-xs space-y-1" style={{ backgroundColor: '#F0FDF4' }}>
          {record.referenceNumber && (
            <p><span style={{ color: '#8B8B85' }}>Ref: </span>
              <span className="font-mono font-medium" style={{ color: '#065F46' }}>{record.referenceNumber}</span></p>
          )}
          {record.amount != null && (
            <p><span style={{ color: '#8B8B85' }}>Amount: </span>
              <span style={{ color: '#065F46' }}>₹{record.amount.toLocaleString('en-IN')}</span></p>
          )}
          {filedDate && (
            <p><span style={{ color: '#8B8B85' }}>Filed: </span>
              <span style={{ color: '#065F46' }}>{filedDate}</span></p>
          )}
        </div>
      )}

      {/* Action */}
      <div className="flex gap-2">
        {status !== 'filed' ? (
          <button onClick={onMarkFiled}
            className="flex-1 text-xs font-semibold py-2 rounded-lg transition-colors"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            Mark as Filed
          </button>
        ) : (
          <button onClick={onView}
            className="flex-1 text-xs font-semibold py-2 rounded-lg border transition-colors"
            style={{ border: '1px solid #E2E8F0', color: '#475569' }}>
            View Details
          </button>
        )}
        {status === 'filed' && (
          <button onClick={onMarkFiled}
            className="text-xs font-medium px-3 py-2 rounded-lg border"
            style={{ border: '1px solid #E2E8F0', color: '#8B8B85' }}>
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

// ─── useOverdueComplianceCount — exported for HrmsShell badge ─────────────────

export function useOverdueComplianceCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    // Query unfiled records; compute overdue in JS (avoids composite index requirement)
    const q = query(
      collection(db, 'compliance_records'),
      where('filedAt', '==', null),
    );
    let unsubscribe: (() => void) | undefined;
    // Use getDocs (not onSnapshot) to avoid needing a composite index for the badge
    getDocs(q).then((snap) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const overdue = snap.docs.filter((d) => {
        const dueDate = parseISO(d.data().dueDate as string);
        return dueDate < today;
      });
      setCount(overdue.length);
    }).catch(() => setCount(0));

    return unsubscribe;
  }, [enabled]);

  return count;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ComplianceCalendarPage() {
  const { user, profile } = useAuth();

  // ── All hooks unconditionally at the top — Rules of Hooks ───────────────────
  // The auth guard comes AFTER this block. useState/useCallback/useEffect must
  // never appear after an early return or React throws Error #300.
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [records,     setRecords]     = useState<ComplianceRecord[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [seeding,     setSeeding]     = useState(false);

  const [markFiledFor, setMarkFiledFor] = useState<ComplianceRecord | null>(null);
  const [viewFor,      setViewFor]      = useState<ComplianceRecord | null>(null);

  const year  = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1; // 1-indexed
  const monthStr = `${year}-${pad2(month)}`;
  const monthLabel = format(currentDate, 'MMMM yyyy');

  // ── Load records for the current month ──────────────────────────────────────

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'compliance_records'), where('month', '==', monthStr)),
      );
      if (snap.empty) {
        // Auto-seed
        setSeeding(true);
        const items = generateComplianceItems(year, month);
        for (const item of items) {
          await addDoc(collection(db, 'compliance_records'), {
            ...item,
            amount:          null,
            filedAt:         null,
            filedBy:         null,
            referenceNumber: null,
            notes:           null,
            createdAt:       serverTimestamp(),
          });
        }
        setSeeding(false);
        // Re-fetch after seeding
        const snap2 = await getDocs(
          query(collection(db, 'compliance_records'), where('month', '==', monthStr)),
        );
        setRecords(snap2.docs.map((d) => ({ id: d.id, ...d.data() }) as ComplianceRecord));
      } else {
        setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ComplianceRecord));
      }
    } finally {
      setLoading(false);
    }
  }, [monthStr, year, month]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  // ── Auth guard (after all hooks) ─────────────────────────────────────────────
  // Only redirect once profile has loaded. While profile===null the app is still
  // initialising — redirecting then would break the hook count on the next render.
  if (profile && profile.role !== 'admin' && !profile.isHrmsManager) {
    return <Navigate to="/hrms/dashboard" replace />;
  }

  // ── Summary counts (computed live from dueDate, not stored status) ───────────

  const summary = records.reduce(
    (acc, r) => {
      const s = computeStatus(r.dueDate, r.filedAt);
      acc[s]++;
      return acc;
    },
    { overdue: 0, due_soon: 0, filed: 0, upcoming: 0 } as Record<ComplianceStatus, number>,
  );

  // ── Ordered records: overdue first, then due_soon, then upcoming, then filed ─

  const sortOrder: Record<ComplianceStatus, number> = { overdue: 0, due_soon: 1, upcoming: 2, filed: 3 };
  const sorted = [...records].sort((a, b) => {
    const sa = computeStatus(a.dueDate, a.filedAt);
    const sb = computeStatus(b.dueDate, b.filedAt);
    if (sortOrder[sa] !== sortOrder[sb]) return sortOrder[sa] - sortOrder[sb];
    return a.dueDate.localeCompare(b.dueDate);
  });

  return (
    <div className="max-w-5xl">

      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl mb-1" style={{
          fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic',
          fontWeight: 300, color: '#0A0A0A',
        }}>
          Compliance Calendar
        </h2>
        <p className="text-sm" style={{ color: '#8B8B85' }}>
          Track statutory filing deadlines — TDS, PF, PT, ESIC
        </p>
      </div>

      {/* Month navigator */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => setCurrentDate((d) => subMonths(d, 1))}
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
          style={{ color: '#8B8B85' }}>
          <ChevronLeft size={18} />
        </button>
        <span className="text-base font-semibold w-36 text-center" style={{ color: '#0A0A0A' }}>
          {monthLabel}
        </span>
        <button
          onClick={() => setCurrentDate((d) => addMonths(d, 1))}
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
          style={{ color: '#8B8B85' }}>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {([
          { key: 'overdue',  label: 'Overdue',  bg: '#FEE2E2', text: '#991B1B', icon: AlertCircle  },
          { key: 'due_soon', label: 'Due Soon', bg: '#FEF3C7', text: '#92400E', icon: Clock         },
          { key: 'filed',    label: 'Filed',    bg: '#D1FAE5', text: '#065F46', icon: CheckCircle2  },
          { key: 'upcoming', label: 'Upcoming', bg: '#F1F5F9', text: '#475569', icon: Clock         },
        ] as Array<{ key: ComplianceStatus; label: string; bg: string; text: string; icon: ElementType }>).map(
          ({ key, label, bg, text, icon: Icon }) => (
            <div key={key} className="rounded-2xl p-4 flex items-center gap-3"
              style={{ backgroundColor: bg }}>
              <Icon size={18} style={{ color: text }} />
              <div>
                <p className="text-xl font-bold" style={{ color: text }}>{summary[key]}</p>
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: text }}>
                  {label}
                </p>
              </div>
            </div>
          ),
        )}
      </div>

      {/* Loading */}
      {(loading || seeding) && (
        <div className="text-sm text-center py-16" style={{ color: '#8B8B85' }}>
          {seeding ? 'Setting up compliance items for this month…' : 'Loading…'}
        </div>
      )}

      {/* Cards grid */}
      {!loading && !seeding && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((record) => (
            <ComplianceCard
              key={record.id}
              record={record}
              onMarkFiled={() => setMarkFiledFor(record)}
              onView={() => setViewFor(record)}
            />
          ))}
          {sorted.length === 0 && (
            <p className="col-span-3 text-center py-16 text-sm" style={{ color: '#8B8B85' }}>
              No compliance items for this month.
            </p>
          )}
        </div>
      )}

      {/* Modals */}
      {markFiledFor && (
        <MarkFiledModal
          record={markFiledFor}
          actorUid={user?.uid ?? ''}
          onClose={() => setMarkFiledFor(null)}
          onSaved={() => { setMarkFiledFor(null); loadRecords(); }}
        />
      )}
      {viewFor && (
        <ViewDetailsModal
          record={viewFor}
          onClose={() => setViewFor(null)}
          onEdit={() => { setMarkFiledFor(viewFor); setViewFor(null); }}
        />
      )}
    </div>
  );
}
