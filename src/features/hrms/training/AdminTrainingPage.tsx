/**
 * AdminTrainingPage — Manage training programs and track employee completion.
 * Path: /hrms/admin/training    Access: admin + isHrmsManager
 *
 * Tab 1 "Programs": create / edit / toggle training programs (AMFI, IRDA, NCFM, etc.)
 * Tab 2 "Records" : enroll employees, mark completions, filter by status / program
 */

import { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import { BookOpen, Plus, CheckCircle2, Clock, AlertCircle, Search, ToggleLeft, ToggleRight, X, ExternalLink } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useTrainingPrograms, useAllTrainingRecords, createTrainingProgram, updateTrainingProgram, enrollEmployee, markTrainingComplete } from '../hooks/useTraining';
import type { TrainingCategory, TrainingProgram, TrainingRecord } from '../../../types';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { PageHeader } from '../../../components/ui/primitives';

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<TrainingCategory, { label: string; color: string; bg: string }> = {
  compliance:    { label: 'Compliance',    color: '#B45309', bg: '#FEF3C7' },
  certification: { label: 'Certification', color: '#0369A1', bg: '#E0F2FE' },
  skills:        { label: 'Skills',        color: '#065F46', bg: '#D1FAE5' },
  induction:     { label: 'Induction',     color: '#4C1D95', bg: '#EDE9FE' },
  safety:        { label: 'Safety',        color: '#9F1239', bg: '#FFE4E6' },
  other:         { label: 'Other',         color: '#374151', bg: '#F3F4F6' },
};

const STATUS_META: Record<TrainingRecord['status'], { label: string; color: string; icon: React.ElementType }> = {
  enrolled:  { label: 'Pending',   color: '#D97706', icon: Clock         },
  completed: { label: 'Completed', color: '#059669', icon: CheckCircle2  },
  expired:   { label: 'Expired',   color: '#DC2626', icon: AlertCircle   },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function CategoryPill({ cat }: { cat: TrainingCategory }) {
  const m = CATEGORY_META[cat];
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ color: m.color, backgroundColor: m.bg }}>
      {m.label}
    </span>
  );
}

function StatusPill({ status }: { status: TrainingRecord['status'] }) {
  const m = STATUS_META[status];
  const Ic = m.icon;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ color: m.color, backgroundColor: m.color + '18' }}>
      <Ic size={10} />
      {m.label}
    </span>
  );
}

// ── Add/Edit Program Modal ────────────────────────────────────────────────────

interface ProgramForm {
  name: string;
  category: TrainingCategory;
  description: string;
  durationHours: string;
  isMandatory: boolean;
  renewalPeriodMonths: string;
}

const BLANK_PROGRAM: ProgramForm = {
  name: '', category: 'compliance', description: '',
  durationHours: '', isMandatory: false, renewalPeriodMonths: '',
};

function ProgramModal({
  existing,
  onClose,
  onSave,
}: {
  existing: TrainingProgram | null;
  onClose: () => void;
  onSave: (f: ProgramForm) => Promise<void>;
}) {
  const [form, setForm] = useState<ProgramForm>(
    existing
      ? {
          name: existing.name,
          category: existing.category,
          description: existing.description ?? '',
          durationHours: existing.durationHours != null ? String(existing.durationHours) : '',
          isMandatory: existing.isMandatory,
          renewalPeriodMonths: existing.renewalPeriodMonths != null ? String(existing.renewalPeriodMonths) : '',
        }
      : BLANK_PROGRAM,
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof ProgramForm>(k: K, v: ProgramForm[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Required';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try { await onSave(form); onClose(); }
    catch { setSaving(false); }
  };

  const inp = (f?: string) =>
    `w-full text-sm px-3.5 py-2.5 border rounded-lg outline-none focus:ring-2 bg-(--glass-panel-bg) transition-colors ${
      f && errors[f] ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30'
                      : 'border-(--shell-border) focus:ring-[#0B1538]'}`;

  const lbl = (text: string, f?: string, req = false) => (
    <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
      style={{ color: f && errors[f] ? '#DC2626' : 'var(--text-muted)' }}>
      {text}{req && <span className="text-red-500 ml-0.5">*</span>}
      {f && errors[f] && <span className="ml-2 text-red-500 font-medium normal-case tracking-normal">— {errors[f]}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--shell-border)">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {existing ? 'Edit Program' : 'New Training Program'}
          </h2>
          <button onClick={onClose} className="text-(--text-muted) hover:text-(--text-muted)"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            {lbl('Program Name', 'name', true)}
            <input className={inp('name')} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. AMFI Mutual Fund Certification (ARN)" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              {lbl('Category')}
              <select className={inp()} value={form.category} onChange={(e) => set('category', e.target.value as TrainingCategory)}>
                {(Object.keys(CATEGORY_META) as TrainingCategory[]).map((c) => (
                  <option key={c} value={c}>{CATEGORY_META[c].label}</option>
                ))}
              </select>
            </div>
            <div>
              {lbl('Duration (hours)')}
              <input className={inp()} type="number" min="0" value={form.durationHours}
                onChange={(e) => set('durationHours', e.target.value)} placeholder="e.g. 8" />
            </div>
          </div>
          <div>
            {lbl('Description')}
            <textarea className={`${inp()} resize-none`} rows={2} value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Brief description, exam body, validity, etc." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              {lbl('Renewal Period (months)')}
              <input className={inp()} type="number" min="1" value={form.renewalPeriodMonths}
                onChange={(e) => set('renewalPeriodMonths', e.target.value)}
                placeholder="Leave blank if one-time" />
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Blank = no renewal needed</p>
            </div>
            <div className="flex items-center gap-3 pt-5">
              <button
                type="button"
                onClick={() => set('isMandatory', !form.isMandatory)}
                className="flex items-center gap-2 text-sm font-medium transition-colors"
                style={{ color: form.isMandatory ? '#B45309' : 'var(--text-muted)' }}
              >
                {form.isMandatory
                  ? <ToggleRight size={22} style={{ color: '#B45309' }} />
                  : <ToggleLeft  size={22} style={{ color: 'var(--text-muted)' }} />}
                Mandatory
              </button>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-(--shell-border)">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-(--shell-border) hover:bg-(--glass-panel-bg)">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50"
            style={{ backgroundColor: '#0B1538' }}>
            {saving ? 'Saving…' : (existing ? 'Update' : 'Create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Enroll Employee Modal ─────────────────────────────────────────────────────

interface EnrollForm {
  programId: string;
  employeeId: string;
  notes: string;
}

function EnrollModal({
  programs,
  employees,
  onClose,
  onEnroll,
}: {
  programs: TrainingProgram[];
  employees: { uid: string; displayName: string }[];
  onClose: () => void;
  onEnroll: (f: EnrollForm) => Promise<void>;
}) {
  const [form, setForm] = useState<EnrollForm>({ programId: '', employeeId: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [empSearch, setEmpSearch] = useState('');

  const set = <K extends keyof EnrollForm>(k: K, v: EnrollForm[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };

  const filteredEmps = employees.filter((e) =>
    e.displayName.toLowerCase().includes(empSearch.toLowerCase()),
  );

  const handleEnroll = async () => {
    const errs: Record<string, string> = {};
    if (!form.programId)  errs.programId  = 'Select a program';
    if (!form.employeeId) errs.employeeId = 'Select an employee';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try { await onEnroll(form); onClose(); }
    catch { setSaving(false); }
  };

  const inp = (f?: string) =>
    `w-full text-sm px-3.5 py-2.5 border rounded-lg outline-none focus:ring-2 bg-(--glass-panel-bg) transition-colors ${
      f && errors[f] ? 'border-red-400 focus:ring-red-200/50 bg-red-50/30'
                      : 'border-(--shell-border) focus:ring-[#0B1538]'}`;

  const lbl = (text: string, f?: string, req = false) => (
    <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
      style={{ color: f && errors[f] ? '#DC2626' : 'var(--text-muted)' }}>
      {text}{req && <span className="text-red-500 ml-0.5">*</span>}
      {f && errors[f] && <span className="ml-2 text-red-500 font-medium normal-case tracking-normal">— {errors[f]}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--shell-border)">
          <h2 className="text-base font-semibold">Enroll Employee</h2>
          <button onClick={onClose} className="text-(--text-muted) hover:text-(--text-muted)"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            {lbl('Training Program', 'programId', true)}
            <select className={inp('programId')} value={form.programId}
              onChange={(e) => set('programId', e.target.value)}>
              <option value="">Select program…</option>
              {programs.filter((p) => p.isActive).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            {lbl('Employee', 'employeeId', true)}
            <input className="w-full text-sm px-3.5 py-2 border border-(--shell-border) rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538] mb-1"
              placeholder="Search employee…" value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} />
            <select className={inp('employeeId')} value={form.employeeId}
              onChange={(e) => set('employeeId', e.target.value)} size={4}>
              {filteredEmps.map((e) => (
                <option key={e.uid} value={e.uid}>{e.displayName}</option>
              ))}
            </select>
          </div>
          <div>
            {lbl('Notes (optional)')}
            <textarea className={`${inp()} resize-none`} rows={2} value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Any context, exam date, etc." />
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-(--shell-border)">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-(--shell-border) hover:bg-(--glass-panel-bg)">Cancel</button>
          <button onClick={handleEnroll} disabled={saving}
            className="px-5 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50"
            style={{ backgroundColor: '#0B1538' }}>
            {saving ? 'Enrolling…' : 'Enroll'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Mark Complete Modal ───────────────────────────────────────────────────────

function CompleteModal({
  record,
  program,
  onClose,
  onComplete,
}: {
  record: TrainingRecord;
  program: TrainingProgram | undefined;
  onClose: () => void;
  onComplete: (certificateUrl: string | null, notes: string | null) => Promise<void>;
}) {
  const [certUrl, setCertUrl] = useState(record.certificateUrl ?? '');
  const [notes,   setNotes]   = useState(record.notes ?? '');
  const [saving, setSaving]   = useState(false);

  const handleDone = async () => {
    setSaving(true);
    try { await onComplete(certUrl.trim() || null, notes.trim() || null); onClose(); }
    catch { setSaving(false); }
  };

  const inp = 'w-full text-sm px-3.5 py-2.5 border border-(--shell-border) rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538] bg-(--glass-panel-bg)';
  const lbl = (text: string) => (
    <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{text}</label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--shell-border)">
          <h2 className="text-base font-semibold">Mark as Completed</h2>
          <button onClick={onClose} className="text-(--text-muted) hover:text-(--text-muted)"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="p-3 rounded-xl" style={{ backgroundColor: '#F0F9FF' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{record.programName}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{record.employeeName}</p>
            {program?.renewalPeriodMonths && (
              <p className="text-xs mt-1 font-medium" style={{ color: '#0369A1' }}>
                Certificate valid for {program.renewalPeriodMonths} months from today
              </p>
            )}
          </div>
          <div>
            {lbl('Certificate URL (optional)')}
            <input className={inp} value={certUrl} onChange={(e) => setCertUrl(e.target.value)}
              placeholder="https://drive.google.com/…" />
          </div>
          <div>
            {lbl('Notes (optional)')}
            <textarea className={`${inp} resize-none`} rows={2} value={notes}
              onChange={(e) => setNotes(e.target.value)} placeholder="Exam score, certificate number, etc." />
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-(--shell-border)">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-(--shell-border) hover:bg-(--glass-panel-bg)">Cancel</button>
          <button onClick={handleDone} disabled={saving}
            className="px-5 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50"
            style={{ backgroundColor: '#059669' }}>
            {saving ? 'Saving…' : '✓ Mark Complete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AdminTrainingPage() {
  const { user, profile } = useAuth();
  const isAdmin      = profile?.role === 'admin';
  const isHrManager  = profile?.isHrmsManager === true;
  if (!isAdmin && !isHrManager) return <Navigate to="/hrms/dashboard" replace />;

  const { programs, loading: progLoading } = useTrainingPrograms();
  const { records,  loading: recLoading  } = useAllTrainingRecords();

  const [tab, setTab] = useState<'programs' | 'records'>('programs');

  // Programs tab state
  const [showAddProgram,  setShowAddProgram]  = useState(false);
  const [editingProgram,  setEditingProgram]  = useState<TrainingProgram | null>(null);

  // Records tab state
  const [showEnroll,      setShowEnroll]      = useState(false);
  const [completingRec,   setCompletingRec]   = useState<TrainingRecord | null>(null);
  const [recStatusFilter, setRecStatusFilter] = useState<'all' | TrainingRecord['status']>('all');
  const [recProgramId,    setRecProgramId]    = useState('');
  const [recSearch,       setRecSearch]       = useState('');

  // Employee list for enroll modal
  const [employees, setEmployees] = useState<{ uid: string; displayName: string }[]>([]);
  const loadEmployees = async () => {
    if (employees.length) return;
    const snap = await getDocs(query(collection(db, 'users'), where('status', '==', 'active')));
    setEmployees(
      snap.docs
        .map((d) => ({ uid: d.id, displayName: (d.data().displayName as string) ?? d.id }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    );
  };

  // ── Records filtering ─────────────────────────────────────────────────────
  const now = new Date();
  const filteredRecords = useMemo(() => {
    // Compute effective status (check expiry)
    const enriched = records.map((r) => {
      let effectiveStatus: TrainingRecord['status'] = r.status;
      if (r.status === 'completed' && r.expiresAt && r.expiresAt.toDate() < now) {
        effectiveStatus = 'expired';
      }
      return { ...r, status: effectiveStatus };
    });

    return enriched.filter((r) => {
      if (recStatusFilter !== 'all' && r.status !== recStatusFilter) return false;
      if (recProgramId && r.programId !== recProgramId) return false;
      if (recSearch && !r.employeeName.toLowerCase().includes(recSearch.toLowerCase())) return false;
      return true;
    });
  }, [records, recStatusFilter, recProgramId, recSearch, now]);

  const enrolledCount   = records.filter((r) => r.status === 'enrolled').length;
  const completedCount  = records.filter((r) => r.status === 'completed').length;
  const expiredCount    = records.filter((r) => {
    return r.status === 'completed' && r.expiresAt && r.expiresAt.toDate() < now;
  }).length;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSaveProgram = async (f: ProgramForm) => {
    const data = {
      name:               f.name.trim(),
      category:           f.category,
      description:        f.description.trim() || null,
      durationHours:      f.durationHours ? Number(f.durationHours) : null,
      isMandatory:        f.isMandatory,
      renewalPeriodMonths: f.renewalPeriodMonths ? Number(f.renewalPeriodMonths) : null,
    };
    if (editingProgram) await updateTrainingProgram(editingProgram.id, data);
    else                await createTrainingProgram(data, user!.uid);
    setEditingProgram(null);
  };

  const handleEnroll = async (f: EnrollForm) => {
    const prog  = programs.find((p) => p.id === f.programId)!;
    const emp   = employees.find((e) => e.uid === f.employeeId)!;
    await enrollEmployee(
      {
        programId:       prog.id,
        programName:     prog.name,
        programCategory: prog.category,
        employeeId:      emp.uid,
        employeeName:    emp.displayName,
        notes:           f.notes.trim() || null,
      },
      user!.uid,
    );
  };

  const handleComplete = async (r: TrainingRecord, certUrl: string | null, notes: string | null) => {
    const prog = programs.find((p) => p.id === r.programId);
    await markTrainingComplete(r.id, prog?.renewalPeriodMonths ?? null, { certificateUrl: certUrl, notes }, user!.uid);
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const activePrograms   = programs.filter((p) => p.isActive).length;
  const mandatoryPrograms = programs.filter((p) => p.isMandatory && p.isActive).length;

  return (
    <div className="space-y-6">

      {/* Header */}
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: '#0B1538' }}>
              <BookOpen size={20} style={{ color: '#C9A961' }} />
            </span>
            Training &amp; Development
          </span>
        }
        subtitle="Manage training programs and track employee completion"
        pinKey="hrms.training-admin"
        actions={
          <>
            {tab === 'programs' && (
              <button onClick={() => setShowAddProgram(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-white"
                style={{ backgroundColor: '#0B1538' }}>
                <Plus size={15} />New Program
              </button>
            )}
            {tab === 'records' && (
              <button onClick={() => { loadEmployees(); setShowEnroll(true); }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-white"
                style={{ backgroundColor: '#0B1538' }}>
                <Plus size={15} />Enroll Employee
              </button>
            )}
          </>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Active Programs',   value: activePrograms,    color: 'var(--text-primary)', sub: `${mandatoryPrograms} mandatory` },
          { label: 'Pending Completion',value: enrolledCount,     color: '#D97706', sub: 'enrolled, not completed' },
          { label: 'Completed',         value: completedCount,    color: '#059669', sub: 'all time'                },
          { label: 'Expired',           value: expiredCount,      color: '#DC2626', sub: 'need renewal'            },
        ].map(({ label, value, color, sub }) => (
          <div key={label} className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p className="text-3xl font-bold" style={{ color }}>{value}</p>
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-(--glass-panel-bg) p-1 rounded-xl w-fit">
        {(['programs', 'records'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-1.5 text-sm font-semibold rounded-lg transition-all capitalize ${
              tab === t ? 'bg-(--glass-panel-bg) shadow-sm text-[#0A0A0A]' : 'text-(--text-muted) hover:text-(--text-primary)'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* ── Programs Tab ── */}
      {tab === 'programs' && (
        <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
          {progLoading ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          ) : programs.length === 0 ? (
            <div className="p-12 text-center">
              <BookOpen size={32} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>No programs yet</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Create your first training program — e.g. AMFI, IRDA, POSH.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--shell-border)" style={{ backgroundColor: '#F8F9FC' }}>
                  {['Program', 'Category', 'Duration', 'Renewal', 'Mandatory', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-(--shell-border)">
                {programs.map((p) => (
                  <tr key={p.id} className="hover:bg-(--glass-panel-bg) transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                      {p.description && <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--text-muted)' }}>{p.description}</p>}
                    </td>
                    <td className="px-4 py-3"><CategoryPill cat={p.category} /></td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-primary)' }}>
                      {p.durationHours != null ? `${p.durationHours}h` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-primary)' }}>
                      {p.renewalPeriodMonths != null ? `Every ${p.renewalPeriodMonths}m` : 'One-time'}
                    </td>
                    <td className="px-4 py-3">
                      {p.isMandatory
                        ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: '#B45309', backgroundColor: '#FEF3C7' }}>Required</span>
                        : <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Optional</span>}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => updateTrainingProgram(p.id, { isActive: !p.isActive })}
                        className="flex items-center gap-1.5 text-xs font-medium transition-colors"
                        style={{ color: p.isActive ? '#059669' : '#DC2626' }}>
                        {p.isActive ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        {p.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setEditingProgram(p)}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Records Tab ── */}
      {tab === 'records' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Status chips */}
            <div className="flex gap-1">
              {(['all', 'enrolled', 'completed', 'expired'] as const).map((s) => (
                <button key={s} onClick={() => setRecStatusFilter(s)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition-colors ${
                    recStatusFilter === s ? 'text-white' : 'bg-(--glass-panel-bg) border border-(--shell-border) hover:bg-(--glass-panel-bg)'}`}
                  style={recStatusFilter === s ? {
                    backgroundColor: s === 'enrolled' ? '#D97706' : s === 'completed' ? '#059669' : s === 'expired' ? '#DC2626' : '#0B1538',
                  } : {}}>
                  {s === 'enrolled' ? 'Pending' : s}
                </button>
              ))}
            </div>
            {/* Program filter */}
            <select className="text-xs px-3 py-1.5 border border-(--shell-border) rounded-lg bg-(--glass-panel-bg) outline-none focus:ring-2 focus:ring-[#0B1538]"
              value={recProgramId} onChange={(e) => setRecProgramId(e.target.value)}>
              <option value="">All programs</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {/* Employee search */}
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input className="pl-8 pr-3 py-1.5 text-xs border border-(--shell-border) rounded-lg bg-(--glass-panel-bg) outline-none focus:ring-2 focus:ring-[#0B1538]"
                placeholder="Search employee…" value={recSearch} onChange={(e) => setRecSearch(e.target.value)} />
            </div>
          </div>

          {/* Table */}
          <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
            {recLoading ? (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
            ) : filteredRecords.length === 0 ? (
              <div className="p-12 text-center">
                <CheckCircle2 size={32} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>No records match the filters</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--shell-border)" style={{ backgroundColor: '#F8F9FC' }}>
                    {['Employee', 'Program', 'Status', 'Enrolled', 'Completed', 'Expires', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--shell-border)">
                  {filteredRecords.map((r) => (
                    <tr key={r.id} className="hover:bg-(--glass-panel-bg) transition-colors">
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{r.employeeName}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{r.programName}</p>
                        <CategoryPill cat={r.programCategory} />
                      </td>
                      <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {r.enrolledAt ? format(r.enrolledAt.toDate(), 'd MMM yy') : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {r.completedAt ? format(r.completedAt.toDate(), 'd MMM yy') : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: r.expiresAt && r.expiresAt.toDate() < now ? '#DC2626' : 'var(--text-muted)' }}>
                        {r.expiresAt ? format(r.expiresAt.toDate(), 'd MMM yy') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {r.status === 'enrolled' && (
                            <button onClick={() => setCompletingRec(r)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
                              style={{ backgroundColor: '#059669' }}>
                              Mark Done
                            </button>
                          )}
                          {r.certificateUrl && (
                            <a href={r.certificateUrl} target="_blank" rel="noopener noreferrer"
                              className="text-xs font-medium px-2 py-1.5 rounded-lg border border-(--shell-border) hover:bg-(--glass-panel-bg) flex items-center gap-1 transition-colors"
                              style={{ color: '#0369A1' }}>
                              <ExternalLink size={11} />Cert
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {(showAddProgram || editingProgram) && (
        <ProgramModal
          existing={editingProgram}
          onClose={() => { setShowAddProgram(false); setEditingProgram(null); }}
          onSave={handleSaveProgram}
        />
      )}

      {showEnroll && (
        <EnrollModal
          programs={programs}
          employees={employees}
          onClose={() => setShowEnroll(false)}
          onEnroll={handleEnroll}
        />
      )}

      {completingRec && (
        <CompleteModal
          record={completingRec}
          program={programs.find((p) => p.id === completingRec.programId)}
          onClose={() => setCompletingRec(null)}
          onComplete={(url, notes) => handleComplete(completingRec, url, notes)}
        />
      )}
    </div>
  );
}
