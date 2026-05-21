import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrackerData {
  applicantFirstName: string;
  loanType: string;
  ticketSizeL: number;       // in lakhs, rounded
  bankName: string;
  currentStatus: string;
  submittedDate: string;
  expectedDecisionDate: string | null;
  referenceId: string;       // last 8 chars of submissionId
  lastUpdated: string;
}

// ─── Stage config ─────────────────────────────────────────────────────────────

const PUBLIC_STAGES = ['Submitted', 'Under Review', 'Sanctioned', 'Disbursed'] as const;
const STATUS_TO_STAGE: Record<string, number> = {
  submitted: 0,
  in_review: 1,
  sanctioned: 2,
  disbursed: 3,
};

// ─── Stage Stepper ────────────────────────────────────────────────────────────

function StageStepper({ currentStatus }: { currentStatus: string }) {
  const isRejected = currentStatus === 'rejected';
  const activeIdx = STATUS_TO_STAGE[currentStatus] ?? -1;

  return (
    <div className="mt-5">
      <div className="flex items-start justify-between overflow-x-auto pb-1">
        {PUBLIC_STAGES.map((label, i) => {
          const done   = !isRejected && i < activeIdx;
          const active = !isRejected && i === activeIdx;
          const future = isRejected || i > activeIdx;
          return (
            <div key={label} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{
                    backgroundColor: done   ? '#0B1538'
                                   : active ? '#C9A961'
                                   : '#F1F5F9',
                    color: done   ? '#C9A961'
                         : active ? '#0B1538'
                         : '#94A3B8',
                    border: active ? '2px solid #C9A961' : 'none',
                  }}>
                  {done ? '✓' : i + 1}
                </div>
                <p
                  className="text-[10px] font-medium mt-1.5 text-center leading-tight"
                  style={{ color: active ? '#0B1538' : done ? '#475569' : '#94A3B8' }}>
                  {label}
                </p>
              </div>
              {i < PUBLIC_STAGES.length - 1 && (
                <div
                  className="h-0.5 flex-1 mt-[-20px] mx-1"
                  style={{ backgroundColor: done ? '#0B1538' : '#E2E8F0' }}
                />
              )}
            </div>
          );
        })}
      </div>

      {isRejected && (
        <div className="mt-4 flex items-center justify-center">
          <span
            className="text-sm font-semibold px-4 py-1.5 rounded-full"
            style={{ backgroundColor: '#FFF1F2', color: '#9F1239' }}>
            Application Declined
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function CustomerTrackerPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData]       = useState<TrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    if (!token) return;
    fetch(`/api/track/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setLoading(false); return; }
        setData(d);
        setLoading(false);
      })
      .catch(() => { setError('Unable to load application status.'); setLoading(false); });
  }, [token]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FAFAF7' }}>
      {/* Brand bar */}
      <div className="w-full py-3 px-5" style={{ backgroundColor: '#0B1538' }}>
        <span
          style={{
            color:      '#C9A961',
            fontFamily: '"Fraunces", Georgia, serif',
            fontStyle:  'italic',
            fontWeight: 300,
            fontSize:   '1.25rem',
            letterSpacing: '0.01em',
          }}>
          Finvastra
        </span>
      </div>

      {/* Content */}
      <div className="max-w-[420px] mx-auto px-4 py-8">
        {loading && (
          <div className="animate-pulse space-y-4 mt-8">
            <div className="h-6 bg-slate-200 rounded w-48" />
            <div className="h-4 bg-slate-200 rounded w-72" />
            <div className="h-40 bg-slate-100 rounded-2xl mt-6" />
          </div>
        )}

        {!loading && error && (
          <div
            className="mt-10 text-center rounded-2xl p-8 border border-slate-200"
            style={{ backgroundColor: '#fff' }}>
            <p
              className="text-2xl mb-2"
              style={{
                fontFamily: '"Fraunces", Georgia, serif',
                fontStyle:  'italic',
                fontWeight: 300,
                color: '#0B1538',
              }}>
              Link Expired
            </p>
            <p className="text-sm mt-3" style={{ color: '#8B8B85' }}>{error}</p>
            <p className="text-sm mt-5" style={{ color: '#2A2A2A' }}>
              Please contact your advisor for an updated link.
            </p>
          </div>
        )}

        {!loading && data && (
          <>
            {/* Greeting */}
            <div className="mb-6">
              <p
                style={{
                  fontFamily: '"Fraunces", Georgia, serif',
                  fontStyle:  'italic',
                  fontWeight: 300,
                  fontSize:   '1.75rem',
                  color:      '#0B1538',
                  lineHeight: 1.2,
                }}>
                Hello {data.applicantFirstName},
              </p>
              <p className="mt-1 text-sm" style={{ color: '#8B8B85' }}>
                Here is the status of your loan application.
              </p>
            </div>

            {/* Application summary card */}
            <div
              className="rounded-2xl border border-slate-200 p-5 space-y-4"
              style={{ backgroundColor: '#fff' }}>
              {/* Bank + loan type */}
              <div className="flex items-start gap-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: '#F2EFE7' }}>
                  {/* Briefcase icon */}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="#0B1538" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                </div>
                <div>
                  <p className="text-base font-semibold" style={{ color: '#0A0A0A' }}>
                    {data.bankName}
                  </p>
                  <p className="text-sm" style={{ color: '#8B8B85' }}>
                    {data.loanType}
                  </p>
                </div>
              </div>

              {/* Figures */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>
                    Loan Amount
                  </p>
                  <p className="text-sm font-medium mt-0.5" style={{ color: '#0A0A0A' }}>
                    ₹{data.ticketSizeL}L
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>
                    Reference
                  </p>
                  <p className="text-sm font-medium mt-0.5 font-mono" style={{ color: '#0A0A0A' }}>
                    {data.referenceId}
                  </p>
                </div>
                {data.submittedDate && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>
                      Submitted
                    </p>
                    <p className="text-sm font-medium mt-0.5" style={{ color: '#0A0A0A' }}>
                      {data.submittedDate}
                    </p>
                  </div>
                )}
                {data.expectedDecisionDate && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>
                      Expected Decision
                    </p>
                    <p className="text-sm font-medium mt-0.5" style={{ color: '#0A0A0A' }}>
                      {data.expectedDecisionDate}
                    </p>
                  </div>
                )}
              </div>

              {/* Stage progress */}
              <div className="border-t border-slate-100 pt-4">
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>
                  Application Progress
                </p>
                <StageStepper currentStatus={data.currentStatus} />
              </div>

              {/* Last updated */}
              {data.lastUpdated && (
                <p className="text-xs border-t border-slate-100 pt-3" style={{ color: '#8B8B85' }}>
                  Last updated: {data.lastUpdated}
                </p>
              )}
            </div>

            {/* Footer */}
            <p className="mt-8 text-xs text-center leading-relaxed" style={{ color: '#8B8B85' }}>
              Need help? Your advisor is available.{' '}
              <span style={{ color: '#0B1538', fontWeight: 500 }}>Contact Finvastra.</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
