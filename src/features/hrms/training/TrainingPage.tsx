/**
 * TrainingPage — Employee self-service view of their training records.
 * Path: /hrms/training    Access: all authenticated HRMS employees
 *
 * Shows enrolled (pending), completed, and expired training.
 * Compliance training with renewal deadlines highlighted.
 */

import { useMemo } from 'react';
import { format, differenceInDays } from 'date-fns';
import {
  BookOpen, CheckCircle2, Clock, AlertCircle, ExternalLink,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useMyTrainingRecords, useTrainingPrograms } from '../hooks/useTraining';
import type { TrainingCategory, TrainingRecord } from '../../../types';

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<TrainingCategory, { label: string; color: string; bg: string }> = {
  compliance:    { label: 'Compliance',    color: '#B45309', bg: '#FEF3C7' },
  certification: { label: 'Certification', color: '#0369A1', bg: '#E0F2FE' },
  skills:        { label: 'Skills',        color: '#065F46', bg: '#D1FAE5' },
  induction:     { label: 'Induction',     color: '#4C1D95', bg: '#EDE9FE' },
  safety:        { label: 'Safety',        color: '#9F1239', bg: '#FFE4E6' },
  other:         { label: 'Other',         color: '#374151', bg: '#F3F4F6' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function CategoryPill({ cat }: { cat: TrainingCategory }) {
  const m = CATEGORY_META[cat];
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ color: m.color, backgroundColor: m.bg }}>{m.label}</span>
  );
}

function TrainingCard({ record, renewalMonths }: { record: TrainingRecord & { effectiveStatus: TrainingRecord['status'] }; renewalMonths: number | null }) {
  const now = new Date();
  const s   = record.effectiveStatus;

  // Days until expiry (if any)
  const daysToExpiry = record.expiresAt ? differenceInDays(record.expiresAt.toDate(), now) : null;
  const expiringSoon = daysToExpiry != null && daysToExpiry >= 0 && daysToExpiry <= 30;

  const borderColor =
    s === 'expired'  ? '#DC2626' :
    expiringSoon     ? '#D97706' :
    s === 'enrolled' ? '#D97706' :
                       'var(--shell-hover-hard)';

  const headerBg =
    s === 'expired'  ? '#FFF1F2' :
    s === 'enrolled' ? '#FFFBEB' :
                       '#F0FDF4';

  return (
    <div className="bg-(--glass-panel-bg) rounded-2xl border overflow-hidden" style={{ borderColor }}>
      {/* Status header */}
      <div className="px-4 py-2.5 flex items-center justify-between" style={{ backgroundColor: headerBg }}>
        <div className="flex items-center gap-2">
          {s === 'expired'  && <AlertCircle  size={14} style={{ color: '#DC2626' }} />}
          {s === 'enrolled' && <Clock        size={14} style={{ color: '#D97706' }} />}
          {s === 'completed'&& <CheckCircle2 size={14} style={{ color: '#059669' }} />}
          <span className="text-xs font-bold"
            style={{ color: s === 'expired' ? '#DC2626' : s === 'enrolled' ? '#D97706' : '#059669' }}>
            {s === 'expired' ? 'Expired — renewal required'
              : s === 'enrolled' ? 'Pending completion'
              : expiringSoon ? `Valid — expires in ${daysToExpiry} day${daysToExpiry !== 1 ? 's' : ''}`
              : 'Completed'}
          </span>
        </div>
        <CategoryPill cat={record.programCategory} />
      </div>

      {/* Content */}
      <div className="p-4">
        <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{record.programName}</p>

        {record.notes && (
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{record.notes}</p>
        )}

        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3">
          {record.enrolledAt && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Enrolled</p>
              <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>
                {format(record.enrolledAt.toDate(), 'd MMM yyyy')}
              </p>
            </div>
          )}
          {record.completedAt && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Completed</p>
              <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>
                {format(record.completedAt.toDate(), 'd MMM yyyy')}
              </p>
            </div>
          )}
          {record.expiresAt && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                {s === 'expired' ? 'Expired on' : 'Valid until'}
              </p>
              <p className="text-xs font-medium mt-0.5"
                style={{ color: s === 'expired' ? '#DC2626' : expiringSoon ? '#D97706' : '#059669' }}>
                {format(record.expiresAt.toDate(), 'd MMM yyyy')}
              </p>
            </div>
          )}
          {renewalMonths && !record.expiresAt && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Renewal</p>
              <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>Every {renewalMonths} months</p>
            </div>
          )}
        </div>

        {record.certificateUrl && (
          <a href={record.certificateUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold transition-colors hover:opacity-70"
            style={{ color: '#0369A1' }}>
            <ExternalLink size={12} />View Certificate
          </a>
        )}

        {(s === 'enrolled') && (
          <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            Contact HR to update your completion status once you've completed this training.
          </p>
        )}
        {(s === 'expired') && (
          <p className="mt-3 text-xs font-medium" style={{ color: '#DC2626' }}>
            This certification has expired. Please contact HR to schedule renewal.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function TrainingPage() {
  const { user } = useAuth();
  const { records, loading } = useMyTrainingRecords(user?.uid ?? '');
  const { programs }         = useTrainingPrograms();

  const now = new Date();

  const enriched = useMemo(() => records.map((r) => {
    let effectiveStatus: TrainingRecord['status'] = r.status;
    if (r.status === 'completed' && r.expiresAt && r.expiresAt.toDate() < now) {
      effectiveStatus = 'expired';
    }
    return { ...r, effectiveStatus };
  }), [records, now]);

  const pending   = enriched.filter((r) => r.effectiveStatus === 'enrolled');
  const expired   = enriched.filter((r) => r.effectiveStatus === 'expired');
  const completed = enriched.filter((r) => r.effectiveStatus === 'completed');

  const getProgramRenewal = (programId: string) =>
    programs.find((p) => p.id === programId)?.renewalPeriodMonths ?? null;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'var(--text-primary)' }}>
          <BookOpen size={20} style={{ color: '#C9A961' }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'Fraunces, serif' }}>
            My Training
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Track your training and certification status</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : records.length === 0 ? (
        <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-16 text-center">
          <BookOpen size={40} className="mx-auto mb-4 opacity-20" />
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>No training records yet</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            HR will assign training programs when they become relevant to your role.
          </p>
        </div>
      ) : (
        <>
          {/* Action required: expired + pending first */}
          {(expired.length > 0 || pending.length > 0) && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2"
                style={{ color: '#DC2626' }}>
                <AlertCircle size={13} />
                Action Required ({expired.length + pending.length})
              </h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {[...expired, ...pending].map((r) => (
                  <TrainingCard key={r.id} record={r} renewalMonths={getProgramRenewal(r.programId)} />
                ))}
              </div>
            </section>
          )}

          {/* Completed */}
          {completed.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2"
                style={{ color: '#059669' }}>
                <CheckCircle2 size={13} />
                Completed ({completed.length})
              </h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {completed.map((r) => (
                  <TrainingCard key={r.id} record={r} renewalMonths={getProgramRenewal(r.programId)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
