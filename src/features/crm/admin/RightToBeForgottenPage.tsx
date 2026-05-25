import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { collection, where, query, getDocs } from 'firebase/firestore';
import { AlertTriangle, Search, ShieldOff, CheckCircle, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { db } from '../../../lib/firebase';
import { anonymiseLead, type RTBFResult } from '../../../lib/leadAnonymisation';
import type { Lead } from '../../../types';

type LeadWithId = Lead & { id: string };

type PageState =
  | { step: 'search' }
  | { step: 'confirm'; lead: LeadWithId }
  | { step: 'done'; result: RTBFResult };

const ERASURE_REASONS = [
  'Customer requested erasure',
  'Regulatory requirement',
  'Deceased',
  'Other',
] as const;

export function RightToBeForgottenPage() {
  const { profile } = useAuth();

  // ── All hooks unconditionally at the top — Rules of Hooks ───────────────────
  const [pageState, setPageState] = useState<PageState>({ step: 'search' });

  // Search state
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<LeadWithId[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  // Confirm state
  const [selectedReason, setSelectedReason] = useState<string>(ERASURE_REASONS[0]);
  const [reasonNotes, setReasonNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  // ── Guard (after all hooks) ─────────────────────────────────────────────────
  if (profile && profile.role !== 'admin') return <Navigate to="/crm/dashboard" replace />;

  async function handleSearch() {
    const trimmed = searchInput.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchError('');
    setSearchResults([]);
    setHasSearched(false);

    try {
      // Exact phone match (most reliable for RTBF — customer typically quotes their number)
      const isPhone = /^[6-9]\d{9}$/.test(trimmed);

      if (isPhone) {
        const snap = await getDocs(
          query(collection(db, 'leads'), where('phone', '==', trimmed), where('deleted', '==', false)),
        );
        setSearchResults(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeadWithId)));
      } else {
        // Name search: case-sensitive prefix match — inform user about limitations
        const snap = await getDocs(
          query(collection(db, 'leads'), where('displayName', '>=', trimmed), where('displayName', '<=', trimmed + ''), where('deleted', '==', false)),
        );
        setSearchResults(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeadWithId)));
        if (snap.empty) {
          setSearchError('No results. Name search is case-sensitive and prefix-only. Try searching by the customer\'s 10-digit phone number for an exact match.');
        }
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
      setHasSearched(true);
    }
  }

  async function handleAnonymise(lead: LeadWithId) {
    if (!profile) return;
    setProcessing(true);
    setConfirmError('');
    try {
      const fullReason = reasonNotes.trim()
        ? `${selectedReason}: ${reasonNotes.trim()}`
        : selectedReason;
      const result = await anonymiseLead(lead.id, profile.userId, fullReason);
      setPageState({ step: 'done', result });
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Anonymisation failed. Please try again.');
    } finally {
      setProcessing(false);
    }
  }

  function resetToSearch() {
    setPageState({ step: 'search' });
    setSearchInput('');
    setSearchResults([]);
    setHasSearched(false);
    setSearchError('');
    setSelectedReason(ERASURE_REASONS[0]);
    setReasonNotes('');
    setConfirmError('');
  }

  // ─── Search step ─────────────────────────────────────────────────────────────
  if (pageState.step === 'search') {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4 space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldOff className="w-5 h-5 text-[var(--gold)]" />
            <h1 className="text-2xl font-semibold text-[var(--navy)] font-[Fraunces]">
              Right to Be Forgotten
            </h1>
          </div>
          <p className="text-sm text-[var(--mute)]">
            Permanently anonymise a customer's personal data under the DPDP Act 2023 right to erasure.
            This action is irreversible.
          </p>
        </div>

        {/* Warning banner */}
        <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Anonymisation permanently replaces the customer's name, phone, email, and PAN with
            redacted placeholders. Opportunity records, commission records, and activity timestamps
            are preserved for regulatory audit purposes. This cannot be undone.
          </p>
        </div>

        {/* Search box */}
        <div className="bg-white rounded-2xl border border-[var(--paper-warm)] shadow-sm p-6 space-y-4">
          <h2 className="text-base font-medium text-[var(--ink)]">Find customer</h2>
          <p className="text-sm text-[var(--mute)]">
            Enter the customer's 10-digit phone number for an exact match, or their name for a
            prefix search.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Phone (e.g. 9876543210) or name"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)] focus:border-transparent"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !searchInput.trim()}
              className="flex items-center gap-2 bg-[var(--navy)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[var(--navy-soft)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Search className="w-4 h-4" />
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>

          {searchError && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              {searchError}
            </p>
          )}

          {/* Results */}
          {hasSearched && !searching && (
            <div className="space-y-2 pt-2">
              {searchResults.length === 0 && !searchError && (
                <p className="text-sm text-[var(--mute)] text-center py-4">
                  No customers found matching that query.
                </p>
              )}
              {searchResults.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center justify-between p-4 border border-gray-100 rounded-xl bg-[var(--paper-warm)] hover:border-[var(--gold)] transition-colors"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-[var(--ink)]">{lead.displayName}</p>
                    <p className="text-xs text-[var(--mute)]">{lead.phone}</p>
                    {lead.email && (
                      <p className="text-xs text-[var(--mute)]">{lead.email}</p>
                    )}
                    <p className="text-xs text-[var(--mute)]">
                      Source: {lead.source} &middot; ID: …{lead.id.slice(-6).toUpperCase()}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setPageState({ step: 'confirm', lead });
                      setConfirmError('');
                    }}
                    className="text-sm font-medium text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    Select
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Confirm step ─────────────────────────────────────────────────────────────
  if (pageState.step === 'confirm') {
    const { lead } = pageState;
    return (
      <div className="max-w-2xl mx-auto py-10 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2">
          <button
            onClick={resetToSearch}
            className="text-[var(--mute)] hover:text-[var(--ink)] transition-colors"
            aria-label="Back to search"
          >
            <X className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-semibold text-[var(--navy)] font-[Fraunces]">
            Confirm Anonymisation
          </h1>
        </div>

        {/* Lead summary */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-1">
          <p className="text-xs text-[var(--mute)] uppercase tracking-wide font-medium mb-2">Customer</p>
          <p className="text-base font-semibold text-[var(--ink)]">{lead.displayName}</p>
          <p className="text-sm text-[var(--mute)]">{lead.phone}</p>
          {lead.email && <p className="text-sm text-[var(--mute)]">{lead.email}</p>}
          <p className="text-xs text-[var(--mute)] pt-1">ID: …{lead.id.slice(-6).toUpperCase()}</p>
        </div>

        {/* What changes / what is preserved */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Will be anonymised</p>
            <ul className="text-sm text-red-800 space-y-1 list-disc list-inside">
              <li>Full name → <span className="font-mono">REDACTED-XXXXXX</span></li>
              <li>Phone → <span className="font-mono">REDACTED</span></li>
              <li>Email → <span className="font-mono">null</span></li>
              <li>PAN → <span className="font-mono">null</span></li>
              <li>Activity content → redacted text</li>
            </ul>
          </div>
          <div className="bg-green-50 border border-green-100 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Will be preserved</p>
            <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
              <li>Opportunity records (deal history)</li>
              <li>Commission records (financial audit trail)</li>
              <li>Activity timestamps and types</li>
              <li>RTBF event log (audit fact)</li>
            </ul>
          </div>
        </div>

        {/* Legal note */}
        <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            This action is <strong>irreversible</strong>. Required by DPDP Act 2023 right to
            erasure. The erasure event will be logged to <code className="text-xs bg-amber-100 px-1 rounded">/rtbf_log</code> for
            compliance auditing.
          </p>
        </div>

        {/* Reason */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
          <h2 className="text-base font-medium text-[var(--ink)]">Reason for erasure</h2>
          <div>
            <label className="block text-sm font-medium text-[var(--ink-soft)] mb-1">
              Reason <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)] focus:border-transparent"
            >
              {ERASURE_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ink-soft)] mb-1">
              Additional notes <span className="text-[var(--mute)] font-normal">(optional)</span>
            </label>
            <textarea
              value={reasonNotes}
              onChange={(e) => setReasonNotes(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="E.g. Ticket reference, customer communication details…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--gold)] focus:border-transparent"
            />
          </div>
        </div>

        {confirmError && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            {confirmError}
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => handleAnonymise(lead)}
            disabled={processing}
            className="flex-1 bg-red-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {processing ? 'Anonymising…' : 'I understand — Anonymise this customer'}
          </button>
          <button
            onClick={resetToSearch}
            disabled={processing}
            className="flex-1 sm:flex-none sm:px-6 border border-gray-200 text-[var(--ink-soft)] py-3 rounded-xl font-medium text-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ─── Done step ───────────────────────────────────────────────────────────────
  const { result } = pageState;
  return (
    <div className="max-w-2xl mx-auto py-10 px-4 space-y-6">
      <div className="bg-white rounded-2xl border border-green-200 shadow-sm p-8 text-center space-y-4">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
        <h1 className="text-2xl font-semibold text-[var(--navy)] font-[Fraunces]">
          Anonymisation complete
        </h1>
        <p className="text-sm text-[var(--mute)]">
          Customer data has been permanently anonymised. An event has been recorded in{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">/rtbf_log</code> for compliance
          auditing.
        </p>
        <div className="text-sm text-[var(--ink-soft)] bg-[var(--paper-warm)] rounded-xl px-6 py-4 text-left space-y-1">
          <p><span className="text-[var(--mute)]">Lead ID:</span> …{result.leadId.slice(-6).toUpperCase()}</p>
          <p>
            <span className="text-[var(--mute)]">Activities redacted:</span>{' '}
            {result.activitiesRedacted}
          </p>
          <p>
            <span className="text-[var(--mute)]">Anonymised at:</span>{' '}
            {result.anonymisedAt.toLocaleString('en-IN')}
          </p>
        </div>
        <button
          onClick={resetToSearch}
          className="mt-2 text-sm font-medium text-[var(--navy)] border border-[var(--navy)] px-5 py-2 rounded-lg hover:bg-[var(--navy)] hover:text-white transition-colors"
        >
          Process another request
        </button>
      </div>
    </div>
  );
}
