import { type ElementType, useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import {
  format, parseISO, addMonths, subMonths,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isToday,
} from 'date-fns';
import {
  Receipt, Building2, Heart, Coins, Percent, Calculator, Briefcase, FileText,
  ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, Clock, X, Info, CalendarDays, List,
} from 'lucide-react';
import {
  collection, query, where, getDocs, setDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import type { ComplianceRecord, ComplianceType, ComplianceStatus } from '../../../types';

// ─── Static metadata (keyed by category — `title` carries the specific obligation) ──

const TYPE_META: Record<ComplianceType, { icon: ElementType; title: string; iconColor: string }> = {
  tds:        { icon: Receipt,    title: 'TDS / TCS',        iconColor: '#3B82F6' },
  gst:        { icon: Percent,    title: 'GST',              iconColor: '#14B8A6' },
  income_tax: { icon: Calculator, title: 'Income Tax',       iconColor: '#6366F1' },
  pt:         { icon: Coins,      title: 'Professional Tax', iconColor: '#F59E0B' },
  pf:         { icon: Building2,  title: 'Provident Fund',   iconColor: '#8B5CF6' },
  esi:        { icon: Heart,      title: 'ESI',              iconColor: '#EC4899' },
  mca:        { icon: Briefcase,  title: 'MCA / ROC',        iconColor: '#0EA5E9' },
  payroll:    { icon: FileText,   title: 'Payroll',          iconColor: '#10B981' },
};

// Fallback for any legacy `type` value not in the category set above.
const FALLBACK_META = { icon: FileText, title: 'Compliance', iconColor: '#94A3B8' };
const metaFor = (t: ComplianceType) => TYPE_META[t] ?? FALLBACK_META;

const STATUS_META: Record<ComplianceStatus, { label: string; bg: string; text: string; dot: string }> = {
  upcoming: { label: 'Upcoming', bg: 'var(--shell-hover-hard)', text: 'var(--text-muted)', dot: '#94A3B8' },
  due_soon: { label: 'Due Soon', bg: '#FEF3C7', text: '#92400E', dot: '#D97706' },
  overdue:  { label: 'Overdue',  bg: '#FEE2E2', text: '#991B1B', dot: '#DC2626' },
  filed:    { label: 'Filed',    bg: '#D1FAE5', text: '#065F46', dot: '#059669' },
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

// ─── Seed generator — Finvastra CA Compliance Calendar FY 2026-27 ─────────────
// Convention: a month's view lists every obligation DUE within that month (the
// same way the CA's table is laid out). The recurring monthly deposits/returns
// are for the *previous* month's period (e.g. April shows March's TDS/PF/PT/ESI).
//
// SEED_VERSION: bump this whenever the schedule below changes. On the next view,
// a month's UNFILED items seeded by an older version are auto-replaced — the
// calendar self-heals to the latest CA rules with no manual action. Filed items
// are always preserved.

const SEED_VERSION = 2;

function pad2(n: number) { return String(n).padStart(2, '0'); }

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

type SeedItem = Omit<ComplianceRecord, 'id' | 'createdAt' | 'amount' | 'filedAt' | 'filedBy' | 'referenceNumber' | 'notes'>;

function generateComplianceItems(year: number, month: number): SeedItem[] {
  const monthStr = `${year}-${pad2(month)}`;
  const prevM = month === 1 ? 12 : month - 1;
  const prevY = month === 1 ? year - 1 : year;
  const prev  = `${MONTH_NAMES[prevM]} ${prevY}`;
  const iso = (d: number) => `${year}-${pad2(month)}-${pad2(d)}`;

  function make(type: ComplianceType, title: string, description: string, dueDate: string): SeedItem {
    return { type, title, description, dueDate, month: monthStr, year, seedVersion: SEED_VERSION, status: computeStatus(dueDate, null) };
  }

  // ── Monthly deposits / returns (for the previous month's period) ──────────
  const items: SeedItem[] = [
    make('tds', 'TDS Deposit',         `TDS deducted in ${prev} — deposit (Sec 200)`,        iso(7)),
    make('gst', 'GSTR-1',              `Outward supplies for ${prev}`,                       iso(11)),
    make('gst', 'GSTR-3B',             `Summary return + tax payment for ${prev}`,           iso(20)),
    make('pt',  'PT Deposit & Return', `Professional Tax (Telangana) for ${prev}`,           iso(10)),
    make('pf',  'PF Deposit',          `EPF — employee + employer for ${prev}`,              iso(15)),
    make('esi', 'ESI Deposit',         `ESI contribution for ${prev} (wages ≤ ₹21,000)`,     iso(15)),
  ];

  // ── Month-specific statutory items ────────────────────────────────────────
  switch (month) {
    case 4: // April
      items.push(make('tds', 'TDS Deposit (special)',           'March TDS — special provisions (govt / 194-IA etc.)', iso(30)));
      items.push(make('pt',  'PT Annual Return (Form V)',       'Telangana Professional Tax annual return',            iso(10)));
      items.push(make('esi', 'ESI Half-Yearly Return (Form 5)', 'For the Oct–Mar contribution period',                 iso(11)));
      break;
    case 5: // May
      items.push(make('tds',        'TDS Return — Q4 (Jan–Mar)',        'Quarterly TDS statement',          iso(31)));
      items.push(make('tds',        'TCS Return — Q4 (Jan–Mar)',        'Quarterly TCS statement',          iso(15)));
      items.push(make('income_tax', 'Form 15G / 15H — Q4',              'Quarterly upload of declarations', iso(15)));
      items.push(make('pf',         'PF Annual Return (Form 3A / 6A)',  'EPFO annual return',               iso(31)));
      break;
    case 6: // June
      items.push(make('income_tax', 'Advance Tax — 1st instalment (15%)', 'AY 2027-28',                       iso(15)));
      items.push(make('mca',        'Board Meeting — Q1',                 'Min 4/year; max 120-day gap',      iso(30)));
      break;
    case 7: // July
      items.push(make('income_tax', 'ITR Filing (non-audit)',     'Individual / HUF / firm — no audit', iso(31)));
      items.push(make('tds',        'TDS Return — Q1 (Apr–Jun)',  'Quarterly TDS statement',            iso(31)));
      items.push(make('tds',        'TCS Return — Q1 (Apr–Jun)',  'Quarterly TCS statement',            iso(15)));
      items.push(make('income_tax', 'Form 15G / 15H — Q1',        'Quarterly upload of declarations',   iso(15)));
      break;
    case 9: // September
      items.push(make('income_tax', 'Advance Tax — 2nd instalment (45%)', 'AY 2027-28',                  iso(15)));
      items.push(make('income_tax', 'Tax Audit Report',                   'Sec 44AB audit report',       iso(30)));
      items.push(make('mca',        'DIR-3 KYC',                          'Director KYC (annual)',       iso(30)));
      items.push(make('mca',        'AGM',                                'Within 6 months of FY end',   iso(30)));
      items.push(make('mca',        'Board Meeting — Q2',                 'Min 4/year; max 120-day gap', iso(30)));
      break;
    case 10: // October
      items.push(make('income_tax', 'ITR-6 Filing (audit case)',         'Companies / audited business',  iso(31)));
      items.push(make('tds',        'TDS Return — Q2 (Jul–Sep)',         'Quarterly TDS statement',       iso(31)));
      items.push(make('tds',        'TCS Return — Q2 (Jul–Sep)',         'Quarterly TCS statement',       iso(15)));
      items.push(make('income_tax', 'Form 15G / 15H — Q2',               'Quarterly upload of declarations', iso(15)));
      items.push(make('esi',        'ESI Half-Yearly Return (Form 5)',   'For the Apr–Sep contribution period', iso(11)));
      items.push(make('mca',        'ADT-1 — Auditor Appointment',       'Within 15 days of AGM',         iso(15)));
      items.push(make('mca',        'AOC-4 — Financial Statements',      'Within 30 days of AGM',         iso(30)));
      items.push(make('mca',        'MGT-14 — Board Resolutions',        'If applicable, post-AGM filing', iso(30)));
      break;
    case 11: // November
      items.push(make('mca', 'MGT-7 — Annual Return', 'Within 60 days of AGM', iso(30)));
      break;
    case 12: // December
      items.push(make('gst',        'GSTR-9 — Annual Return',            'GST annual return (prior FY)', iso(31)));
      items.push(make('income_tax', 'Advance Tax — 3rd instalment (75%)', 'AY 2027-28',                  iso(15)));
      items.push(make('mca',        'Board Meeting — Q3',                'Min 4/year; max 120-day gap',  iso(31)));
      break;
    case 1: // January
      items.push(make('tds',        'TDS Return — Q3 (Oct–Dec)',  'Quarterly TDS statement',          iso(31)));
      items.push(make('tds',        'TCS Return — Q3 (Oct–Dec)',  'Quarterly TCS statement',          iso(15)));
      items.push(make('income_tax', 'Form 15G / 15H — Q3',        'Quarterly upload of declarations', iso(15)));
      items.push(make('esi',        'ESI Annual Return (Form 5)', 'Annual return',                    iso(31)));
      break;
    case 3: // March
      items.push(make('income_tax', 'Advance Tax — 4th instalment (100%)', 'AY 2027-28',                  iso(15)));
      items.push(make('mca',        'Board Meeting — Q4',                  'Min 4/year; max 120-day gap', iso(31)));
      items.push(make('pf',         'Reconcile Annual PF Accounts',        'Year-end PF reconciliation',  iso(31)));
      items.push(make('payroll',    'Payroll Year-End Audit',              'Close payroll for the FY',    iso(31)));
      items.push(make('payroll',    'Form 16 / 16A Preparation',           'Begin TDS certificate prep',  iso(31)));
      break;
    // February (2) and August (8): monthly recurring items only.
  }

  return items;
}

// Build the firestore payload for one seed item.
function seedPayload(item: SeedItem) {
  return {
    ...item,
    amount:          null,
    filedAt:         null,
    filedBy:         null,
    referenceNumber: null,
    notes:           null,
    createdAt:       serverTimestamp(),
  };
}

// Deterministic doc ID — the SAME obligation always maps to ONE document, so
// re-seeding can never create duplicates (the old random-id seeding could).
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
function seedDocId(monthStr: string, type: ComplianceType, title: string) {
  return `cmp_${monthStr}_${type}_${slugify(title)}`;
}
// Content key for matching legacy/random-id rows to an obligation.
const contentKey = (r: { type?: string; title?: string; dueDate?: string }) =>
  `${r.type ?? ''}|${r.title ?? ''}|${r.dueDate ?? ''}`;

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

  const meta  = metaFor(record.type);
  const title = record.title ?? meta.title;

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

  const inp = 'w-full text-sm border border-(--shell-border) rounded-lg px-3 py-2 bg-(--glass-panel-bg) outline-none focus:ring-2 focus:ring-navy/10';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <div className="rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl" style={{ backgroundColor: 'var(--glass-panel-bg)' }}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Mark as Filed</h3>
          <button onClick={onClose}><X size={18} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{title}</span>
          {' — '}Due {format(parseISO(record.dueDate), 'd MMM yyyy')}
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest block mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Challan / Reference No. <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <input className={inp} value={refNum}
              onChange={(e) => { setRefNum(e.target.value); setErr(''); }}
              placeholder="e.g. 0123456789" />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest block mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Amount Deposited (₹, optional)
            </label>
            <input className={inp} type="number" min={0} value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 45000" />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest block mb-1.5" style={{ color: 'var(--text-muted)' }}>
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
            className="text-sm px-4 py-2 rounded-lg border border-(--shell-border)"
            style={{ color: 'var(--text-primary)' }}>Cancel</button>
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
  const meta  = metaFor(record.type);
  const title = record.title ?? meta.title;
  const filedDate = record.filedAt
    ? format((record.filedAt as { toDate(): Date }).toDate(), 'd MMM yyyy')
    : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <div className="rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl" style={{ backgroundColor: 'var(--glass-panel-bg)' }}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Filing Details</h3>
          <button onClick={onClose}><X size={18} style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        <div className="space-y-3 text-sm" style={{ color: 'var(--text-primary)' }}>
          <div className="flex justify-between gap-4">
            <span style={{ color: 'var(--text-muted)' }}>Obligation</span>
            <span className="font-medium text-right">{title}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>Category</span>
            <span>{meta.title}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>Due Date</span>
            <span style={{ color: '#DC2626', fontWeight: 600 }}>{format(parseISO(record.dueDate), 'd MMM yyyy')}</span>
          </div>
          {record.referenceNumber && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Reference No.</span>
              <span className="font-mono">{record.referenceNumber}</span>
            </div>
          )}
          {record.amount != null && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Amount</span>
              <span>₹{record.amount.toLocaleString('en-IN')}</span>
            </div>
          )}
          {filedDate && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Filed On</span>
              <span>{filedDate}</span>
            </div>
          )}
          {record.notes && (
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Notes</span>
              <p className="mt-1 p-3 rounded-lg text-xs" style={{ backgroundColor: 'var(--glass-panel-bg)' }}>{record.notes}</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end mt-6">
          <button onClick={onEdit}
            className="text-sm px-4 py-2 rounded-lg border border-(--shell-border)"
            style={{ color: 'var(--text-primary)' }}>Edit</button>
          <button onClick={onClose}
            className="text-sm px-5 py-2 rounded-lg font-semibold"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Compliance Card (used in List view + Day modal) ──────────────────────────

function ComplianceCard({ record, onMarkFiled, onView }: {
  record: ComplianceRecord;
  onMarkFiled: () => void;
  onView: () => void;
}) {
  const meta   = metaFor(record.type);
  const title  = record.title ?? meta.title;
  const status = computeStatus(record.dueDate, record.filedAt);
  const sm     = STATUS_META[status];
  const Icon   = meta.icon;

  const dueFmt = format(parseISO(record.dueDate), 'd MMM yyyy');
  const filedDate = record.filedAt
    ? format((record.filedAt as { toDate(): Date }).toDate(), 'd MMM yyyy')
    : null;

  return (
    <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-5 flex flex-col gap-4 hover:shadow-sm transition-shadow">
      {/* Top row: icon + title + status pill */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${meta.iconColor}18` }}>
          <Icon size={18} style={{ color: meta.iconColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>{title}</p>
          <p className="text-[11px] font-semibold uppercase tracking-wider mt-0.5" style={{ color: meta.iconColor }}>{meta.title}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{record.description}</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0"
          style={{ backgroundColor: sm.bg, color: sm.text }}>
          {sm.label}
        </span>
      </div>

      {/* Due date */}
      <div className="flex items-center gap-1.5 text-xs">
        <Clock size={12} style={{ color: 'var(--text-muted)' }} />
        <span style={{ color: 'var(--text-muted)' }}>Due </span>
        <span style={{ color: status === 'filed' ? '#059669' : '#DC2626', fontWeight: 600 }}>{dueFmt}</span>
      </div>

      {/* Filed info — green TINT (not fixed pastel) so var(--text-muted) labels
          stay readable in both themes; values use a mid-green that works on both. */}
      {status === 'filed' && (
        <div className="rounded-lg p-3 text-xs space-y-1" style={{ backgroundColor: 'rgba(52,211,153,0.10)' }}>
          {record.referenceNumber && (
            <p><span style={{ color: 'var(--text-muted)' }}>Ref: </span>
              <span className="font-mono font-medium" style={{ color: '#059669' }}>{record.referenceNumber}</span></p>
          )}
          {record.amount != null && (
            <p><span style={{ color: 'var(--text-muted)' }}>Amount: </span>
              <span style={{ color: '#059669' }}>₹{record.amount.toLocaleString('en-IN')}</span></p>
          )}
          {filedDate && (
            <p><span style={{ color: 'var(--text-muted)' }}>Filed: </span>
              <span style={{ color: '#059669' }}>{filedDate}</span></p>
          )}
        </div>
      )}

      {/* Action */}
      <div className="flex gap-2 mt-auto">
        {status !== 'filed' ? (
          <button onClick={onMarkFiled}
            className="flex-1 text-xs font-semibold py-2 rounded-lg transition-colors"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            Mark as Filed
          </button>
        ) : (
          <button onClick={onView}
            className="flex-1 text-xs font-semibold py-2 rounded-lg border transition-colors"
            style={{ border: '1px solid var(--shell-border)', color: 'var(--text-muted)' }}>
            View Details
          </button>
        )}
        {status === 'filed' && (
          <button onClick={onMarkFiled}
            className="text-xs font-medium px-3 py-2 rounded-lg border"
            style={{ border: '1px solid var(--shell-border)', color: 'var(--text-muted)' }}>
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Calendar grid ────────────────────────────────────────────────────────────

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function CalendarGrid({ year, month, records, onOpenDay }: {
  year: number;
  month: number;
  records: ComplianceRecord[];
  onOpenDay: (dateKey: string, items: ComplianceRecord[]) => void;
}) {
  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 1 }),
    end:   endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 }),
  });

  const byDate = new Map<string, ComplianceRecord[]>();
  records.forEach((r) => {
    const arr = byDate.get(r.dueDate) ?? [];
    arr.push(r);
    byDate.set(r.dueDate, arr);
  });

  return (
    <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-3 sm:p-4">
      {/* Weekday header */}
      <div className="grid grid-cols-7 mb-2">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[10px] sm:text-xs font-semibold uppercase tracking-wider py-1"
            style={{ color: 'var(--text-muted)' }}>
            {w}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {days.map((day) => {
          const key     = format(day, 'yyyy-MM-dd');
          const items   = byDate.get(key) ?? [];
          const inMonth = isSameMonth(day, monthStart);
          const today   = isToday(day);
          const hasOverdue = items.some((r) => computeStatus(r.dueDate, r.filedAt) === 'overdue');
          const allFiled   = items.length > 0 && items.every((r) => computeStatus(r.dueDate, r.filedAt) === 'filed');

          const borderColor = today ? '#C9A961'
            : hasOverdue ? '#FCA5A5'
            : allFiled ? '#86EFAC'
            : 'var(--shell-border)';

          return (
            <button
              key={key}
              onClick={() => items.length && onOpenDay(key, items)}
              disabled={!items.length}
              className="text-left rounded-lg border p-1.5 min-h-[78px] sm:min-h-[96px] flex flex-col transition-colors disabled:cursor-default"
              style={{
                borderColor,
                borderWidth: today ? 2 : 1,
                backgroundColor: inMonth ? 'transparent' : 'transparent',
                opacity: inMonth ? 1 : 0.4,
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold"
                  style={{ color: today ? '#C9A961' : 'var(--text-primary)' }}>
                  {format(day, 'd')}
                </span>
                {items.length > 0 && (
                  <span className="text-[9px] font-bold px-1 rounded-full"
                    style={{ backgroundColor: hasOverdue ? '#FEE2E2' : allFiled ? '#D1FAE5' : 'var(--shell-hover-hard)',
                             color: hasOverdue ? '#991B1B' : allFiled ? '#065F46' : 'var(--text-muted)' }}>
                    {items.length}
                  </span>
                )}
              </div>

              {/* chips */}
              <div className="mt-1 space-y-0.5 overflow-hidden">
                {items.slice(0, 3).map((r) => {
                  const st = computeStatus(r.dueDate, r.filedAt);
                  return (
                    <div key={r.id} className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_META[st].dot }} />
                      <span className="text-[9px] sm:text-[10px] truncate leading-tight"
                        style={{ color: 'var(--text-primary)', textDecoration: st === 'filed' ? 'line-through' : 'none' }}>
                        {r.title ?? metaFor(r.type).title}
                      </span>
                    </div>
                  );
                })}
                {items.length > 3 && (
                  <div className="text-[9px] font-medium" style={{ color: 'var(--text-muted)' }}>
                    +{items.length - 3} more
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-(--shell-border) text-[10px]"
        style={{ color: 'var(--text-muted)' }}>
        {([['overdue', 'Overdue'], ['due_soon', 'Due soon'], ['upcoming', 'Upcoming'], ['filed', 'Filed']] as Array<[ComplianceStatus, string]>).map(
          ([s, label]) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_META[s].dot }} />
              {label}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

// ─── Day Detail Modal — every obligation due on a clicked day ──────────────────

function DayDetailModal({ dateKey, items, onClose, onMarkFiled, onView }: {
  dateKey: string;
  items: ComplianceRecord[];
  onClose: () => void;
  onMarkFiled: (r: ComplianceRecord) => void;
  onView: (r: ComplianceRecord) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <div className="rounded-2xl w-full max-w-lg shadow-xl flex flex-col max-h-[85vh]" style={{ backgroundColor: 'var(--glass-panel-bg)' }}>
        <div className="flex items-center justify-between p-5 border-b border-(--shell-border)">
          <div>
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {format(parseISO(dateKey), 'EEEE, d MMMM yyyy')}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {items.length} filing{items.length === 1 ? '' : 's'} due
            </p>
          </div>
          <button onClick={onClose}><X size={18} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          {items.map((r) => (
            <ComplianceCard key={r.id} record={r} onMarkFiled={() => onMarkFiled(r)} onView={() => onView(r)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── useOverdueComplianceCount — exported for HrmsShell badge ─────────────────

export function useOverdueComplianceCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const q = query(collection(db, 'compliance_records'), where('filedAt', '==', null));
    getDocs(q).then((snap) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const overdue = snap.docs.filter((d) => parseISO(d.data().dueDate as string) < today);
      setCount(overdue.length);
    }).catch(() => setCount(0));
  }, [enabled]);

  return count;
}

// ─── Key dates reference table (CA, FY 2026-27) ───────────────────────────────

const KEY_DATES: Array<[string, string]> = [
  ['TDS deposit', '7th of next month (March → 30 Apr)'],
  ['PT — Telangana', 'Deposit + return by 10th; annual Form V by 10 Apr'],
  ['Provident Fund', '15th; annual Form 3A/6A by 30 Apr–31 May'],
  ['ESI', '15th; half-yearly Form 5 by 11 Apr & 11 Oct'],
  ['GST', 'GSTR-1 11th · GSTR-3B 20th · GSTR-9 by 31 Dec'],
  ['Advance Tax', '15% Jun · 45% Sep · 75% Dec · 100% Mar (all 15th)'],
  ['TDS returns', 'Q1 31 Jul · Q2 31 Oct · Q3 31 Jan · Q4 31 May'],
  ['Income Tax', 'ITR (non-audit) 31 Jul · Tax Audit 30 Sep · ITR-6 31 Oct'],
  ['MCA / ROC', 'AGM 30 Sep · ADT-1 +15d · AOC-4 +30d · MGT-7 +60d · DIR-3 KYC 30 Sep'],
  ['Board meetings', '≥ 4/year, max 120-day gap (Jun/Sep/Dec/Mar)'],
  ['Salary', 'Paid 1st–7th; processed on the last working day prior'],
];

function KeyDatesTable() {
  return (
    <div className="mt-8 bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
      <div className="px-5 py-3 border-b border-(--shell-border) flex items-center gap-2">
        <Info size={15} style={{ color: '#C9A961' }} />
        <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
          Key dates &amp; rules — CA calendar, FY 2026-27
        </h3>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left font-semibold uppercase tracking-wider px-5 py-2 w-44"
              style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--shell-border)' }}>Obligation</th>
            <th className="text-left font-semibold uppercase tracking-wider px-5 py-2"
              style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--shell-border)' }}>Due dates</th>
          </tr>
        </thead>
        <tbody>
          {KEY_DATES.map(([label, rule], i) => (
            <tr key={label} style={{ backgroundColor: i % 2 ? 'transparent' : 'rgba(148,163,184,0.06)' }}>
              <td className="px-5 py-2 font-semibold align-top" style={{ color: 'var(--text-primary)' }}>{label}</td>
              <td className="px-5 py-2 font-medium" style={{ color: '#DC2626' }}>{rule}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] px-5 py-3 border-t border-(--shell-border)" style={{ color: 'var(--text-muted)' }}>
        Finvastra Advisors Pvt. Ltd. · Hyderabad, Telangana · Financial Services. Dates per the firm's CA.
        The calendar auto-updates to the latest schedule each month — no manual action needed.
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ComplianceCalendarPage() {
  const { user, profile } = useAuth();

  // ── All hooks unconditionally at the top — Rules of Hooks ───────────────────
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [records,     setRecords]     = useState<ComplianceRecord[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [seeding,     setSeeding]     = useState(false);
  const [view,        setView]        = useState<'calendar' | 'list'>('calendar');

  const [markFiledFor, setMarkFiledFor] = useState<ComplianceRecord | null>(null);
  const [viewFor,      setViewFor]      = useState<ComplianceRecord | null>(null);
  const [dayModal,     setDayModal]     = useState<{ date: string; items: ComplianceRecord[] } | null>(null);

  const year  = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1; // 1-indexed
  const monthStr = `${year}-${pad2(month)}`;
  const monthLabel = format(currentDate, 'MMMM yyyy');

  // ── Load records for the current month (auto-seed + auto-resync stale) ───────

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'compliance_records'), where('month', '==', monthStr)),
      );
      const existing = snap.docs;
      const existingById = new Map(existing.map((d) => [d.id, d]));
      // Obligations already FILED (any id/format) — never re-create or delete these.
      const filedKeys = new Set(
        existing.filter((d) => d.data().filedAt).map((d) => contentKey(d.data())),
      );

      const expected = generateComplianceItems(year, month);
      const expectedIds = new Set<string>();
      const ops: Promise<unknown>[] = [];

      // 1. Ensure each expected obligation exists exactly once (deterministic id).
      for (const item of expected) {
        const id = seedDocId(monthStr, item.type, item.title ?? '');
        expectedIds.add(id);
        const ex = existingById.get(id);
        if (ex) {
          const x = ex.data();
          // Refresh only stale UNFILED canonical rows; never touch filed ones.
          if (!x.filedAt && (x.seedVersion ?? 0) < SEED_VERSION) {
            ops.push(setDoc(doc(db, 'compliance_records', id), seedPayload(item)));
          }
        } else if (!filedKeys.has(contentKey(item))) {
          ops.push(setDoc(doc(db, 'compliance_records', id), seedPayload(item)));
        }
      }

      // 2. Delete leftover UNFILED rows that aren't part of the current schedule
      //    (old conventions / random-id duplicates). Filed history is preserved.
      for (const d of existing) {
        if (!expectedIds.has(d.id) && !d.data().filedAt) {
          ops.push(deleteDoc(doc(db, 'compliance_records', d.id)));
        }
      }

      if (ops.length > 0) {
        setSeeding(true);
        await Promise.all(ops);
        setSeeding(false);
        const snap2 = await getDocs(
          query(collection(db, 'compliance_records'), where('month', '==', monthStr)),
        );
        setRecords(snap2.docs.map((d) => ({ id: d.id, ...d.data() }) as ComplianceRecord));
      } else {
        setRecords(existing.map((d) => ({ id: d.id, ...d.data() }) as ComplianceRecord));
      }
    } finally {
      setLoading(false);
    }
  }, [monthStr, year, month]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  // Keep an open Day modal in sync after a record changes (e.g. marked filed).
  useEffect(() => {
    setDayModal((prev) => prev ? { ...prev, items: records.filter((r) => r.dueDate === prev.date) } : prev);
  }, [records]);

  // ── Auth guard (after all hooks) ─────────────────────────────────────────────
  if (profile && profile.role !== 'admin' && !profile.isHrmsManager) {
    return <Navigate to="/hrms/dashboard" replace />;
  }

  // ── Summary counts (computed live from dueDate, not stored status) ───────────

  const summary = records.reduce(
    (acc, r) => { acc[computeStatus(r.dueDate, r.filedAt)]++; return acc; },
    { overdue: 0, due_soon: 0, filed: 0, upcoming: 0 } as Record<ComplianceStatus, number>,
  );

  // ── List view ordering: overdue → due_soon → upcoming → filed ───────────────

  const sortOrder: Record<ComplianceStatus, number> = { overdue: 0, due_soon: 1, upcoming: 2, filed: 3 };
  const sorted = [...records].sort((a, b) => {
    const sa = computeStatus(a.dueDate, a.filedAt);
    const sb = computeStatus(b.dueDate, b.filedAt);
    if (sortOrder[sa] !== sortOrder[sb]) return sortOrder[sa] - sortOrder[sb];
    return a.dueDate.localeCompare(b.dueDate);
  });

  const busy = loading || seeding;

  return (
    <div className="max-w-5xl">

      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl mb-1" style={{
          fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic',
          fontWeight: 300, color: 'var(--text-primary)',
        }}>
          Compliance Calendar
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Every statutory deadline — TDS/TCS, GST, Income Tax, PF, ESI, PT &amp; MCA/ROC · CA calendar FY 2026-27
        </p>
      </div>

      {/* Month navigator + view toggle */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button
          onClick={() => setCurrentDate((d) => subMonths(d, 1))}
          className="p-2 rounded-lg hover:bg-(--glass-panel-bg) transition-colors"
          style={{ color: 'var(--text-muted)' }}>
          <ChevronLeft size={18} />
        </button>
        <span className="text-base font-semibold w-36 text-center" style={{ color: 'var(--text-primary)' }}>
          {monthLabel}
        </span>
        <button
          onClick={() => setCurrentDate((d) => addMonths(d, 1))}
          className="p-2 rounded-lg hover:bg-(--glass-panel-bg) transition-colors"
          style={{ color: 'var(--text-muted)' }}>
          <ChevronRight size={18} />
        </button>
        <button
          onClick={() => setCurrentDate(new Date())}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-(--shell-border)"
          style={{ color: 'var(--text-muted)' }}>
          Today
        </button>

        {/* Calendar / List segmented toggle */}
        <div className="ml-auto flex rounded-lg border border-(--shell-border) overflow-hidden">
          {([['calendar', CalendarDays, 'Calendar'], ['list', List, 'List']] as Array<[typeof view, ElementType, string]>).map(
            ([v, Icon, label]) => (
              <button key={v} onClick={() => setView(v)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 transition-colors"
                style={{
                  backgroundColor: view === v ? '#0B1538' : 'transparent',
                  color: view === v ? '#C9A961' : 'var(--text-muted)',
                }}>
                <Icon size={14} /> {label}
              </button>
            ),
          )}
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {([
          { key: 'overdue',  label: 'Overdue',  bg: '#FEE2E2', text: '#991B1B', icon: AlertCircle  },
          { key: 'due_soon', label: 'Due Soon', bg: '#FEF3C7', text: '#92400E', icon: Clock         },
          { key: 'filed',    label: 'Filed',    bg: '#D1FAE5', text: '#065F46', icon: CheckCircle2  },
          { key: 'upcoming', label: 'Upcoming', bg: 'var(--shell-hover-hard)', text: 'var(--text-muted)', icon: Clock         },
        ] as Array<{ key: ComplianceStatus; label: string; bg: string; text: string; icon: ElementType }>).map(
          ({ key, label, bg, text, icon: Icon }) => (
            <div key={key} className="rounded-2xl p-4 flex items-center gap-3" style={{ backgroundColor: bg }}>
              <Icon size={18} style={{ color: text }} />
              <div>
                <p className="text-xl font-bold" style={{ color: text }}>{summary[key]}</p>
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: text }}>{label}</p>
              </div>
            </div>
          ),
        )}
      </div>

      {/* Loading */}
      {busy && (
        <div className="text-sm text-center py-16" style={{ color: 'var(--text-muted)' }}>
          {seeding ? 'Updating to the latest CA calendar…' : 'Loading…'}
        </div>
      )}

      {/* Calendar view */}
      {!busy && view === 'calendar' && (
        records.length === 0
          ? <p className="text-center py-16 text-sm" style={{ color: 'var(--text-muted)' }}>No compliance items for this month.</p>
          : <CalendarGrid year={year} month={month} records={records}
              onOpenDay={(date, items) => setDayModal({ date, items })} />
      )}

      {/* List view */}
      {!busy && view === 'list' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((record) => (
            <ComplianceCard key={record.id} record={record}
              onMarkFiled={() => setMarkFiledFor(record)} onView={() => setViewFor(record)} />
          ))}
          {sorted.length === 0 && (
            <p className="col-span-3 text-center py-16 text-sm" style={{ color: 'var(--text-muted)' }}>
              No compliance items for this month.
            </p>
          )}
        </div>
      )}

      {/* Key dates reference */}
      {!busy && <KeyDatesTable />}

      {/* Day detail modal */}
      {dayModal && (
        <DayDetailModal
          dateKey={dayModal.date}
          items={dayModal.items}
          onClose={() => setDayModal(null)}
          onMarkFiled={(r) => setMarkFiledFor(r)}
          onView={(r) => setViewFor(r)}
        />
      )}

      {/* Mark filed / view modals (render last → stack on top of day modal) */}
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
