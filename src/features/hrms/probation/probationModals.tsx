/**
 * The probation decision dialogs: the evaluation form (ratings + notes), the
 * confirm-employee dialog, and the extend-probation dialog.
 * 
 * Extracted verbatim from ProbationPage.tsx (2026-07-23).
 */
import { Star, X } from 'lucide-react';
import { submitProbationEvaluation, confirmProbation, extendProbation } from '../hooks/useProbation';
import { useState } from 'react';
import { format, parseISO, addMonths } from 'date-fns';
import type { ProbationRecord } from '../../../types';
import { fmtDate } from './ProbationPage';

// ─── Rating stars ──────────────────────────────────────────────────────────────

export function RatingRow({
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

export interface EvalModalProps {
  record: ProbationRecord;
  byUid: string;
  onClose: () => void;
}

export function EvalModal({ record, byUid, onClose }: EvalModalProps) {
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

export function ConfirmModal({
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

export function ExtendModal({
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
