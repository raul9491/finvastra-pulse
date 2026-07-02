import { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { Modal } from '../../../components/ui/Modal';
import { userFacingError } from '../../../lib/errors';
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
        setError(userFacingError(e, 'Could not load commission records — please try again.'));
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
      setError(userFacingError(e, 'Could not save the match — please try again.'));
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
        <div
          className="rounded-xl p-4"
          style={{ border: '1px solid var(--shell-border-mid)', backgroundColor: 'var(--shell-hover-soft)' }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wide mb-3"
            style={{ color: 'var(--text-muted)' }}
          >
            Statement Line
          </p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Date</p>
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{line.parsedDate}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Description</p>
              <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{line.rawDescription}</p>
            </div>
            <div>
              <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Amount</p>
              <p className="font-semibold text-base" style={{ color: '#C9A961' }}>{fmt(line.parsedAmount)}</p>
            </div>
          </div>
        </div>

        {/* ── Commission record search ── */}
        <div className="flex flex-col gap-3">
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
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
            className="glass-inp w-full text-sm"
          />

          {recordsLoading && (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>Loading records…</p>
          )}

          {!recordsLoading && filtered.length === 0 && (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No matching records found.</p>
          )}

          {!recordsLoading && filtered.length > 0 && (
            <div
              className="max-h-64 overflow-y-auto rounded-lg"
              style={{ border: '1px solid var(--shell-border-mid)' }}
            >
              {filtered.map((record) => {
                const isSelected = selected?.id === record.id;
                return (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => { setSelected(record); setConfirming(true); }}
                    className="w-full text-left px-4 py-3 text-sm transition-colors"
                    style={{
                      backgroundColor: isSelected ? 'rgba(201,169,97,0.10)' : 'transparent',
                      borderBottom: '1px solid var(--shell-border)',
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--glass-panel-bg)'; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {record.providerId}
                        </span>
                        <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                          Lead: {record.leadId.slice(0, 12)}… &middot; Opp: {record.opportunityId.slice(0, 12)}…
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          Expected payout: {record.expectedPayoutDate}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {fmt(record.calculatedCommission)}
                        </span>
                        <span
                          className={[
                            'ml-1.5 text-xs font-medium',
                            record.status === 'paid'
                              ? 'badge-glass-success'
                              : record.status === 'clawed_back'
                              ? 'badge-glass-danger'
                              : 'badge-glass-warning',
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
          <div
            className="rounded-xl p-4"
            style={{ border: '1px solid var(--shell-border-mid)', backgroundColor: 'var(--shell-hover-soft)' }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-wide mb-3"
              style={{ color: 'var(--text-muted)' }}
            >
              Match Preview
            </p>
            <div className="flex items-center gap-4 text-sm mb-4 flex-wrap">
              <span style={{ color: 'var(--text-primary)' }}>
                Statement: <strong>{fmt(line.parsedAmount)}</strong>
              </span>
              <span style={{ color: 'var(--text-muted)' }}>&#8594;</span>
              <span style={{ color: 'var(--text-primary)' }}>
                Our record: <strong>{fmt(selected.calculatedCommission)}</strong>
              </span>
              <span
                className="font-semibold ml-auto"
                style={{
                  color:
                    diff === 0 || Math.abs(diff) / Math.max(selected.calculatedCommission, 1) <= 0.02
                      ? '#34d399'
                      : '#C9A961',
                }}
              >
                Difference: {diffSign(diff)}
              </span>
            </div>

            {Math.abs(diff) > 0 &&
              Math.abs(diff) / Math.max(selected.calculatedCommission, 1) > 0.02 && (
              <p
                className="text-xs rounded-lg px-3 py-2 mb-3"
                style={{ color: '#C9A961', backgroundColor: 'rgba(201,169,97,0.08)', border: '1px solid rgba(201,169,97,0.25)' }}
              >
                Amount differs by more than 2%. This will be flagged as a discrepancy.
              </p>
            )}

            {error && (
              <p
                className="text-sm rounded-lg px-3 py-2 mb-3"
                style={{ color: '#f87171', backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)' }}
              >
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleConfirmMatch}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
              >
                {saving ? 'Saving…' : 'Match anyway →'}
              </button>
              <button
                type="button"
                onClick={() => { setSelected(null); setConfirming(false); }}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:bg-(--shell-hover-soft)"
                style={{ border: '1px solid var(--shell-border-mid)', color: 'var(--text-primary)' }}
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
