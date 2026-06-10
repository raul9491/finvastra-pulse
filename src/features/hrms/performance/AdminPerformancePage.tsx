import { useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import {
  TrendingUp, Star, Download, X, Check, RefreshCw, ChevronDown, ChevronRight,
} from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import {
  useAllPerformanceReviews, createReviewCycle,
  submitSelfAssessment, submitManagerReview, finalizeReview,
  currentReviewYear,
} from '../hooks/usePerformance';
import type { PerformanceReview, PerformanceReviewStatus, UserProfile } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate();
  }
  return null;
}

const STATUS_CFG: Record<PerformanceReviewStatus, { label: string; bg: string; color: string }> = {
  pending:        { label: 'Pending',         bg: '#F3F4F6', color: 'var(--text-muted)' },
  self_review:    { label: 'Self-Assessment',  bg: '#FEF3C7', color: '#92400E' },
  manager_review: { label: 'Manager Done',    bg: '#EFF6FF', color: '#1D4ED8' },
  completed:      { label: 'Completed',        bg: '#D1FAE5', color: '#065F46' },
};

function StatusPill({ status }: { status: PerformanceReviewStatus }) {
  const cfg = STATUS_CFG[status];
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

function RatingRow({ label, value, onChange }: {
  label: string; value: number; onChange?: (v: number) => void;
}) {
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

// ─── Self-Assessment Modal (admin fills on behalf) ────────────────────────────

function SelfAssessmentModal({ review, onClose }: {
  review: PerformanceReview; onClose: () => void;
}) {
  const ex = review.selfAssessment;
  const [achievements,  setAchievements]  = useState(ex?.achievements  ?? '');
  const [challenges,    setChallenges]    = useState(ex?.challenges    ?? '');
  const [trainingNeeds, setTrainingNeeds] = useState(ex?.trainingNeeds ?? '');
  const [careerGoals,   setCareerGoals]   = useState(ex?.careerGoals   ?? '');
  const [selfRating,    setSelfRating]    = useState(ex?.overallSelfRating ?? 3);
  const [saving, setSaving]   = useState(false);
  const [error,  setError]    = useState('');

  const handleSave = async () => {
    if (!achievements.trim()) { setError('Achievements are required.'); return; }
    if (!challenges.trim())   { setError('Challenges are required.'); return; }
    setSaving(true); setError('');
    try {
      await submitSelfAssessment(review.employeeId, review.year, {
        achievements: achievements.trim(),
        challenges:   challenges.trim(),
        trainingNeeds: trainingNeeds.trim(),
        careerGoals:  careerGoals.trim(),
        overallSelfRating: selfRating,
      });
      onClose();
    } catch { setError('Failed to save.'); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--shell-border)">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Self-Assessment</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{review.employeeName} · {review.year}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--glass-panel-bg)"><X size={16} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {[
            { label: 'Key Achievements *', val: achievements, set: setAchievements, rows: 3 },
            { label: 'Challenges Faced *', val: challenges,   set: setChallenges,   rows: 3 },
            { label: 'Training Needs',     val: trainingNeeds, set: setTrainingNeeds, rows: 2 },
            { label: 'Career Goals',       val: careerGoals,  set: setCareerGoals,  rows: 2 },
          ].map(({ label, val, set, rows }) => (
            <div key={label}>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
              <textarea value={val} onChange={(e) => set(e.target.value)} rows={rows}
                className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
                style={{ color: 'var(--text-primary)' }} />
            </div>
          ))}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Overall Self-Rating</p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setSelfRating(n)}
                  className="w-9 h-9 rounded-xl text-sm font-semibold transition-all"
                  style={{ backgroundColor: selfRating === n ? '#C9A961' : 'var(--shell-hover-hard)', color: selfRating === n ? '#0B1538' : 'var(--text-muted)' }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm font-medium" style={{ color: '#DC2626' }}>{error}</p>}
          <div className="flex items-center gap-3 pt-1">
            <button onClick={handleSave} disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity"
              style={{ backgroundColor: 'var(--text-primary)', color: '#FFFFFF', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save Self-Assessment'}
            </button>
            <button onClick={onClose} className="text-sm hover:opacity-60" style={{ color: 'var(--text-muted)' }}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Manager Review Modal ──────────────────────────────────────────────────────

function ManagerReviewModal({ review, byUid, onClose }: {
  review: PerformanceReview; byUid: string; onClose: () => void;
}) {
  const ex = review.managerReview;
  const [managerName, setManagerName]   = useState(ex?.managerName ?? '');
  const [workQuality,  setWorkQuality]  = useState(ex?.workQuality  ?? 3);
  const [workQuantity, setWorkQuantity] = useState(ex?.workQuantity ?? 3);
  const [initiative,   setInitiative]  = useState(ex?.initiative   ?? 3);
  const [communication, setCommunication] = useState(ex?.communication ?? 3);
  const [teamwork,     setTeamwork]    = useState(ex?.teamwork     ?? 3);
  const [punctuality,  setPunctuality] = useState(ex?.punctuality  ?? 3);
  const [strengths,    setStrengths]   = useState(ex?.strengths    ?? '');
  const [improvements, setImprovements] = useState(ex?.areasForImprovement ?? '');
  const [promo,        setPromo]       = useState(ex?.recommendedForPromotion ?? false);
  const [notes,        setNotes]       = useState(ex?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const overallRating = parseFloat(
    ((workQuality + workQuantity + initiative + communication + teamwork + punctuality) / 6).toFixed(1),
  );

  const handleSave = async () => {
    if (!managerName.trim()) { setError('Manager name is required.'); return; }
    if (!strengths.trim())   { setError('Strengths are required.'); return; }
    setSaving(true); setError('');
    try {
      await submitManagerReview(review.id, {
        managerName: managerName.trim(),
        workQuality, workQuantity, initiative, communication, teamwork, punctuality,
        overallRating,
        strengths: strengths.trim(),
        areasForImprovement: improvements.trim(),
        recommendedForPromotion: promo,
        notes: notes.trim() || null,
      }, byUid);
      onClose();
    } catch { setError('Failed to save.'); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--shell-border)">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Manager's Review</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{review.employeeName} · {review.year}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--glass-panel-bg)"><X size={16} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>Reporting Manager Name *</label>
            <input value={managerName} onChange={(e) => setManagerName(e.target.value)}
              className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{ color: 'var(--text-primary)' }} />
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>KRA Ratings (1–5)</p>
            <div className="rounded-xl border border-(--shell-border) px-4 divide-y divide-(--shell-border)">
              <RatingRow label="Work Quality"  value={workQuality}   onChange={setWorkQuality} />
              <RatingRow label="Work Quantity" value={workQuantity}  onChange={setWorkQuantity} />
              <RatingRow label="Initiative"    value={initiative}    onChange={setInitiative} />
              <RatingRow label="Communication" value={communication} onChange={setCommunication} />
              <RatingRow label="Teamwork"      value={teamwork}      onChange={setTeamwork} />
              <RatingRow label="Punctuality"   value={punctuality}   onChange={setPunctuality} />
            </div>
            <div className="mt-2 flex items-center gap-2 px-1">
              <Star size={13} style={{ color: '#C9A961' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Overall: {overallRating} / 5</span>
            </div>
          </div>

          {[
            { label: 'Strengths *', val: strengths, set: setStrengths, rows: 2 },
            { label: 'Areas for Improvement', val: improvements, set: setImprovements, rows: 2 },
            { label: 'Notes (optional)', val: notes, set: setNotes, rows: 2 },
          ].map(({ label, val, set, rows }) => (
            <div key={label}>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
              <textarea value={val} onChange={(e) => set(e.target.value)} rows={rows}
                className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
                style={{ color: 'var(--text-primary)' }} />
            </div>
          ))}

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={promo} onChange={(e) => setPromo(e.target.checked)}
              className="w-4 h-4 rounded" />
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Recommend for Promotion</span>
          </label>

          {error && <p className="text-sm font-medium" style={{ color: '#DC2626' }}>{error}</p>}
          <div className="flex items-center gap-3 pt-1">
            <button onClick={handleSave} disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity"
              style={{ backgroundColor: 'var(--text-primary)', color: '#FFFFFF', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Submit Manager Review'}
            </button>
            <button onClick={onClose} className="text-sm hover:opacity-60" style={{ color: 'var(--text-muted)' }}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Finalize Modal ────────────────────────────────────────────────────────────

function FinalizeModal({ review, byUid, onClose }: {
  review: PerformanceReview; byUid: string; onClose: () => void;
}) {
  const [incrementPct, setIncrementPct]   = useState(String(review.incrementPercentage ?? ''));
  const [oldSalary,    setOldSalary]      = useState(String(review.oldGrossSalary ?? ''));
  const [effectiveDate, setEffectiveDate] = useState(review.incrementEffectiveDate ?? `${review.year + 1}-04-01`);
  const [hrNotes,      setHrNotes]        = useState(review.hrNotes ?? '');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const pct      = parseFloat(incrementPct) || 0;
  const oldGross = parseFloat(oldSalary)    || 0;
  const newGross = oldGross > 0 && pct > 0
    ? Math.round(oldGross * (1 + pct / 100))
    : 0;

  const handleFinalize = async () => {
    if (!pct)          { setError('Increment percentage is required.'); return; }
    if (!oldGross)     { setError('Previous gross salary is required.'); return; }
    if (!effectiveDate) { setError('Effective date is required.'); return; }
    setSaving(true); setError('');
    try {
      await finalizeReview(review.id, {
        incrementPercentage: pct,
        newGrossSalary: newGross,
        oldGrossSalary: oldGross,
        incrementEffectiveDate: effectiveDate,
        hrNotes: hrNotes.trim() || null,
      }, byUid);
      onClose();
    } catch { setError('Failed to finalize.'); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--shell-border)">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Finalize Review</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{review.employeeName} · {review.year}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--glass-panel-bg)"><X size={16} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Previous Gross (₹) *
              </label>
              <input type="number" value={oldSalary} onChange={(e) => setOldSalary(e.target.value)}
                placeholder="e.g. 50000"
                className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{ color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Increment % *
              </label>
              <input type="number" value={incrementPct} onChange={(e) => setIncrementPct(e.target.value)}
                placeholder="e.g. 10"
                className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{ color: 'var(--text-primary)' }} />
            </div>
          </div>

          {/* Live preview */}
          {newGross > 0 && (
            <div className="rounded-xl px-4 py-3" style={{ backgroundColor: '#D1FAE5' }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#065F46' }}>New Gross Salary</p>
              <p className="text-xl font-semibold" style={{ color: '#065F46' }}>{inr(newGross)}/mo</p>
              <p className="text-xs mt-0.5" style={{ color: '#065F46' }}>
                +{inr(newGross - oldGross)} from {inr(oldGross)}
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Effective Date *
            </label>
            <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{ color: 'var(--text-primary)' }} />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
              HR Notes (optional)
            </label>
            <textarea value={hrNotes} onChange={(e) => setHrNotes(e.target.value)} rows={2}
              className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
              style={{ color: 'var(--text-primary)' }} />
          </div>

          {error && <p className="text-sm font-medium" style={{ color: '#DC2626' }}>{error}</p>}
          <div className="flex items-center gap-3 pt-1">
            <button onClick={handleFinalize} disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity"
              style={{ backgroundColor: '#059669', color: '#FFFFFF', opacity: saving ? 0.6 : 1 }}>
              <Check size={14} />
              {saving ? 'Finalizing…' : 'Finalize & Issue Increment'}
            </button>
            <button onClick={onClose} className="text-sm hover:opacity-60" style={{ color: 'var(--text-muted)' }}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PDF: Increment Letter ─────────────────────────────────────────────────────

function downloadIncrementLetter(review: PerformanceReview): void {
  if (review.status !== 'completed' || !review.newGrossSalary) return;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 20;

  // Header
  doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 21, 56);
  doc.text('FINVASTRA ADVISORS PRIVATE LIMITED', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(139, 139, 133);
  doc.text('Hyderabad · pulse.finvastra.com', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setDrawColor(201, 169, 97); doc.setLineWidth(0.6);
  doc.line(20, y, pageW - 20, y);
  y += 10;

  // Ref + date
  const today = format(new Date(), 'd MMM yyyy');
  const empCode = review.employeeCode ?? review.employeeId.slice(-6).toUpperCase();
  doc.setFontSize(9); doc.setTextColor(42, 42, 42);
  doc.text(`Ref: FAPL/${empCode}/HR/${review.year}`, 20, y);
  doc.text(`Date: ${today}`, pageW - 20, y, { align: 'right' });
  y += 10;

  // Subject
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(10, 10, 10);
  doc.text('Subject: Annual Increment Letter', 20, y);
  y += 10;

  // Salutation
  const firstName = review.employeeName.split(' ')[0];
  doc.setFont('helvetica', 'normal');
  doc.text(`Dear ${firstName},`, 20, y);
  y += 8;

  // Body
  doc.setFontSize(10); doc.setTextColor(42, 42, 42);
  const para1 =
    `This is to inform you that based on your performance review for the year ${review.year}, ` +
    `the Management is pleased to announce an enhancement in your remuneration effective ` +
    `${review.incrementEffectiveDate ? format(new Date(review.incrementEffectiveDate), 'd MMMM yyyy') : 'as below'}.`;
  const lines1 = doc.splitTextToSize(para1, pageW - 40);
  doc.text(lines1, 20, y);
  y += lines1.length * 5 + 8;

  // Salary table
  const tableData = [
    ['Description',          'Amount (₹ per month)'],
    ['Previous Gross Salary', inr(review.oldGrossSalary ?? 0)],
    [`Increment (${review.incrementPercentage}%)`, inr((review.newGrossSalary ?? 0) - (review.oldGrossSalary ?? 0))],
    ['Revised Gross Salary',  inr(review.newGrossSalary ?? 0)],
  ];
  const colW = (pageW - 40) / 2;
  tableData.forEach(([col1, col2], i) => {
    const isHeader = i === 0;
    const isTotal  = i === 3;
    if (isHeader) {
      doc.setFillColor(11, 21, 56); doc.rect(20, y - 3, pageW - 40, 7, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold');
    } else if (isTotal) {
      doc.setFillColor(209, 250, 229); doc.rect(20, y - 3, pageW - 40, 7, 'F');
      doc.setTextColor(6, 95, 70); doc.setFont('helvetica', 'bold');
    } else {
      doc.setFillColor(248, 250, 252); doc.rect(20, y - 3, pageW - 40, 7, 'F');
      doc.setTextColor(42, 42, 42); doc.setFont('helvetica', 'normal');
    }
    doc.setFontSize(9);
    doc.text(col1, 24, y + 1);
    doc.text(col2, 20 + colW + 4, y + 1);
    y += 8;
  });
  y += 6;

  // Closing para
  doc.setTextColor(42, 42, 42); doc.setFont('helvetica', 'normal');
  const para2 =
    `We appreciate your continued dedication and contribution to Finvastra. ` +
    `We look forward to your continued growth and excellence.`;
  const lines2 = doc.splitTextToSize(para2, pageW - 40);
  doc.text(lines2, 20, y);
  y += lines2.length * 5 + 6;
  if (review.hrNotes) {
    const noteLines = doc.splitTextToSize(review.hrNotes, pageW - 40);
    doc.setTextColor(139, 139, 133); doc.setFontSize(9);
    doc.text(noteLines, 20, y);
    y += noteLines.length * 4 + 4;
  }
  y += 10;

  // Signing
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(42, 42, 42);
  doc.text('Yours sincerely,', 20, y); y += 15;
  doc.setFont('helvetica', 'bold');
  doc.text('For Finvastra Advisors Private Limited', 20, y); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(139, 139, 133);
  doc.text('Human Resources', 20, y); y += 22;

  doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3);
  doc.line(20, y, pageW / 2 - 10, y); doc.line(pageW / 2 + 10, y, pageW - 20, y);
  y += 4; doc.setFontSize(8); doc.setTextColor(139, 139, 133);
  doc.text('Authorised Signatory', 20, y);
  doc.text('Employee Acknowledgement', pageW / 2 + 10, y);
  y += 4;
  doc.text(`Date: ${today}`, 20, y);
  doc.text('Date: _______________', pageW / 2 + 10, y);

  doc.save(`Increment_Letter_${empCode}_${review.employeeName.replace(/\s+/g, '_')}_${review.year}.pdf`);
}

// ─── Review Detail Panel (inline expand) ─────────────────────────────────────

function ReviewDetailPanel({ review }: { review: PerformanceReview }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-2 px-2">
      {/* Self-assessment */}
      {review.selfAssessment && (
        <div className="border border-(--shell-border) rounded-xl overflow-hidden">
          <button type="button" onClick={() => setOpen(open === 'sa' ? null : 'sa')}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-(--glass-panel-bg) text-left">
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Self-Assessment</span>
            {open === 'sa' ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
          </button>
          {open === 'sa' && (
            <div className="px-4 pb-4 pt-1 border-t border-(--shell-border) space-y-3">
              {[
                { l: 'Achievements',   v: review.selfAssessment.achievements },
                { l: 'Challenges',     v: review.selfAssessment.challenges },
                { l: 'Training Needs', v: review.selfAssessment.trainingNeeds },
                { l: 'Career Goals',   v: review.selfAssessment.careerGoals },
              ].map(({ l, v }) => v ? (
                <div key={l}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>{l}</p>
                  <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{v}</p>
                </div>
              ) : null)}
              <p className="text-xs font-semibold" style={{ color: '#C9A961' }}>Self-rating: {review.selfAssessment.overallSelfRating}/5</p>
            </div>
          )}
        </div>
      )}
      {/* Manager review */}
      {review.managerReview && (
        <div className="border border-(--shell-border) rounded-xl overflow-hidden">
          <button type="button" onClick={() => setOpen(open === 'mr' ? null : 'mr')}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-(--glass-panel-bg) text-left">
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Manager Review — {review.managerReview.overallRating}/5</span>
            {open === 'mr' ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
          </button>
          {open === 'mr' && (
            <div className="px-4 pb-4 pt-2 border-t border-(--shell-border) space-y-2">
              {[
                ['Work Quality', review.managerReview.workQuality],
                ['Work Quantity', review.managerReview.workQuantity],
                ['Initiative', review.managerReview.initiative],
                ['Communication', review.managerReview.communication],
                ['Teamwork', review.managerReview.teamwork],
                ['Punctuality', review.managerReview.punctuality],
              ].map(([l, v]) => (
                <div key={l as string} className="flex items-center justify-between text-xs">
                  <span style={{ color: 'var(--text-primary)' }}>{l as string}</span>
                  <span className="font-semibold" style={{ color: '#C9A961' }}>{v as number}/5</span>
                </div>
              ))}
              <div className="pt-1 text-xs space-y-1">
                <p><span style={{ color: 'var(--text-muted)' }}>Strengths: </span>{review.managerReview.strengths}</p>
                {review.managerReview.areasForImprovement && <p><span style={{ color: 'var(--text-muted)' }}>Improve: </span>{review.managerReview.areasForImprovement}</p>}
                {review.managerReview.recommendedForPromotion && <p className="font-semibold" style={{ color: '#059669' }}>★ Recommended for Promotion</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AdminPerformancePage ────────────────────────────────────────────────────

type Filter = 'all' | 'pending' | 'self_review' | 'manager_review' | 'completed';

export function AdminPerformancePage() {
  const { user, profile } = useAuth();
  const isAdmin      = profile?.role === 'admin';
  const isHrmsManager = profile?.isHrmsManager === true;
  const canManage    = isAdmin || isHrmsManager;

  const [year, setYear] = useState(currentReviewYear());
  const { reviews, loading } = useAllPerformanceReviews(year, canManage);

  const [filter, setFilter] = useState<Filter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Modals
  const [selfModal,    setSelfModal]    = useState<PerformanceReview | null>(null);
  const [mgrModal,     setMgrModal]     = useState<PerformanceReview | null>(null);
  const [finalModal,   setFinalModal]   = useState<PerformanceReview | null>(null);

  // Cycle creation
  const [creatingCycle, setCreatingCycle] = useState(false);
  const [cycleMsg,      setCycleMsg]      = useState('');

  const handleStartCycle = useCallback(async () => {
    if (!window.confirm(`Start ${year} review cycle for all active employees?`)) return;
    setCreatingCycle(true); setCycleMsg('');
    try {
      const snap = await getDocs(
        query(collection(db, 'users'), where('employeeStatus', '==', 'active')),
      );
      const employees = snap.docs.map((d) => ({ userId: d.id, ...d.data() }) as UserProfile);
      const created = await createReviewCycle(year, employees);
      setCycleMsg(created > 0
        ? `Review cycle started — ${created} employee review${created !== 1 ? 's' : ''} created.`
        : 'All active employees already have a review for this year.');
    } catch {
      setCycleMsg('Failed to start cycle. Please try again.');
    } finally {
      setCreatingCycle(false);
    }
  }, [year]);

  if (!canManage) return <Navigate to="/hrms/dashboard" replace />;

  // Stats
  const total          = reviews.length;
  const pending        = reviews.filter((r) => r.status === 'pending').length;
  const selfDone       = reviews.filter((r) => r.status === 'self_review').length;
  const managerDone    = reviews.filter((r) => r.status === 'manager_review').length;
  const completed      = reviews.filter((r) => r.status === 'completed').length;
  const awaitingHR     = selfDone + managerDone;

  const filtered = reviews
    .filter((r) => filter === 'all' || r.status === filter)
    .sort((a, b) => {
      const order: PerformanceReviewStatus[] = ['manager_review', 'self_review', 'pending', 'completed'];
      return order.indexOf(a.status) - order.indexOf(b.status);
    });

  const yearOptions = [year - 1, year, year + 1];

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl mb-1" style={{
            fontFamily: '"Fraunces", Georgia, serif',
            fontStyle: 'italic',
            fontVariationSettings: '"SOFT" 30',
            fontWeight: 300,
            color: 'var(--text-primary)',
          }}>
            Performance Reviews
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Annual review cycle management
          </p>
        </div>
        {/* Year picker + start cycle */}
        <div className="flex items-center gap-3">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="glass-inp rounded-xl px-3 py-2 text-sm focus:outline-none"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y} Review</option>
            ))}
          </select>
          <button
            onClick={handleStartCycle}
            disabled={creatingCycle}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ backgroundColor: '#C9A961', color: '#0B1538', opacity: creatingCycle ? 0.6 : 1 }}
          >
            <RefreshCw size={14} className={creatingCycle ? 'animate-spin' : ''} />
            {creatingCycle ? 'Starting…' : 'Start Cycle'}
          </button>
        </div>
      </div>

      {cycleMsg && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ backgroundColor: 'rgba(5,150,105,0.10)', color: '#34d399', border: '1px solid rgba(5,150,105,0.20)' }}>
          {cycleMsg}
        </div>
      )}

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total',        count: total,       color: 'var(--shell-text-secondary)' },
          { label: 'Pending',      count: pending,     color: 'var(--shell-text-secondary)' },
          { label: 'Self Done',    count: selfDone,    color: '#f59e0b' },
          { label: 'Manager Done', count: managerDone, color: '#60a5fa' },
          { label: 'Completed',    count: completed,   color: '#34d399'  },
        ].map(({ label, count, color }) => (
          <div key={label} className="glass-panel p-4 text-center">
            <p className="text-2xl font-semibold" style={{ color }}>{count}</p>
            <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--shell-text-dim)' }}>{label}</p>
          </div>
        ))}
      </div>

      {awaitingHR > 0 && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-2 text-sm"
          style={{ backgroundColor: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.20)', color: '#fbbf24' }}>
          <TrendingUp size={15} />
          <span><strong>{awaitingHR}</strong> review{awaitingHR !== 1 ? 's' : ''} awaiting your action.</span>
        </div>
      )}

      {/* ── Filter tabs ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          ['all',            'All'],
          ['pending',        'Pending'],
          ['self_review',    'Self Done'],
          ['manager_review', 'Manager Done'],
          ['completed',      'Completed'],
        ] as [Filter, string][]).map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all"
            style={filter === f
              ? { backgroundColor: '#C9A961', color: '#0B1538' }
              : { backgroundColor: 'var(--glass-panel-bg)', color: 'var(--shell-text-secondary)', border: '1px solid var(--shell-border)' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Table ── */}
      <div className="glass-panel overflow-hidden" style={{ borderRadius: 16 }}>
        {loading ? (
          <div className="p-6 text-sm" style={{ color: 'var(--shell-text-secondary)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <TrendingUp size={32} className="mx-auto mb-3" style={{ color: 'var(--shell-text-dim)' }} />
            <p className="text-sm" style={{ color: 'var(--shell-text-secondary)' }}>
              {total === 0
                ? `No reviews for ${year}. Click "Start Cycle" to create them.`
                : 'No reviews for this filter.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--shell-border)' }}>
                {['Employee', 'Dept / Role', 'Manager Rating', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--shell-text-dim)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((rev) => (
                <>
                  <tr key={rev.id}
                    className="transition-colors cursor-pointer nav-item-hover"
                    style={{ borderBottom: '1px solid var(--shell-border)' }}
                    onClick={() => setExpandedId(expandedId === rev.id ? null : rev.id)}>
                    <td className="px-5 py-3.5">
                      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{rev.employeeName}</p>
                      {rev.employeeCode && <p className="text-xs" style={{ color: 'var(--shell-text-dim)' }}>{rev.employeeCode}</p>}
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-xs" style={{ color: 'var(--shell-text-secondary)' }}>{rev.department ?? '—'}</p>
                      <p className="text-xs" style={{ color: 'var(--shell-text-dim)' }}>{rev.designation ?? ''}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      {rev.managerReview ? (
                        <div className="flex items-center gap-1">
                          <Star size={12} style={{ color: '#C9A961' }} />
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {rev.managerReview.overallRating}
                          </span>
                          <span className="text-xs" style={{ color: 'var(--shell-text-dim)' }}>/5</span>
                          {rev.managerReview.recommendedForPromotion && (
                            <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                              style={{ backgroundColor: 'rgba(52,211,153,0.15)', color: '#34d399' }}>↑ Promo</span>
                          )}
                        </div>
                      ) : rev.selfAssessment ? (
                        <span className="text-xs" style={{ color: 'var(--shell-text-dim)' }}>
                          Self: {rev.selfAssessment.overallSelfRating}/5
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--shell-text-dim)' }}>—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusPill status={rev.status} />
                      {rev.status === 'completed' && rev.incrementPercentage !== undefined && (
                        <p className="text-xs mt-0.5 font-semibold" style={{ color: '#34d399' }}>
                          +{rev.incrementPercentage}% → {inr(rev.newGrossSalary ?? 0)}/mo
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(rev.status === 'pending' || rev.status === 'self_review') && (
                          <button onClick={() => setSelfModal(rev)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-70"
                            style={{ color: 'var(--shell-text-secondary)', border: '1px solid var(--shell-border)' }}>
                            {rev.selfAssessment ? 'Edit Self' : 'Self-Assess'}
                          </button>
                        )}
                        {rev.status !== 'pending' && rev.status !== 'completed' && (
                          <button onClick={() => setMgrModal(rev)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-70"
                            style={{ color: '#60a5fa', border: '1px solid rgba(96,165,250,0.25)' }}>
                            {rev.managerReview ? 'Edit Mgr' : 'Mgr Review'}
                          </button>
                        )}
                        {(rev.status === 'manager_review' || rev.status === 'self_review') && (
                          <button onClick={() => setFinalModal(rev)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-70"
                            style={{ color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }}>
                            Finalize
                          </button>
                        )}
                        {rev.status === 'completed' && (
                          <button onClick={() => downloadIncrementLetter(rev)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-70"
                            style={{ color: 'var(--shell-text-secondary)', border: '1px solid var(--shell-border)' }}>
                            <Download size={11} /> Letter
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === rev.id && (rev.selfAssessment || rev.managerReview) && (
                    <tr key={`${rev.id}-detail`} style={{ backgroundColor: 'var(--glass-panel-bg)' }}>
                      <td colSpan={5} className="py-3">
                        <ReviewDetailPanel review={rev} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
