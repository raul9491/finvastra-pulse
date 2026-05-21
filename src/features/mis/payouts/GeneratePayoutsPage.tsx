import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { usePayoutSlabs, generatePayouts, previewPayouts } from '../hooks/usePayouts';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import type { PayoutPreviewRow } from '../hooks/usePayouts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// ─── GeneratePayoutsPage ──────────────────────────────────────────────────────

export function GeneratePayoutsPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const isAdmin = profile?.role === 'admin' || profile?.misAccess === 'admin';
  if (!isAdmin) return <Navigate to="/mis/payouts" replace />;

  const { slabs } = usePayoutSlabs();
  const { employees } = useAllEmployees();

  // Current YYYY-MM
  const currentMonth = new Date().toISOString().slice(0, 7);

  const [period, setPeriod] = useState(currentMonth);
  const [previewRows, setPreviewRows] = useState<PayoutPreviewRow[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    if (!period) { setError('Please select a period.'); return; }
    setError(null);
    setPreviewing(true);
    try {
      const rows = await previewPayouts(period, period, slabs, employees);
      setPreviewRows(rows);
      if (rows.length === 0) {
        setError('No paid commission records found for this period.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed.');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleGenerate() {
    if (!period || !previewRows || previewRows.length === 0) return;
    setError(null);
    setGenerating(true);
    try {
      const count = await generatePayouts(
        period,
        period,
        slabs,
        employees,
        user?.uid ?? '',
      );
      navigate('/mis/payouts', {
        state: { successMessage: `${count} payout${count !== 1 ? 's' : ''} generated successfully.` },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed.');
      setGenerating(false);
    }
  }

  const noSlabCount = previewRows?.filter((r) => r.noSlabWarning).length ?? 0;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <button
          onClick={() => navigate('/mis/payouts')}
          className="text-sm transition-opacity hover:opacity-60"
          style={{ color: '#8B8B85' }}
        >
          ← Payouts
        </button>
      </div>
      <h1
        className="text-3xl mb-1"
        style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: '#0B1538' }}
      >
        Generate Payouts
      </h1>
      <p className="text-sm mb-8" style={{ color: '#8B8B85' }}>
        Preview payout calculations before committing. Only commission records marked{' '}
        <strong>Paid</strong> with an actual payout date in the selected period are included.
      </p>

      {/* Period selector */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
        <h2 className="text-base font-semibold mb-4" style={{ color: '#0B1538' }}>
          Select Period
        </h2>
        <div className="flex items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: '#0A0A0A' }}>
              Month <span className="text-red-500">*</span>
            </label>
            <input
              type="month"
              value={period}
              onChange={(e) => { setPeriod(e.target.value); setPreviewRows(null); setError(null); }}
              className="px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[#0B1538]"
            />
          </div>
          <button
            onClick={handlePreview}
            disabled={previewing || !period}
            className="px-5 py-2.5 text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
            style={{ backgroundColor: '#0B1538', color: '#FFFFFF' }}
          >
            {previewing ? 'Loading preview…' : 'Preview'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: '#FEF2F2', color: '#991B1B' }}>
          {error}
        </div>
      )}

      {/* Preview table */}
      {previewRows !== null && previewRows.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-base font-semibold" style={{ color: '#0B1538' }}>
              Payout Preview — {period}
            </h2>
            <span className="text-sm" style={{ color: '#8B8B85' }}>
              {previewRows.length} RM{previewRows.length !== 1 ? 's' : ''}
            </span>
          </div>

          {noSlabCount > 0 && (
            <div className="mx-6 mt-4 flex items-start gap-2 px-4 py-3 rounded-lg text-sm"
              style={{ backgroundColor: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
              <span>⚠</span>
              <span>
                {noSlabCount} RM{noSlabCount !== 1 ? 's have' : ' has'} no active slab configured —{' '}
                their payout will be ₹0. Configure slabs on the{' '}
                <button
                  onClick={() => navigate('/mis/admin/payout-slabs')}
                  className="underline font-semibold"
                >
                  Payout Slabs
                </button>{' '}
                page before generating.
              </span>
            </div>
          )}

          <table className="w-full text-sm mt-2">
            <thead>
              <tr style={{ backgroundColor: '#F2EFE7' }}>
                <th className="px-5 py-3 text-left font-semibold text-xs uppercase tracking-wide" style={{ color: '#0B1538' }}>RM Name</th>
                <th className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wide" style={{ color: '#0B1538' }}>Records</th>
                <th className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wide" style={{ color: '#0B1538' }}>Total Received</th>
                <th className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wide" style={{ color: '#0B1538' }}>Slab %</th>
                <th className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wide" style={{ color: '#0B1538' }}>Calculated Payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {previewRows.map((row, idx) => (
                <tr
                  key={row.rmId}
                  className={[
                    idx % 2 === 0 ? 'bg-white' : 'bg-[#FAFAF7]',
                    row.noSlabWarning ? 'opacity-60' : '',
                  ].join(' ')}
                >
                  <td className="px-5 py-3 font-medium" style={{ color: '#0A0A0A' }}>
                    {row.rmDisplayName}
                    {row.noSlabWarning && (
                      <span
                        className="ml-2 text-xs px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
                      >
                        No slab — ₹0 payout
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums" style={{ color: '#8B8B85' }}>
                    {row.recordCount}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums" style={{ color: '#0A0A0A' }}>
                    {formatCurrency(row.totalReceivedBase)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums" style={{ color: '#8B8B85' }}>
                    {row.slabPercentage}%
                  </td>
                  <td className="px-5 py-3 text-right font-bold tabular-nums" style={{ color: '#0B1538' }}>
                    {formatCurrency(row.calculatedPayout)}
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr style={{ backgroundColor: '#C9A961' }}>
                <td className="px-5 py-3 font-bold text-sm" style={{ color: '#0B1538' }}>Total</td>
                <td className="px-5 py-3 text-right font-semibold tabular-nums" style={{ color: '#0B1538' }}>
                  {previewRows.reduce((s, r) => s + r.recordCount, 0)}
                </td>
                <td className="px-5 py-3 text-right font-bold tabular-nums" style={{ color: '#0B1538' }}>
                  {formatCurrency(previewRows.reduce((s, r) => s + r.totalReceivedBase, 0))}
                </td>
                <td className="px-5 py-3" />
                <td className="px-5 py-3 text-right font-bold tabular-nums" style={{ color: '#0B1538' }}>
                  {formatCurrency(previewRows.reduce((s, r) => s + r.calculatedPayout, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Generate button */}
      {previewRows !== null && previewRows.length > 0 && (
        <div className="flex items-center gap-4">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-6 py-3 text-sm font-bold rounded-lg disabled:opacity-50 transition-colors"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
          >
            {generating
              ? 'Generating…'
              : `Generate ${previewRows.length} Payout${previewRows.length !== 1 ? 's' : ''}`}
          </button>
          <p className="text-xs" style={{ color: '#8B8B85' }}>
            This will create draft payout records. Payouts must be approved before marking as paid.
          </p>
        </div>
      )}
    </div>
  );
}
