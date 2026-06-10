import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { approvePayout, markPayoutPaid } from '../hooks/usePayouts';
import { Modal } from '../../../components/ui/Modal';
import { addWatermarkToAllPages } from '../../../lib/pdfWatermark';
import type { RmPayout, RmPayoutLineItem } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatPeriod(start: string, end: string): string {
  if (start === end) return start;
  return `${start} – ${end}`;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RmPayout['status'] }) {
  const cls: Record<RmPayout['status'], string> = {
    draft:    'badge-glass-muted',
    approved: 'badge-glass-info',
    paid:     'badge-glass-success',
  };
  const label: Record<RmPayout['status'], string> = {
    draft:    'Draft',
    approved: 'Approved',
    paid:     'Paid',
  };
  return (
    <span className={`${cls[status]} text-sm px-3 py-1`}>
      {label[status]}
    </span>
  );
}

// ─── MarkPaidModal ────────────────────────────────────────────────────────────

interface MarkPaidModalProps {
  isOpen: boolean;
  onClose: () => void;
  payoutId: string;
  rmDisplayName: string;
}

function MarkPaidModal({ isOpen, onClose, payoutId, rmDisplayName }: MarkPaidModalProps) {
  const [reference, setReference] = useState('');
  const [notes, setNotes]         = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function handleSave() {
    if (!reference.trim()) { setError('Payment reference is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await markPayoutPaid(payoutId, reference.trim(), notes.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark as paid.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Mark Payout as Paid — ${rmDisplayName}`}
      size="sm"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-lg hover:bg-(--shell-hover-soft) transition-colors"
            style={{ border: '1px solid var(--shell-border-mid)', color: 'var(--text-primary)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
          >
            {saving ? 'Saving…' : 'Confirm Payment'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Payment Reference <span style={{ color: '#f87171' }}>*</span>
          </label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="UTR / transaction ID"
            className="glass-inp text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes…"
            rows={3}
            className="glass-inp text-sm resize-none"
          />
        </div>
        {error && (
          <p
            className="text-sm rounded-lg px-3 py-2"
            style={{ color: '#f87171', backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)' }}
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ─── PDF generator ────────────────────────────────────────────────────────────

function generatePayoutPdf(payout: RmPayout, downloaderName: string): void {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // ── Header ──
  pdf.setFillColor(11, 21, 56); // navy
  pdf.rect(0, 0, 210, 28, 'F');
  pdf.setTextColor(201, 169, 97); // gold
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Finvastra Pulse', 14, 13);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.text('RM Payout Summary · Confidential', 14, 22);

  // ── Meta ──
  pdf.setTextColor(10, 10, 10);
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text(payout.rmDisplayName, 14, 40);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(139, 139, 133); // mute
  pdf.text(`Period: ${formatPeriod(payout.periodStart, payout.periodEnd)}`, 14, 47);
  pdf.text(`Status: ${payout.status.charAt(0).toUpperCase() + payout.status.slice(1)}`, 14, 53);
  if (payout.paymentReference) {
    pdf.text(`Payment ref: ${payout.paymentReference}`, 14, 59);
  }

  // ── Line items table ──
  const tableTop = payout.paymentReference ? 67 : 61;
  const rows = payout.lineItems.map((item: RmPayoutLineItem) => [
    item.leadId.slice(-8),
    item.product,
    item.providerName,
    formatCurrency(item.receivedAmount),
    `${item.payoutPercentage}%`,
    formatCurrency(item.payoutAmount),
  ]);

  autoTable(pdf, {
    startY: tableTop,
    head: [['Customer', 'Product', 'Bank / Provider', 'Received', '%', 'Payout']],
    body: rows,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [11, 21, 56], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [242, 239, 231] },
    columnStyles: {
      3: { halign: 'right' },
      4: { halign: 'center' },
      5: { halign: 'right', fontStyle: 'bold' },
    },
  });

  // ── Totals row ──
  const finalY: number = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  pdf.setFillColor(201, 169, 97); // gold
  pdf.rect(14, finalY, 182, 9, 'F');
  pdf.setTextColor(11, 21, 56);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Total', 16, finalY + 6);
  pdf.text(formatCurrency(payout.totalReceivedBase), 130, finalY + 6, { align: 'right' });
  pdf.text(formatCurrency(payout.totalPayout), 196, finalY + 6, { align: 'right' });

  // ── Watermark ──
  addWatermarkToAllPages(pdf, { downloaderName });

  // ── Save ──
  const safeName = payout.rmDisplayName.replace(/[^a-zA-Z0-9]/g, '-');
  pdf.save(`Finvastra-Payout-${safeName}-${payout.periodStart}.pdf`);
}

// ─── PayoutDetailPage ─────────────────────────────────────────────────────────

export function PayoutDetailPage() {
  const { payoutId } = useParams<{ payoutId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [payout, setPayout] = useState<RmPayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showPaidModal, setShowPaidModal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin' || profile?.misAccess === 'admin';

  useEffect(() => {
    if (!payoutId) { setNotFound(true); setLoading(false); return; }
    const unsub = onSnapshot(
      doc(db, 'rm_payouts', payoutId),
      (snap) => {
        if (snap.exists()) {
          setPayout({ id: snap.id, ...snap.data() } as RmPayout);
        } else {
          setNotFound(true);
        }
        setLoading(false);
      },
      () => { setLoading(false); setNotFound(true); },
    );
    return unsub;
  }, [payoutId]);

  async function handleApprove() {
    if (!payout) return;
    setApproving(true);
    setActionError(null);
    try {
      await approvePayout(payout.id, profile?.userId ?? '');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Approval failed.');
    } finally {
      setApproving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm" style={{ color: 'var(--text-muted)' }}>
        Loading payout…
      </div>
    );
  }

  if (notFound || !payout) {
    return (
      <div className="max-w-lg mx-auto py-20 text-center">
        <p className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Payout not found</p>
        <button
          onClick={() => navigate('/mis/payouts')}
          className="text-sm underline"
          style={{ color: 'var(--text-muted)' }}
        >
          Back to Payouts
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <button
        onClick={() => navigate('/mis/payouts')}
        className="text-sm mb-4 transition-opacity hover:opacity-60 block"
        style={{ color: 'var(--text-muted)' }}
      >
        ← Payouts
      </button>

      {/* Header card */}
      <div className="glass-panel p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1
                className="text-2xl"
                style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: 'var(--text-primary)' }}
              >
                {payout.rmDisplayName}
              </h1>
              {isAdmin && payout.rmId && (
                <Link
                  to={`/hrms/employees/${payout.rmId}`}
                  className="flex items-center gap-0.5 text-xs font-medium transition-opacity hover:opacity-70"
                  style={{ color: '#C9A961' }}
                >
                  HR Profile →
                </Link>
              )}
            </div>
            <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
              Period: <strong style={{ color: 'var(--text-primary)' }}>{formatPeriod(payout.periodStart, payout.periodEnd)}</strong>
            </p>
            <StatusBadge status={payout.status} />
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 items-end">
            {isAdmin && payout.status === 'draft' && (
              <button
                onClick={handleApprove}
                disabled={approving}
                className="px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
              >
                {approving ? 'Approving…' : 'Approve'}
              </button>
            )}
            {isAdmin && payout.status === 'approved' && (
              <button
                onClick={() => setShowPaidModal(true)}
                className="px-4 py-2 text-sm font-semibold rounded-lg transition-colors"
                style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
              >
                Mark as Paid
              </button>
            )}
            <button
              onClick={() => generatePayoutPdf(payout, profile?.displayName ?? '')}
              className="px-4 py-2 text-sm font-semibold rounded-lg hover:bg-(--shell-hover-soft) transition-colors"
              style={{ border: '1px solid var(--shell-border-mid)', color: 'var(--text-primary)' }}
            >
              Download Payout Summary
            </button>
          </div>
        </div>

        {actionError && (
          <p
            className="mt-3 text-sm rounded-lg px-3 py-2"
            style={{ color: '#f87171', backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)' }}
          >
            {actionError}
          </p>
        )}

        {/* Payment details (when paid) */}
        {payout.status === 'paid' && (
          <div
            className="mt-4 pt-4 grid grid-cols-2 gap-4 text-sm"
            style={{ borderTop: '1px solid var(--shell-border)' }}
          >
            <div>
              <span
                className="block text-xs font-semibold uppercase tracking-wide mb-0.5"
                style={{ color: 'var(--text-muted)' }}
              >
                Payment Reference
              </span>
              <span style={{ color: 'var(--text-primary)' }}>{payout.paymentReference ?? '—'}</span>
            </div>
            {payout.paymentNotes && (
              <div>
                <span
                  className="block text-xs font-semibold uppercase tracking-wide mb-0.5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Notes
                </span>
                <span style={{ color: 'var(--text-primary)' }}>{payout.paymentNotes}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="glass-panel glass-card px-5 py-4">
          <span
            className="block text-xs font-semibold uppercase tracking-wide mb-1"
            style={{ color: 'var(--text-muted)' }}
          >
            Total Received (Base)
          </span>
          <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {formatCurrency(payout.totalReceivedBase)}
          </span>
        </div>
        <div className="glass-panel glass-card px-5 py-4">
          <span
            className="block text-xs font-semibold uppercase tracking-wide mb-1"
            style={{ color: 'var(--text-muted)' }}
          >
            RM Payout
          </span>
          <span className="text-2xl font-bold" style={{ color: '#C9A961' }}>
            {formatCurrency(payout.totalPayout)}
          </span>
        </div>
        <div className="glass-panel glass-card px-5 py-4">
          <span
            className="block text-xs font-semibold uppercase tracking-wide mb-1"
            style={{ color: 'var(--text-muted)' }}
          >
            Line Items
          </span>
          <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {payout.lineItems.length}
          </span>
        </div>
      </div>

      {/* Line items table */}
      <div className="glass-panel overflow-hidden">
        <div
          className="px-6 py-4"
          style={{ borderBottom: '1px solid var(--shell-border)' }}
        >
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Commission Line Items</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Each row is one paid commission record included in this payout.
          </p>
        </div>
        {payout.lineItems.length === 0 ? (
          <div className="px-8 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No line items.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--shell-hover-soft)', borderBottom: '1px solid var(--shell-border)' }}>
                <th className="px-5 py-3 text-left font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Customer</th>
                <th className="px-5 py-3 text-left font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Product</th>
                <th className="px-5 py-3 text-left font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Bank / Provider</th>
                <th className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Received</th>
                <th className="px-5 py-3 text-center font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>%</th>
                <th className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Payout Amount</th>
              </tr>
            </thead>
            <tbody>
              {payout.lineItems.map((item) => (
                <tr
                  key={item.commissionRecordId}
                  className="hover:bg-(--shell-hover-soft) transition-colors"
                  style={{ borderBottom: '1px solid var(--shell-border)' }}
                >
                  <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    …{item.leadId.slice(-8)}
                  </td>
                  <td className="px-5 py-3" style={{ color: 'var(--text-primary)' }}>
                    {item.product}
                  </td>
                  <td className="px-5 py-3" style={{ color: 'var(--text-primary)' }}>
                    {item.providerName}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {formatCurrency(item.receivedAmount)}
                  </td>
                  <td className="px-5 py-3 text-center tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {item.payoutPercentage}%
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums font-bold" style={{ color: '#C9A961' }}>
                    {formatCurrency(item.payoutAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Total row */}
            <tfoot>
              <tr style={{ backgroundColor: '#C9A961' }}>
                <td className="px-5 py-3 font-bold text-sm" style={{ color: '#0B1538' }} colSpan={3}>
                  Total
                </td>
                <td className="px-5 py-3 text-right font-bold tabular-nums" style={{ color: '#0B1538' }}>
                  {formatCurrency(payout.totalReceivedBase)}
                </td>
                <td />
                <td className="px-5 py-3 text-right font-bold tabular-nums" style={{ color: '#0B1538' }}>
                  {formatCurrency(payout.totalPayout)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Mark as paid modal */}
      <MarkPaidModal
        isOpen={showPaidModal}
        onClose={() => setShowPaidModal(false)}
        payoutId={payout.id}
        rmDisplayName={payout.rmDisplayName}
      />
    </div>
  );
}
