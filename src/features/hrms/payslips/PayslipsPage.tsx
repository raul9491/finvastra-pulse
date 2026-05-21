import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, Download, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useMyPayslips } from '../hooks/usePayslips';
import { generatePayslipPdf } from './payslipPdf';
import type { Payslip, UserProfile } from '../../../types';

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
      className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-white/10 text-white hover:bg-white/20 transition-colors border border-white/20"
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
            style={{ backgroundColor: '#0B1538', border: '4px solid white', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}
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
        className="text-2xl text-ink mb-1"
        style={{ fontFamily: '"Fraunces", Georgia, serif', fontWeight: 600 }}
      >
        {profile.displayName}
      </h2>
      <div className="flex flex-wrap items-center gap-3 text-xs text-mute">
        {profile.designation && <span>{profile.designation}</span>}
        {profile.designation && profile.department && <span className="text-slate-300">·</span>}
        {profile.department && <span>{profile.department}</span>}
        <span className="text-slate-300">·</span>
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
            <span className="text-xs font-bold uppercase tracking-widest text-mute">
              Payslip breakdown — {formatMonth(payslip.month)}
            </span>
            <button onClick={onClose} className="text-mute hover:text-ink transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* Two-column breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            {/* Earnings */}
            <div className="p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-emerald-700">
                Earnings
              </p>
              {earnings.map(({ label, value }) => (
                <div key={label} className="flex justify-between py-1.5 text-sm">
                  <span className="text-ink-soft">{label}</span>
                  <span className="font-medium text-ink">{formatCurrency(value)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-2.5 mt-2 border-t border-slate-200 text-sm font-semibold">
                <span className="text-ink">Total Earnings</span>
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
                  <span className="text-ink-soft">{label}</span>
                  <span className="font-medium text-ink">{formatCurrency(value)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-2.5 mt-2 border-t border-slate-200 text-sm font-semibold">
                <span className="text-ink">Total Deductions</span>
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
              <button
                onClick={onDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-navy text-gold hover:bg-navy-soft transition-colors"
              >
                <Download size={12} />
                Download PDF
              </button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-6 py-4">
          <div
            className="h-4 rounded animate-pulse bg-slate-200"
            style={{ width: i === 5 ? 80 : '100%' }}
          />
        </td>
      ))}
    </tr>
  );
}

// ─── PayslipsPage ──────────────────────────────────────────────────────────────

export function PayslipsPage() {
  const { user, profile }        = useAuth();
  const { payslips, loading }    = useMyPayslips(user?.uid ?? '');
  const [expandedId, setExpanded] = useState<string | null>(null);

  function handleDownload(payslip: Payslip) {
    if (!profile) return;
    generatePayslipPdf(payslip, profile as UserProfile);
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
        className="text-3xl mb-1 text-ink"
        style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300 }}
      >
        Payslips
      </h3>
      <p className="text-sm text-mute mb-6">Last 12 months · click a row to expand</p>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-paper">
              <th className="px-6 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-mute">Month</th>
              <th className="px-6 py-3.5 text-right text-[10px] font-bold uppercase tracking-widest text-mute">Net Pay</th>
              <th className="px-6 py-3.5 text-right text-[10px] font-bold uppercase tracking-widest text-mute">Working Days</th>
              <th className="px-6 py-3.5 text-right text-[10px] font-bold uppercase tracking-widest text-mute">Present</th>
              <th className="px-6 py-3.5 text-right text-[10px] font-bold uppercase tracking-widest text-mute">LOP</th>
              <th className="px-6 py-3.5 text-right text-[10px] font-bold uppercase tracking-widest text-mute" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <>
                <SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow />
              </>
            )}

            {!loading && payslips.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-16 text-center text-sm text-mute">
                  No payslips yet. Generated payslips will appear here.
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
                  <td className="px-6 py-4 font-medium text-ink">
                    {formatMonth(payslip.month)}
                  </td>
                  <td className="px-6 py-4 text-right font-semibold text-navy">
                    {formatCurrency(payslip.netPay)}
                  </td>
                  <td className="px-6 py-4 text-right text-ink-soft">{payslip.workingDays}</td>
                  <td className="px-6 py-4 text-right text-ink-soft">{payslip.presentDays}</td>
                  <td className="px-6 py-4 text-right text-ink-soft">{payslip.lopDays}</td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-mute">
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
      </div>
    </div>
  );
}
