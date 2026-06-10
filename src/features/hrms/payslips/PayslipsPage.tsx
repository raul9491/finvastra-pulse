import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, Download, X, Receipt } from 'lucide-react';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useMyPayslips } from '../hooks/usePayslips';
import { generatePayslipPdf } from './payslipPdf';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Skeleton } from '../../../components/ui/Skeleton';
import type { Payslip, UserProfile, PayslipExtras, LeaveBalance } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMonth(month: string): string {
  const [yr, mo] = month.split('-');
  return new Date(+yr, +mo - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}

function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

// ─── Edit Profile button ──────────────────────────────────────────────────────
function EditProfileButton() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate('/hrms/settings')}
      className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-(--shell-hover-hard) text-white hover:bg-(--shell-hover-hard) transition-colors border border-(--shell-border-mid)"
    >
      Edit Profile
    </button>
  );
}

// ─── Employee profile banner ──────────────────────────────────────────────────

function ProfileBanner({ profile }: { profile: UserProfile }) {
  const initials = profile.displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative mb-16">
      {/* Gradient banner */}
      <div
        className="h-28 rounded-2xl"
        style={{ background: 'linear-gradient(135deg, #0B1538 0%, #1B2A4E 100%)' }}
      />

      {/* Avatar — overlaps banner by ~52px */}
      <div className="absolute left-8 -bottom-10">
        {profile.photoURL ? (
          <img
            src={profile.photoURL}
            alt={profile.displayName}
            className="w-24 h-24 rounded-full object-cover"
            style={{ border: '4px solid white', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}
          />
        ) : (
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-bold text-gold"
            style={{ backgroundColor: 'var(--text-primary)', border: '4px solid white', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}
          >
            {initials}
          </div>
        )}
      </div>

      {/* Edit Profile button — top-right of the banner */}
      <div className="absolute right-6 bottom-3">
        <EditProfileButton />
      </div>
    </div>
  );
}

// ─── Name / meta row below banner ────────────────────────────────────────────

function ProfileMeta({ profile }: { profile: UserProfile }) {
  return (
    <div className="px-2 mb-8">
      <h2
        className="text-2xl text-(--text-primary) mb-1"
        style={{ fontFamily: '"Fraunces", Georgia, serif', fontWeight: 600 }}
      >
        {profile.displayName}
      </h2>
      <div className="flex flex-wrap items-center gap-3 text-xs text-(--text-muted)">
        {profile.designation && <span>{profile.designation}</span>}
        {profile.designation && profile.department && <span className="text-(--text-muted)">·</span>}
        {profile.department && <span>{profile.department}</span>}
        <span className="text-(--text-muted)">·</span>
        <span className="font-mono">
          ID {profile.employeeId ?? profile.userId.slice(-8).toUpperCase()}
        </span>
      </div>
    </div>
  );
}

// ─── Inline payslip breakdown ─────────────────────────────────────────────────

function PayslipBreakdown({
  payslip,
  onClose,
  onDownload,
}: {
  payslip: Payslip;
  onClose: () => void;
  onDownload: () => void;
}) {
  const earnings = [
    { label: 'Basic Salary',          value: payslip.basicSalary },
    { label: 'HRA',                   value: payslip.hra },
    { label: 'Conveyance Allowance',  value: payslip.conveyanceAllowance },
    { label: 'Medical Allowance',     value: payslip.medicalAllowance },
    { label: 'Other Allowances',      value: payslip.otherAllowances },
  ];
  const deductions = [
    { label: 'Provident Fund',        value: payslip.pf },
    { label: 'Professional Tax',      value: payslip.professionalTax },
    { label: 'TDS',                   value: payslip.tds },
    { label: `LOP (${payslip.lopDays} days)`, value: payslip.otherDeductions },
    { label: 'Other Deductions',      value: payslip.otherDeductions },
  ];

  return (
    <tr>
      <td colSpan={6} className="px-0 py-0">
        <div
          className="mx-4 mb-4 rounded-2xl overflow-hidden"
          style={{ border: '1px solid #E5E7EB' }}
        >
          {/* Header row */}
          <div className="flex items-center justify-between px-5 py-3 bg-paper">
            <span className="text-xs font-bold uppercase tracking-widest text-(--text-muted)">
              Payslip breakdown — {formatMonth(payslip.month)}
            </span>
            <button onClick={onClose} className="text-(--text-muted) hover:text-(--text-primary) transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* Two-column breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-(--shell-border)">
            {/* Earnings */}
            <div className="p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-emerald-700">
                Earnings
              </p>
              {earnings.map(({ label, value }) => (
                <div key={label} className="flex justify-between py-1.5 text-sm">
                  <span className="text-(--text-primary)">{label}</span>
                  <span className="font-medium text-(--text-primary)">{formatCurrency(value)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-2.5 mt-2 border-t border-(--shell-border) text-sm font-semibold">
                <span className="text-(--text-primary)">Total Earnings</span>
                <span className="text-emerald-700">{formatCurrency(payslip.totalEarnings)}</span>
              </div>
            </div>

            {/* Deductions */}
            <div className="p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-red-600">
                Deductions
              </p>
              {deductions.map(({ label, value }) => (
                <div key={label} className="flex justify-between py-1.5 text-sm">
                  <span className="text-(--text-primary)">{label}</span>
                  <span className="font-medium text-(--text-primary)">{formatCurrency(value)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-2.5 mt-2 border-t border-(--shell-border) text-sm font-semibold">
                <span className="text-(--text-primary)">Total Deductions</span>
                <span className="text-red-600">{formatCurrency(payslip.totalDeductions)}</span>
              </div>
            </div>
          </div>

          {/* Net Pay box */}
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ backgroundColor: '#C9A961' }}
          >
            <span className="text-navy font-bold text-sm uppercase tracking-widest">Net Pay</span>
            <div className="flex items-center gap-4">
              <span className="text-navy font-bold text-xl">
                {formatCurrency(payslip.netPay)}
              </span>
              <Button variant="primary" size="sm" icon={<Download size={12} />} onClick={onDownload}>
                Download PDF
              </Button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── PayslipsPage ──────────────────────────────────────────────────────────────

export function PayslipsPage() {
  const { user, profile }        = useAuth();
  const { payslips, loading }    = useMyPayslips(user?.uid ?? '');
  const [expandedId, setExpanded] = useState<string | null>(null);

  // Supplementary data for the payslip PDF (bank details, UAN, gender).
  // Fetched once on mount — all fields are optional so a failed fetch is non-fatal.
  const [baseExtras, setBaseExtras] = useState<Omit<PayslipExtras, 'leaveBalance'>>({});

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    let cancelled = false;

    async function fetchBaseExtras() {
      const [sensSnap, detSnap] = await Promise.all([
        getDoc(doc(db, 'employee_sensitive', uid)),
        getDoc(doc(db, 'user_details',       uid)),
      ]);
      if (cancelled) return;

      const sens = (sensSnap.exists() ? sensSnap.data() : {}) as Record<string, unknown>;
      const dets = (detSnap.exists()  ? detSnap.data()  : {}) as Record<string, unknown>;

      setBaseExtras({
        gender:           typeof dets.gender       === 'string' ? dets.gender       : undefined,
        bankName:         typeof sens.bankName      === 'string' ? sens.bankName      : undefined,
        bankAccountLast4: typeof sens.bankAccountNo === 'string' ? sens.bankAccountNo.slice(-4) : undefined,
        pfNumber:         typeof sens.pfNumber      === 'string' ? sens.pfNumber      : undefined,
        uan:              typeof sens.uan           === 'string' ? sens.uan           : undefined,
      });
    }

    fetchBaseExtras().catch(() => {});
    return () => { cancelled = true; };
  }, [user?.uid]);

  async function handleDownload(payslip: Payslip) {
    if (!profile || !user) return;

    // Fetch leave balance for the payslip's financial year
    const year = parseInt(payslip.month.split('-')[0], 10);
    let leaveBalance: PayslipExtras['leaveBalance'] = undefined;
    try {
      const lbSnap = await getDoc(doc(db, 'leave_balances', `${user.uid}_${year}`));
      if (lbSnap.exists()) {
        const lb = lbSnap.data() as LeaveBalance;
        leaveBalance = {
          sick:   { credited: lb.sick.total,   availed: lb.sick.used,   closing: lb.sick.remaining   },
          casual: { credited: lb.casual.total, availed: lb.casual.used, closing: lb.casual.remaining },
          earned: { credited: lb.earned.total, availed: lb.earned.used, closing: lb.earned.remaining },
        };
      }
    } catch { /* non-fatal — PDF still generates without leave section */ }

    const extras: PayslipExtras = {
      ...baseExtras,
      joiningDate: (profile as UserProfile).joiningDate,
      location:    (profile as UserProfile).location ?? 'Hyderabad',
      leaveBalance,
    };

    generatePayslipPdf(payslip, profile as UserProfile, 'save', extras);
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => (prev === id ? null : id));
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Profile banner (shows only when profile is loaded) */}
      {profile && <ProfileBanner profile={profile as UserProfile} />}
      {profile && <ProfileMeta  profile={profile as UserProfile} />}

      {/* Section title */}
      <h3
        className="text-3xl mb-1 text-(--text-primary)"
        style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300 }}
      >
        Payslips
      </h3>
      <p className="text-sm text-(--text-muted) mb-6">Last 12 months · click a row to expand</p>

      {/* Table — horizontally scrollable on mobile */}
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-140">
          <thead>
            <tr className="border-b border-(--shell-border) bg-paper">
              <th className="px-6 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Month</th>
              <th className="px-6 py-3.5 text-right text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Net Pay</th>
              <th className="px-6 py-3.5 text-right text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Working Days</th>
              <th className="px-6 py-3.5 text-right text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">Present</th>
              <th className="px-6 py-3.5 text-right text-[10px] font-bold uppercase tracking-widest text-(--text-muted)">LOP</th>
              <th className="px-6 py-3.5 text-right text-[10px] font-bold uppercase tracking-widest text-(--text-muted)" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <>
                <Skeleton.Row cols={6} />
                <Skeleton.Row cols={6} />
                <Skeleton.Row cols={6} />
                <Skeleton.Row cols={6} />
              </>
            )}

            {!loading && payslips.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    icon={Receipt}
                    title="No payslips yet"
                    body="Generated payslips will appear here once your HR team publishes them."
                  />
                </td>
              </tr>
            )}

            {!loading && payslips.map((payslip, idx) => (
              <>
                <tr
                  key={payslip.id}
                  onClick={() => toggleExpand(payslip.id)}
                  className="cursor-pointer hover:bg-paper transition-colors"
                  style={{ borderTop: idx > 0 ? '1px solid #F3F4F6' : undefined }}
                >
                  <td className="px-6 py-4 font-medium text-(--text-primary)">
                    {formatMonth(payslip.month)}
                  </td>
                  <td className="px-6 py-4 text-right font-semibold text-navy">
                    {formatCurrency(payslip.netPay)}
                  </td>
                  <td className="px-6 py-4 text-right text-(--text-primary)">{payslip.workingDays}</td>
                  <td className="px-6 py-4 text-right text-(--text-primary)">{payslip.presentDays}</td>
                  <td className="px-6 py-4 text-right text-(--text-primary)">{payslip.lopDays}</td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-(--text-muted)">
                      {expandedId === payslip.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </span>
                  </td>
                </tr>

                {/* Inline breakdown — renders as an extra row */}
                {expandedId === payslip.id && (
                  <PayslipBreakdown
                    key={`${payslip.id}-detail`}
                    payslip={payslip}
                    onClose={() => setExpanded(null)}
                    onDownload={() => handleDownload(payslip)}
                  />
                )}
              </>
            ))}
          </tbody>
        </table>
        </div>{/* /overflow-x-auto */}
      </div>
    </div>
  );
}
