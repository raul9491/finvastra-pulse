import { useState, useEffect, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { differenceInDays, parseISO, format, addMonths } from 'date-fns';
import { jsPDF } from 'jspdf';
import { GraduationCap, AlertCircle, Clock, Star, Download, X } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useProbationRecords, ensureProbationRecord, submitProbationEvaluation, confirmProbation, extendProbation } from '../hooks/useProbation';
import type { ProbationRecord, ProbationStatus, UserProfile } from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate();
  }
  return null;
}

function fmtDate(d: string): string {
  try { return format(parseISO(d), 'd MMM yyyy'); } catch { return d; }
}

function daysInfo(record: ProbationRecord): { days: number; overdue: boolean; label: string } {
  const today = new Date();
  const end = parseISO(record.status === 'extended' && record.extensionEndDate
    ? record.extensionEndDate
    : record.probationEndDate);
  const days = differenceInDays(end, today);
  const overdue = days < 0;
  const label = overdue
    ? `${Math.abs(days)}d overdue`
    : days === 0 ? 'Today' : `${days}d left`;
  return { days, overdue, label };
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<ProbationStatus, { label: string; bg: string; color: string }> = {
  on_probation: { label: 'On Probation', bg: '#FEF3C7', color: '#92400E' },
  confirmed:    { label: 'Confirmed',    bg: '#D1FAE5', color: '#065F46' },
  extended:     { label: 'Extended',     bg: '#FEE2E2', color: '#991B1B' },
  terminated:   { label: 'Terminated',  bg: '#F3F4F6', color: '#374151' },
};

function StatusPill({ status }: { status: ProbationStatus }) {
  const cfg = STATUS_CFG[status];
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

// ─── Rating stars ──────────────────────────────────────────────────────────────

function RatingRow({
  label, value, onChange,
}: { label: string; value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange?.(n)}
            className={`w-7 h-7 rounded text-xs font-semibold transition-all ${onChange ? 'cursor-pointer hover:scale-110' : 'cursor-default'}`}
            style={{
              backgroundColor: n <= value ? '#C9A961' : 'var(--shell-hover-hard)',
              color: n <= value ? '#0B1538' : 'var(--text-muted)',
            }}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Evaluation Modal ─────────────────────────────────────────────────────────

interface EvalModalProps {
  record: ProbationRecord;
  byUid: string;
  onClose: () => void;
}

function EvalModal({ record, byUid, onClose }: EvalModalProps) {
  const existing = record.evaluation;
  const [rmName, setRmName]             = useState(existing?.reportingManagerName ?? '');
  const [workQuality, setWorkQuality]   = useState(existing?.workQuality ?? 3);
  const [communication, setCommunication] = useState(existing?.communication ?? 3);
  const [attendance, setAttendance]     = useState(existing?.attendance ?? 3);
  const [teamwork, setTeamwork]         = useState(existing?.teamwork ?? 3);
  const [learning, setLearning]         = useState(existing?.learning ?? 3);
  const [recommendation, setRecommendation] = useState<'confirm' | 'extend' | 'terminate'>(
    existing?.recommendation ?? 'confirm',
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const overallRating = parseFloat(
    ((workQuality + communication + attendance + teamwork + learning) / 5).toFixed(1),
  );

  const handleSave = async () => {
    if (!rmName.trim()) { setError('Reporting Manager name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await submitProbationEvaluation(record.employeeId, {
        reportingManagerName: rmName.trim(),
        workQuality, communication, attendance, teamwork, learning,
        overallRating,
        recommendation,
        notes: notes.trim() || null,
      }, byUid);
      onClose();
    } catch {
      setError('Failed to save evaluation. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--shell-border)">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Probation Evaluation
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{record.employeeName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--glass-panel-bg) transition-colors">
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Reporting Manager */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5"
              style={{ color: 'var(--text-muted)' }}>
              Evaluated By (Reporting Manager)
            </label>
            <input
              value={rmName}
              onChange={(e) => setRmName(e.target.value)}
              placeholder="e.g. Ajay Newatia"
              className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>

          {/* Competency Ratings */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
              Competency Ratings
            </p>
            <div className="rounded-xl border border-(--shell-border) px-4 divide-y divide-(--shell-border)">
              <RatingRow label="Work Quality"       value={workQuality}   onChange={setWorkQuality} />
              <RatingRow label="Communication"      value={communication} onChange={setCommunication} />
              <RatingRow label="Attendance"         value={attendance}    onChange={setAttendance} />
              <RatingRow label="Teamwork"           value={teamwork}      onChange={setTeamwork} />
              <RatingRow label="Learning Ability"   value={learning}      onChange={setLearning} />
            </div>
            <div className="mt-2 flex items-center gap-2 px-1">
              <Star size={13} style={{ color: '#C9A961' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                Overall: {overallRating} / 5
              </span>
            </div>
          </div>

          {/* Recommendation */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
              Recommendation
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(['confirm', 'extend', 'terminate'] as const).map((opt) => {
                const cfg = {
                  confirm:   { label: 'Confirm',    bg: '#D1FAE5', color: '#065F46' },
                  extend:    { label: 'Extend',     bg: '#FEF3C7', color: '#92400E' },
                  terminate: { label: 'Terminate',  bg: '#FEE2E2', color: '#991B1B' },
                }[opt];
                const active = recommendation === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setRecommendation(opt)}
                    className="py-2 rounded-xl text-xs font-semibold transition-all"
                    style={{
                      backgroundColor: active ? cfg.bg : '#F8FAFC',
                      color: active ? cfg.color : 'var(--text-muted)',
                      border: `2px solid ${active ? cfg.bg : 'var(--shell-hover-hard)'}`,
                    }}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5"
              style={{ color: 'var(--text-muted)' }}>
              Notes <span className="font-normal normal-case">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Areas of improvement, strengths, specific feedback…"
              className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>

          {error && <p className="text-sm font-medium" style={{ color: '#DC2626' }}>{error}</p>}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity"
              style={{ backgroundColor: '#0B1538', color: '#FFFFFF', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving…' : 'Save Evaluation'}
            </button>
            <button onClick={onClose} className="text-sm transition-opacity hover:opacity-60"
              style={{ color: 'var(--text-muted)' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────

function ConfirmModal({
  record, byUid, onClose, onSuccess,
}: {
  record: ProbationRecord;
  byUid: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await confirmProbation(record.employeeId, byUid, notes);
      onSuccess();
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--shell-border)">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Confirm Probation
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--glass-panel-bg) transition-colors">
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl p-4" style={{ backgroundColor: '#D1FAE5' }}>
            <p className="text-sm font-semibold" style={{ color: '#065F46' }}>
              Confirming probation for {record.employeeName}
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#065F46' }}>
              Joining: {fmtDate(record.joiningDate)} · End of Probation: {fmtDate(record.probationEndDate)}
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5"
              style={{ color: 'var(--text-muted)' }}>
              Notes <span className="font-normal normal-case">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleConfirm}
              disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity"
              style={{ backgroundColor: '#059669', color: '#FFFFFF', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Confirming…' : 'Confirm Employment'}
            </button>
            <button onClick={onClose} className="text-sm transition-opacity hover:opacity-60"
              style={{ color: 'var(--text-muted)' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Extend Modal ─────────────────────────────────────────────────────────────

function ExtendModal({
  record, byUid, onClose, onSuccess,
}: {
  record: ProbationRecord;
  byUid: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [months, setMonths] = useState(1);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Compute new end date from current end date
  const currentEnd = record.probationEndDate;
  const newEndDate = format(addMonths(parseISO(currentEnd), months), 'yyyy-MM-dd');

  const handleExtend = async () => {
    if (!reason.trim()) { setError('Please provide a reason for the extension.'); return; }
    setSaving(true);
    setError('');
    try {
      await extendProbation(record.employeeId, byUid, newEndDate, reason);
      onSuccess();
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--shell-border)">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Extend Probation
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--glass-panel-bg) transition-colors">
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl p-4" style={{ backgroundColor: '#FEF3C7' }}>
            <p className="text-sm font-semibold" style={{ color: '#92400E' }}>
              {record.employeeName}
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#92400E' }}>
              Current end: {fmtDate(currentEnd)}
            </p>
          </div>

          {/* Extension period */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-2"
              style={{ color: 'var(--text-muted)' }}>
              Extend By
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMonths(m)}
                  className="py-2.5 rounded-xl text-sm font-semibold transition-all"
                  style={{
                    backgroundColor: months === m ? '#0B1538' : '#F8FAFC',
                    color: months === m ? '#FFFFFF' : 'var(--text-muted)',
                  }}
                >
                  {m} Month{m > 1 ? 's' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* New end date preview */}
          <div className="rounded-xl px-4 py-3" style={{ backgroundColor: 'var(--glass-panel-bg)', border: '1px solid var(--shell-border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>
              New Probation End Date
            </p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {fmtDate(newEndDate)}
            </p>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5"
              style={{ color: 'var(--text-muted)' }}>
              Reason for Extension <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Describe the areas requiring improvement or circumstances…"
              className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>

          {error && <p className="text-sm font-medium" style={{ color: '#DC2626' }}>{error}</p>}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleExtend}
              disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity"
              style={{ backgroundColor: '#0B1538', color: '#FFFFFF', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Extending…' : 'Extend Probation'}
            </button>
            <button onClick={onClose} className="text-sm transition-opacity hover:opacity-60"
              style={{ color: 'var(--text-muted)' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PDF generation ───────────────────────────────────────────────────────────

function downloadConfirmationLetter(record: ProbationRecord): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 20;

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(11, 21, 56);
  doc.text('FINVASTRA ADVISORS PRIVATE LIMITED', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(139, 139, 133);
  doc.text('Hyderabad · pulse.finvastra.com', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setDrawColor(201, 169, 97);
  doc.setLineWidth(0.6);
  doc.line(20, y, pageW - 20, y);
  y += 10;

  // Reference and date
  const today = format(new Date(), 'd MMM yyyy');
  const empCode = record.employeeCode ?? record.employeeId.slice(-6).toUpperCase();
  doc.setFontSize(9);
  doc.setTextColor(42, 42, 42);
  doc.text(`Ref: FAPL/${empCode}/HRMS/${format(new Date(), 'yyyy')}`, 20, y);
  doc.text(`Date: ${today}`, pageW - 20, y, { align: 'right' });
  y += 10;

  // Subject line
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(10, 10, 10);
  doc.text('Subject: Confirmation of Employment', 20, y);
  y += 10;

  // Salutation
  const firstName = record.employeeName.split(' ')[0];
  doc.setFont('helvetica', 'normal');
  doc.text(`Dear ${firstName},`, 20, y);
  y += 8;

  // Body paragraphs
  const bodyStyle = { maxWidth: pageW - 40 };
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(42, 42, 42);

  const para1 =
    `With reference to your appointment dated ${fmtDate(record.joiningDate)}, we are pleased to ` +
    `inform you that upon review of your performance during the probation period ending ` +
    `${fmtDate(record.probationEndDate)}, the management has decided to confirm your appointment ` +
    `as a Permanent Employee of Finvastra Advisors Private Limited`;
  const lines1 = doc.splitTextToSize(para1, bodyStyle.maxWidth);
  doc.text(lines1, 20, y);
  y += (lines1.length * 5) + 6;

  const confirmedDate = record.confirmedAt
    ? format(toDate(record.confirmedAt) ?? new Date(), 'd MMM yyyy')
    : today;
  const para2 =
    `Your employment as ${record.designation ?? 'Employee'} in the ${record.department ?? 'department'} ` +
    `is confirmed with effect from ${confirmedDate}. Your terms and conditions of employment remain ` +
    `unchanged as per your appointment letter.`;
  const lines2 = doc.splitTextToSize(para2, bodyStyle.maxWidth);
  doc.text(lines2, 20, y);
  y += (lines2.length * 5) + 6;

  const para3 =
    `We appreciate your contribution to the organisation and look forward to your continued ` +
    `dedication and excellent performance. We wish you a rewarding career with us.`;
  const lines3 = doc.splitTextToSize(para3, bodyStyle.maxWidth);
  doc.text(lines3, 20, y);
  y += (lines3.length * 5) + 20;

  // Closing
  doc.setFont('helvetica', 'normal');
  doc.text('Yours sincerely,', 20, y);
  y += 15;
  doc.setFont('helvetica', 'bold');
  doc.text('For Finvastra Advisors Private Limited', 20, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(139, 139, 133);
  doc.text('Human Resources', 20, y);
  y += 25;

  // Employee acknowledgement
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(20, y, pageW / 2 - 10, y);
  doc.line(pageW / 2 + 10, y, pageW - 20, y);
  y += 4;
  doc.setFontSize(8);
  doc.setTextColor(139, 139, 133);
  doc.text('Authorised Signatory', 20, y);
  doc.text('Employee Acknowledgement', pageW / 2 + 10, y);
  y += 4;
  doc.text(`Date: ${today}`, 20, y);
  doc.text('Date: _______________', pageW / 2 + 10, y);

  const filename = `Probation_Confirmation_${empCode}_${record.employeeName.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
}

function downloadExtensionLetter(record: ProbationRecord): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 20;

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(11, 21, 56);
  doc.text('FINVASTRA ADVISORS PRIVATE LIMITED', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(139, 139, 133);
  doc.text('Hyderabad · pulse.finvastra.com', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setDrawColor(201, 169, 97);
  doc.setLineWidth(0.6);
  doc.line(20, y, pageW - 20, y);
  y += 10;

  const today = format(new Date(), 'd MMM yyyy');
  const empCode = record.employeeCode ?? record.employeeId.slice(-6).toUpperCase();
  doc.setFontSize(9);
  doc.setTextColor(42, 42, 42);
  doc.text(`Ref: FAPL/${empCode}/HRMS/${format(new Date(), 'yyyy')}`, 20, y);
  doc.text(`Date: ${today}`, pageW - 20, y, { align: 'right' });
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(10, 10, 10);
  doc.text('Subject: Extension of Probation Period', 20, y);
  y += 10;

  const firstName = record.employeeName.split(' ')[0];
  doc.setFont('helvetica', 'normal');
  doc.text(`Dear ${firstName},`, 20, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(42, 42, 42);

  const para1 =
    `With reference to your appointment dated ${fmtDate(record.joiningDate)}, we wish to inform you ` +
    `that your probation period, which was scheduled to end on ${fmtDate(record.probationEndDate)}, ` +
    `has been extended as detailed below.`;
  const lines1 = doc.splitTextToSize(para1, pageW - 40);
  doc.text(lines1, 20, y);
  y += (lines1.length * 5) + 8;

  // Extension table
  const newEnd = record.extensionEndDate ?? record.probationEndDate;
  doc.setFont('helvetica', 'bold');
  doc.text('Extended Probation End Date:', 20, y);
  doc.setFont('helvetica', 'normal');
  doc.text(fmtDate(newEnd), 90, y);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text('Reason for Extension:', 20, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  const reasonLines = doc.splitTextToSize(record.extensionReason ?? '—', pageW - 40);
  doc.text(reasonLines, 20, y);
  y += (reasonLines.length * 5) + 8;

  const para2 =
    `Your performance will be reviewed at the end of the extended probation period. You are ` +
    `expected to demonstrate significant improvement in the areas highlighted and maintain ` +
    `the highest standard of professionalism.`;
  const lines2 = doc.splitTextToSize(para2, pageW - 40);
  doc.text(lines2, 20, y);
  y += (lines2.length * 5) + 20;

  doc.setFont('helvetica', 'normal');
  doc.text('Yours sincerely,', 20, y);
  y += 15;
  doc.setFont('helvetica', 'bold');
  doc.text('For Finvastra Advisors Private Limited', 20, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(139, 139, 133);
  doc.text('Human Resources', 20, y);
  y += 25;

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(20, y, pageW / 2 - 10, y);
  doc.line(pageW / 2 + 10, y, pageW - 20, y);
  y += 4;
  doc.setFontSize(8);
  doc.setTextColor(139, 139, 133);
  doc.text('Authorised Signatory', 20, y);
  doc.text('Employee Acknowledgement', pageW / 2 + 10, y);
  y += 4;
  doc.text(`Date: ${today}`, 20, y);
  doc.text('Date: _______________', pageW / 2 + 10, y);

  const filename = `Probation_Extension_${empCode}_${record.employeeName.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-5 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: color + '20' }}>
        <span className="text-lg font-bold" style={{ color }}>{count}</span>
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
    </div>
  );
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────

type Filter = 'all' | 'active' | 'due_soon' | 'extended' | 'confirmed';

const FILTER_LABELS: Record<Filter, string> = {
  all:       'All',
  active:    'On Probation',
  due_soon:  'Due / Overdue',
  extended:  'Extended',
  confirmed: 'Confirmed',
};

// ─── ProbationPage ────────────────────────────────────────────────────────────

export function ProbationPage() {
  const { user, profile } = useAuth();
  const isAdmin       = profile?.role === 'admin';
  const isHrmsManager = profile?.isHrmsManager === true;
  const canManage     = isAdmin || isHrmsManager;

  const { records, loading } = useProbationRecords(canManage);

  const [filter, setFilter] = useState<Filter>('all');
  const navigate = useNavigate();
  const [evalRecord,    setEvalRecord]    = useState<ProbationRecord | null>(null);
  const [confirmRecord, setConfirmRecord] = useState<ProbationRecord | null>(null);
  const [extendRecord,  setExtendRecord]  = useState<ProbationRecord | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  // Auto-create probation records for active employees with joiningDate who don't have one yet
  const hasBackfilled = useRef(false);
  useEffect(() => {
    if (!canManage || loading || hasBackfilled.current) return;
    hasBackfilled.current = true;

    async function backfill() {
      try {
        const snap = await getDocs(
          query(collection(db, 'users'), where('employeeStatus', '==', 'active')),
        );
        const existing = new Set(records.map((r) => r.employeeId));
        const toCreate = snap.docs
          .map((d) => ({ userId: d.id, ...d.data() } as UserProfile))
          .filter((emp) => !!emp.joiningDate && !existing.has(emp.userId));

        await Promise.all(toCreate.map((emp) =>
          ensureProbationRecord({
            userId: emp.userId,
            displayName: emp.displayName,
            employeeId: emp.employeeId,
            department: emp.department,
            designation: emp.designation,
            joiningDate: emp.joiningDate!,
          }).catch(() => {/* non-fatal */}),
        ));
      } catch { /* non-fatal */ }
    }
    backfill();
  }, [canManage, loading, records]);

  if (!canManage) return <Navigate to="/hrms/dashboard" replace />;

  const today = new Date();
  const in30 = new Date(); in30.setDate(today.getDate() + 30);

  // Computed stats
  const onProbation = records.filter((r) => r.status === 'on_probation');
  const extended    = records.filter((r) => r.status === 'extended');
  const confirmed   = records.filter((r) => r.status === 'confirmed');
  const dueSoon     = [...onProbation, ...extended].filter((r) => {
    const end = parseISO(r.probationEndDate);
    return end <= in30;
  });

  // Sorted: active first, sorted by end date ascending; then confirmed
  const sorted = [...records].sort((a, b) => {
    const activeStatuses: ProbationStatus[] = ['on_probation', 'extended'];
    const aActive = activeStatuses.includes(a.status);
    const bActive = activeStatuses.includes(b.status);
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return a.probationEndDate.localeCompare(b.probationEndDate);
  });

  // Filter
  const filtered = sorted.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'active')    return r.status === 'on_probation';
    if (filter === 'due_soon')  return dueSoon.includes(r);
    if (filter === 'extended')  return r.status === 'extended';
    if (filter === 'confirmed') return r.status === 'confirmed';
    return true;
  });

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ── Header ── */}
      <PageHeader
        title="Probation Management"
        subtitle="6-month probation tracking · confirmation & extension letters"
        pinKey="hrms.probation"
      />

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="On Probation"  count={onProbation.length} color="#92400E" />
        <StatCard label="Due / Overdue" count={dueSoon.length}     color="#DC2626" />
        <StatCard label="Extended"      count={extended.length}    color="#D97706" />
        <StatCard label="Confirmed"     count={confirmed.length}   color="#059669" />
      </div>

      {/* ── Filter tabs ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all"
            style={filter === f
              ? { backgroundColor: '#0B1538', color: '#FFFFFF' }
              : { backgroundColor: 'var(--glass-panel-bg)', color: 'var(--text-muted)' }}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {/* ── Table ── */}
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <GraduationCap size={32} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No probation records for this filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--shell-border)">
                  {['Employee', 'Dept / Role', 'Joining', 'Probation End', 'Timeline', 'Eval', 'Status', ''].map((h) => (
                    <th key={h}
                      className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--text-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((rec) => {
                  const { days, overdue, label } = daysInfo(rec);
                  const isActive = rec.status === 'on_probation' || rec.status === 'extended';
                  const hasEval = !!rec.evaluation;
                  const isSuccess = successId === rec.employeeId;

                  return (
                    <tr key={rec.id}
                      className={`border-b border-(--shell-border) transition-colors ${isSuccess ? 'bg-green-50' : 'hover:bg-(--glass-panel-bg)'}`}>
                      {/* Employee */}
                      <td className="px-5 py-3.5">
                        <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                          {rec.employeeName}
                        </p>
                        {rec.employeeCode && (
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{rec.employeeCode}</p>
                        )}
                      </td>

                      {/* Dept / Role */}
                      <td className="px-5 py-3.5">
                        <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{rec.department ?? '—'}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{rec.designation ?? ''}</p>
                      </td>

                      {/* Joining */}
                      <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-primary)' }}>
                        {fmtDate(rec.joiningDate)}
                      </td>

                      {/* Probation End */}
                      <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-primary)' }}>
                        {fmtDate(rec.probationEndDate)}
                        {rec.status === 'extended' && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                            style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                            Extended
                          </span>
                        )}
                      </td>

                      {/* Timeline */}
                      <td className="px-5 py-3.5">
                        {isActive ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                            style={{
                              backgroundColor: overdue ? '#FEE2E2' : days <= 30 ? '#FEF3C7' : '#F0FDF4',
                              color: overdue ? '#991B1B' : days <= 30 ? '#92400E' : '#065F46',
                            }}
                          >
                            {overdue ? <AlertCircle size={10} /> : <Clock size={10} />}
                            {label}
                          </span>
                        ) : rec.status === 'confirmed' ? (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {rec.confirmedAt ? format(toDate(rec.confirmedAt) ?? new Date(), 'd MMM yyyy') : '—'}
                          </span>
                        ) : null}
                      </td>

                      {/* Eval */}
                      <td className="px-5 py-3.5">
                        {hasEval ? (
                          <div>
                            <div className="flex items-center gap-1">
                              <Star size={11} style={{ color: '#C9A961' }} />
                              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {rec.evaluation!.overallRating}
                              </span>
                            </div>
                            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                              {rec.evaluation!.recommendation === 'confirm' ? '→ Confirm' :
                               rec.evaluation!.recommendation === 'extend'  ? '→ Extend' :
                               '→ Terminate'}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {isActive ? 'Pending' : '—'}
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3.5">
                        <StatusPill status={rec.status} />
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          {isActive && (
                            <>
                              <button
                                onClick={() => setEvalRecord(rec)}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:bg-blue-50"
                                style={{ color: '#3B82F6' }}
                                title={hasEval ? 'Edit Evaluation' : 'Add Evaluation'}
                              >
                                {hasEval ? 'Edit Eval' : 'Evaluate'}
                              </button>
                              <button
                                onClick={() => setConfirmRecord(rec)}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:bg-green-50"
                                style={{ color: '#059669' }}
                                title="Confirm Employment"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setExtendRecord(rec)}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:bg-amber-50"
                                style={{ color: '#D97706' }}
                                title="Extend Probation"
                              >
                                Extend
                              </button>
                              <button
                                onClick={() => {
                                  if (window.confirm(`Fail ${rec.employeeName}'s probation and start their exit? This opens the Exit form (reason preset to Termination) and creates their offboarding checklist.`))
                                    navigate(`/hrms/employees?exitFor=${rec.employeeId}&exitReason=termination`);
                                }}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:bg-red-50"
                                style={{ color: '#DC2626' }}
                                title="Fail probation → start exit + offboarding"
                              >
                                Fail &amp; Exit
                              </button>
                            </>
                          )}
                          {rec.status === 'confirmed' && (
                            <button
                              onClick={() => downloadConfirmationLetter(rec)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:bg-(--glass-panel-bg)"
                              style={{ color: 'var(--text-muted)' }}
                              title="Download Confirmation Letter"
                            >
                              <Download size={11} />
                              Letter
                            </button>
                          )}
                          {rec.status === 'extended' && (
                            <button
                              onClick={() => downloadExtensionLetter(rec)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:bg-(--glass-panel-bg)"
                              style={{ color: 'var(--text-muted)' }}
                              title="Download Extension Letter"
                            >
                              <Download size={11} />
                              Letter
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Info footer ── */}
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Probation records are auto-created for all active employees with a joining date. HR Handbook: 6-month standard probation.
        Evaluation form is shared by the Reporting Manager after 90 days.
      </p>

      {/* ── Modals ── */}
      {evalRecord && user && (
        <EvalModal
          record={evalRecord}
          byUid={user.uid}
          onClose={() => setEvalRecord(null)}
        />
      )}
      {confirmRecord && user && (
        <ConfirmModal
          record={confirmRecord}
          byUid={user.uid}
          onClose={() => setConfirmRecord(null)}
          onSuccess={() => setSuccessId(confirmRecord.employeeId)}
        />
      )}
      {extendRecord && user && (
        <ExtendModal
          record={extendRecord}
          byUid={user.uid}
          onClose={() => setExtendRecord(null)}
          onSuccess={() => setSuccessId(extendRecord.employeeId)}
        />
      )}
    </div>
  );
}
