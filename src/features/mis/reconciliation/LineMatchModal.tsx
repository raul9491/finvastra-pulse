import { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { Modal } from '../../../components/ui/Modal';
import { manualMatch } from '../hooks/useReconciliation';
import type { StatementLine, CommissionRecord } from '../../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  isOpen: boolean;
  onClose: () => void;
  statementId: string;
  line: StatementLine;
  reconciledBy: string;
}

interface RecordWithId extends CommissionRecord {
  id: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function diffSign(diff: number): string {
  return diff >= 0 ? `+${fmt(diff)}` : `-${fmt(Math.abs(diff))}`;
}

// ─── LineMatchModal ───────────────────────────────────────────────────────────

export function LineMatchModal({ isOpen, onClose, statementId, line, reconciledBy }: Props) {
  const [records, setRecords] = useState<RecordWithId[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RecordWithId | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load commission records filtered by providerId whenever the modal opens
  useEffect(() => {
    if (!isOpen) return;
    setRecords([]);
    setSearch('');
    setSelected(null);
    setConfirming(false);
    setError(null);
    setRecordsLoading(true);

    getDocs(
      query(
        collection(db, 'commission_records'),
        where('providerId', '==', line.providerId),
      ),
    )
      .then((snap) => {
        setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RecordWithId)));
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load commission records.');
      })
      .finally(() => setRecordsLoading(false));
  }, [isOpen, line.providerId]);

  // Client-side filter — CommissionRecord has no `product` field; search on
  // leadId / opportunityId / providerId / notes / slabId instead
  const searchLower = search.toLowerCase();
  const filtered = records.filter((r) => {
    if (!searchLower) return true;
    return (
      r.leadId.toLowerCase().includes(searchLower) ||
      r.opportunityId.toLowerCase().includes(searchLower) ||
      r.providerId.toLowerCase().includes(searchLower) ||
      (r.notes ?? '').toLowerCase().includes(searchLower)
    );
  });

  async function handleConfirmMatch() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await manualMatch(
        statementId,
        line.id,
        selected.id,
        reconciledBy,
        line.parsedAmount,
        selected.calculatedCommission,
      );
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save match.');
    } finally {
      setSaving(false);
    }
  }

  const diff = selected !== null ? line.parsedAmount - selected.calculatedCommission : 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Match Statement Line"
      size="lg"
    >
      <div className="flex flex-col gap-5">
        {/* ── Statement line summary ── */}
        <div className="rounded-xl border border-slate-200 bg-paper p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-mute mb-3">
            Statement Line
          </p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-mute mb-0.5">Date</p>
              <p className="font-medium text-ink">{line.parsedDate}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-mute mb-0.5">Description</p>
              <p className="font-medium text-ink truncate">{line.rawDescription}</p>
            </div>
            <div>
              <p className="text-xs text-mute mb-0.5">Amount</p>
              <p className="font-semibold text-navy text-base">{fmt(line.parsedAmount)}</p>
            </div>
          </div>
        </div>

        {/* ── Commission record search ── */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-mute">
            Search Commission Records
          </p>

          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelected(null);
              setConfirming(false);
            }}
            placeholder="Search by lead ID, opportunity ID, provider…"
            className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-navy"
          />

          {recordsLoading && (
            <p className="text-sm text-mute py-4 text-center">Loading records…</p>
          )}

          {!recordsLoading && filtered.length === 0 && (
            <p className="text-sm text-mute py-4 text-center">No matching records found.</p>
          )}

          {!recordsLoading && filtered.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {filtered.map((record) => {
                const isSelected = selected?.id === record.id;
                return (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => { setSelected(record); setConfirming(true); }}
                    className={[
                      'w-full text-left px-4 py-3 text-sm transition-colors',
                      isSelected ? 'bg-paper-warm' : 'bg-white hover:bg-paper',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-medium text-navy truncate">
                          {record.providerId}
                        </span>
                        <span className="text-xs text-mute truncate">
                          Lead: {record.leadId.slice(0, 12)}… &middot; Opp: {record.opportunityId.slice(0, 12)}…
                        </span>
                        <span className="text-xs text-mute">
                          Expected payout: {record.expectedPayoutDate}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="font-semibold text-ink">
                          {fmt(record.calculatedCommission)}
                        </span>
                        <span
                          className={[
                            'ml-1.5 text-xs font-medium px-1.5 py-0.5 rounded',
                            record.status === 'paid'
                              ? 'bg-green-100 text-green-700'
                              : record.status === 'clawed_back'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700',
                          ].join(' ')}
                        >
                          {record.status}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Confirmation panel ── */}
        {confirming && selected !== null && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-mute mb-3">
              Match Preview
            </p>
            <div className="flex items-center gap-4 text-sm mb-4">
              <span className="text-ink">
                Statement: <strong>{fmt(line.parsedAmount)}</strong>
              </span>
              <span className="text-mute">&#8594;</span>
              <span className="text-ink">
                Our record: <strong>{fmt(selected.calculatedCommission)}</strong>
              </span>
              <span
                className={[
                  'font-semibold ml-auto',
                  diff === 0
                    ? 'text-green-600'
                    : Math.abs(diff) / Math.max(selected.calculatedCommission, 1) <= 0.02
                    ? 'text-green-600'
                    : 'text-amber-600',
                ].join(' ')}
              >
                Difference: {diffSign(diff)}
              </span>
            </div>

            {Math.abs(diff) > 0 &&
              Math.abs(diff) / Math.max(selected.calculatedCommission, 1) > 0.02 && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                Amount differs by more than 2%. This will be flagged as a discrepancy.
              </p>
            )}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleConfirmMatch}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-navy text-white disabled:opacity-50 hover:bg-navy-soft transition-colors"
              >
                {saving ? 'Saving…' : 'Match anyway →'}
              </button>
              <button
                type="button"
                onClick={() => { setSelected(null); setConfirming(false); }}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-200 text-ink hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
