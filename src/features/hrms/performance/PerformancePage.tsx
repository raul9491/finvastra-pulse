import { useState } from 'react';
import { inrRound as inr } from '../../../lib/money';
import { format } from 'date-fns';
import {
  CheckCircle2, Clock, AlertCircle, TrendingUp, Star, ChevronDown, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import {
  useMyPerformanceReview, submitSelfAssessment, currentReviewYear,
} from '../hooks/usePerformance';
import type { PerformanceReviewStatus } from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';

// ─── Helpers ──────────────────────────────────────────────────────────────────


function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate();
  }
  return null;
}

// ─── Status banner ────────────────────────────────────────────────────────────

const STATUS_INFO: Record<PerformanceReviewStatus, {
  icon: typeof Clock; bg: string; color: string; title: string; sub: string;
}> = {
  pending:        { icon: AlertCircle,  bg: '#FEF3C7', color: '#92400E', title: 'Self-Assessment Required', sub: 'Please complete your self-assessment below.' },
  self_review:    { icon: Clock,        bg: '#EFF6FF', color: '#1D4ED8', title: 'Self-Assessment Submitted', sub: 'Awaiting your reporting manager\'s review.' },
  manager_review: { icon: Clock,        bg: '#F0FDF4', color: '#166534', title: 'Manager Review Received', sub: 'Awaiting HR finalization.' },
  completed:      { icon: CheckCircle2, bg: '#D1FAE5', color: '#065F46', title: 'Review Completed', sub: 'Your increment has been finalised. See details below.' },
};

// ─── Rating display (readonly) ────────────────────────────────────────────────

function RatingDisplay({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <div
            key={n}
            className="w-7 h-7 rounded text-xs font-semibold flex items-center justify-center"
            style={{
              backgroundColor: n <= value ? '#C9A961' : 'var(--shell-hover-hard)',
              color: n <= value ? '#0B1538' : 'var(--text-muted)',
            }}
          >
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PerformancePage ──────────────────────────────────────────────────────────

export function PerformancePage() {
  const { user } = useAuth();
  const year = currentReviewYear();
  const { review, loading } = useMyPerformanceReview(user?.uid ?? '', year);

  // Self-assessment form state
  const [achievements,  setAchievements]  = useState('');
  const [challenges,    setChallenges]    = useState('');
  const [trainingNeeds, setTrainingNeeds] = useState('');
  const [careerGoals,   setCareerGoals]   = useState('');
  const [selfRating,    setSelfRating]    = useState(3);
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');

  // Section accordion state
  const [openSection, setOpenSection] = useState<string | null>('self');

  const handleSubmitSelf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!achievements.trim()) { setError('Please describe your key achievements.'); return; }
    if (!challenges.trim())   { setError('Please describe challenges you faced.'); return; }
    setSaving(true);
    setError('');
    try {
      await submitSelfAssessment(user.uid, year, {
        achievements: achievements.trim(),
        challenges:   challenges.trim(),
        trainingNeeds: trainingNeeds.trim(),
        careerGoals:   careerGoals.trim(),
        overallSelfRating: selfRating,
      });
    } catch {
      setError('Failed to submit. Please try again.');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl space-y-8">
        <div className="h-8 w-48 bg-(--glass-panel-bg) rounded animate-pulse" />
        <div className="h-24 bg-(--glass-panel-bg) rounded-2xl animate-pulse" />
      </div>
    );
  }

  const statusInfo = review ? STATUS_INFO[review.status] : null;
  const canSubmitSelf = review?.status === 'pending' || !review;

  return (
    <div className="max-w-2xl space-y-6">
      {/* ── Header ── */}
      <PageHeader
        title="My Performance Review"
        subtitle={`${year} Annual Review`}
        pinKey="hrms.performance"
      />

      {/* ── No review created yet ── */}
      {!review && (
        <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) px-6 py-10 text-center">
          <TrendingUp size={32} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            No review cycle started yet
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            HR will initiate the {year} review cycle. You'll see your form here once it's started.
          </p>
        </div>
      )}

      {/* ── Status banner ── */}
      {review && statusInfo && (
        <div className="rounded-2xl p-4 flex items-start gap-3"
          style={{ backgroundColor: statusInfo.bg }}>
          <statusInfo.icon size={18} style={{ color: statusInfo.color }} className="shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold" style={{ color: statusInfo.color }}>
              {statusInfo.title}
            </p>
            <p className="text-xs mt-0.5" style={{ color: statusInfo.color }}>
              {statusInfo.sub}
            </p>
          </div>
        </div>
      )}

      {/* ── Self-assessment form (if pending) ── */}
      {review?.status === 'pending' && (
        <form onSubmit={handleSubmitSelf} className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-6 space-y-5">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Self-Assessment</h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Be specific and honest — this feeds directly into your manager's review and HR finalization.
          </p>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Key Achievements This Year <span className="text-red-500">*</span>
            </label>
            <textarea
              value={achievements}
              onChange={(e) => setAchievements(e.target.value)}
              rows={3}
              placeholder="What were your biggest contributions and wins this year?"
              className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Challenges Faced <span className="text-red-500">*</span>
            </label>
            <textarea
              value={challenges}
              onChange={(e) => setChallenges(e.target.value)}
              rows={3}
              placeholder="What were the major challenges, and how did you handle them?"
              className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Training &amp; Development Needs
            </label>
            <textarea
              value={trainingNeeds}
              onChange={(e) => setTrainingNeeds(e.target.value)}
              rows={2}
              placeholder="Skills, certifications, or training you'd like to pursue…"
              className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Career Goals
            </label>
            <textarea
              value={careerGoals}
              onChange={(e) => setCareerGoals(e.target.value)}
              rows={2}
              placeholder="Where do you see yourself in 1–3 years?"
              className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>

          {/* Self-rating */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
              Overall Self-Rating
            </p>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => {
                const labels = ['Poor', 'Below Avg', 'Average', 'Good', 'Excellent'];
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setSelfRating(n)}
                    className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-all text-xs font-semibold"
                    style={{
                      backgroundColor: selfRating === n ? '#C9A961' : 'var(--shell-hover-hard)',
                      color: selfRating === n ? '#0B1538' : 'var(--text-muted)',
                    }}
                  >
                    <span className="text-base">{n}</span>
                    <span className="text-[9px]">{labels[n - 1]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="text-sm font-medium" style={{ color: '#DC2626' }}>{error}</p>}

          <div className="pt-1">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity"
              style={{ backgroundColor: '#0B1538', color: '#FFFFFF', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Submitting…' : 'Submit Self-Assessment'}
            </button>
          </div>
        </form>
      )}

      {/* ── Submitted self-assessment (readonly) ── */}
      {review?.selfAssessment && (
        <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
          <button
            type="button"
            onClick={() => setOpenSection(openSection === 'self' ? null : 'self')}
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-(--glass-panel-bg) transition-colors text-left"
          >
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Your Self-Assessment</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Submitted {review.selfAssessment.submittedAt
                  ? format(toDate(review.selfAssessment.submittedAt) ?? new Date(), 'd MMM yyyy')
                  : ''}
              </p>
            </div>
            {openSection === 'self'
              ? <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
              : <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />}
          </button>
          {openSection === 'self' && (
            <div className="px-6 pb-6 pt-2 border-t border-(--shell-border) space-y-4">
              {[
                { label: 'Achievements', val: review.selfAssessment.achievements },
                { label: 'Challenges',   val: review.selfAssessment.challenges },
                { label: 'Training Needs', val: review.selfAssessment.trainingNeeds },
                { label: 'Career Goals',   val: review.selfAssessment.careerGoals },
              ].map(({ label, val }) => val ? (
                <div key={label}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
                    {label}
                  </p>
                  <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{val}</p>
                </div>
              ) : null)}
              <div className="flex items-center gap-2 pt-1">
                <Star size={13} style={{ color: '#C9A961' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Self-rating: {review.selfAssessment.overallSelfRating} / 5
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Manager review (readonly) ── */}
      {review?.managerReview && (
        <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
          <button
            type="button"
            onClick={() => setOpenSection(openSection === 'mgr' ? null : 'mgr')}
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-(--glass-panel-bg) transition-colors text-left"
          >
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Manager's Review</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                by {review.managerReview.managerName} ·{' '}
                Overall: {review.managerReview.overallRating} / 5
              </p>
            </div>
            {openSection === 'mgr'
              ? <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
              : <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />}
          </button>
          {openSection === 'mgr' && (
            <div className="px-6 pb-6 pt-2 border-t border-(--shell-border) space-y-4">
              <div className="divide-y divide-(--shell-border)">
                <RatingDisplay label="Work Quality"  value={review.managerReview.workQuality} />
                <RatingDisplay label="Work Quantity" value={review.managerReview.workQuantity} />
                <RatingDisplay label="Initiative"    value={review.managerReview.initiative} />
                <RatingDisplay label="Communication" value={review.managerReview.communication} />
                <RatingDisplay label="Teamwork"      value={review.managerReview.teamwork} />
                <RatingDisplay label="Punctuality"   value={review.managerReview.punctuality} />
              </div>
              {review.managerReview.strengths && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Strengths</p>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{review.managerReview.strengths}</p>
                </div>
              )}
              {review.managerReview.areasForImprovement && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Areas for Improvement</p>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{review.managerReview.areasForImprovement}</p>
                </div>
              )}
              {review.managerReview.recommendedForPromotion && (
                <p className="text-xs font-semibold px-2 py-1 rounded-full inline-block"
                  style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                  ★ Recommended for Promotion
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Finalization / Increment details ── */}
      {review?.status === 'completed' && review.incrementPercentage !== undefined && (
        <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-6 space-y-4">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Increment Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--glass-panel-bg)', border: '1px solid var(--shell-border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
                Previous Salary
              </p>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {review.oldGrossSalary ? inr(review.oldGrossSalary) : '—'}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>per month</p>
            </div>
            <div className="rounded-xl p-4" style={{ backgroundColor: '#D1FAE5' }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#065F46' }}>
                Revised Salary
              </p>
              <p className="text-lg font-semibold" style={{ color: '#065F46' }}>
                {review.newGrossSalary ? inr(review.newGrossSalary) : '—'}
              </p>
              <p className="text-xs" style={{ color: '#065F46' }}>per month</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Increment: </span>
              <span className="font-semibold" style={{ color: '#059669' }}>{review.incrementPercentage}%</span>
            </div>
            {review.incrementEffectiveDate && (
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Effective: </span>
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {format(new Date(review.incrementEffectiveDate), 'd MMM yyyy')}
                </span>
              </div>
            )}
          </div>
          {review.hrNotes && (
            <p className="text-xs rounded-xl px-4 py-3" style={{ backgroundColor: 'var(--glass-panel-bg)', color: 'var(--text-primary)' }}>
              {review.hrNotes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
