import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { collection, where, query, getDocs } from 'firebase/firestore';
import { AlertTriangle, Search, ShieldOff, CheckCircle, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { db } from '../../../lib/firebase';
import { leadName, leadMobile, type LeadDocLike } from '../../../lib/crm2/leadModel';
import { anonymiseLead, type RTBFResult } from '../../../lib/leadAnonymisation';
import type { Lead } from '../../../types';

// `& LeadDocLike` so the shared lead normalizer accepts these rows: /leads holds
// BOTH document shapes and the Lead type only describes the old-CRM one.
type LeadWithId = Lead & LeadDocLike & { id: string };

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

      // `/leads` holds TWO shapes: old-CRM Customers (phone/displayName) and CRM 2.0
      // leads (mobile/name). Searching only the old field names made every CRM 2.0
      // lead UNFINDABLE here — so an erasure request for someone who exists only as
      // a CRM 2.0 lead silently returned nothing. Every new lead is CRM 2.0, so both
      // shapes must be searched. (Fixed 2026-07-23.)
      const dedupe = (docs: LeadWithId[]) => {
        const seen = new Set<string>();
        return docs.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
      };

      if (isPhone) {
        const [oldSnap, crm2Snap] = await Promise.all([
          getDocs(query(collection(db, 'leads'), where('phone', '==', trimmed))),
          getDocs(query(collection(db, 'leads'), where('mobile', '==', trimmed))),
        ]);
        const rows = dedupe([...oldSnap.docs, ...crm2Snap.docs].map((d) => ({ id: d.id, ...d.data() } as LeadWithId)));
        setSearchResults(rows);
        if (rows.length === 0) setSearchError('No records found for that number.');
      } else {
        // Name search: case-sensitive prefix match — across both name fields.
        const [oldSnap, crm2Snap] = await Promise.all([
          getDocs(query(collection(db, 'leads'), where('displayName', '>=', trimmed), where('displayName', '<=', trimmed + ''))),
          getDocs(query(collection(db, 'leads'), where('name', '>=', trimmed), where('name', '<=', trimmed + ''))),
        ]);
        const rows = dedupe([...oldSnap.docs, ...crm2Snap.docs].map((d) => ({ id: d.id, ...d.data() } as LeadWithId)));
        setSearchResults(rows);
        if (rows.length === 0) {
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
            <ShieldOff className="w-5 h-5" style={{ color: '#C9A961' }} />
            <h1
              className="text-2xl font-semibold"
              style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}
            >
              Right to Be Forgotten
            </h1>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Permanently anonymise a customer's personal data under the DPDP Act 2023 right to erasure.
            This action is irreversible.
          </p>
        </div>

        {/* Warning banner */}
        <div
          className="flex gap-3 rounded-xl p-4"
          style={{ backgroundColor: 'rgba(201,169,97,0.08)', border: '1px solid rgba(201,169,97,0.25)' }}
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#C9A961' }} />
          <p className="text-sm" style={{ color: '#C9A961' }}>
            Anonymisation permanently replaces the customer's name, phone (including any alternate
            numbers), email and PAN with redacted placeholders, and redacts their call notes,
            imported details and WhatsApp messages. Opportunity records, commission records and
            activity timestamps are preserved for regulatory audit purposes. This cannot be undone.
          </p>
        </div>

        {/* Search box */}
        <div className="glass-panel p-6 space-y-4">
          <h2 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>Find customer</h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
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
              className="glass-inp flex-1 text-sm"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !searchInput.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
            >
              <Search className="w-4 h-4" />
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>

          {searchError && (
            <p
              className="text-sm rounded-lg px-3 py-2"
              style={{ backgroundColor: 'rgba(201,169,97,0.08)', border: '1px solid rgba(201,169,97,0.20)', color: '#C9A961' }}
            >
              {searchError}
            </p>
          )}

          {/* Results */}
          {hasSearched && !searching && (
            <div className="space-y-2 pt-2">
              {searchResults.length === 0 && !searchError && (
                <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>
                  No customers found matching that query.
                </p>
              )}
              {searchResults.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center justify-between p-4 rounded-xl hover:bg-(--shell-hover-soft) transition-colors"
                  style={{ border: '1px solid var(--shell-border-mid)' }}
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{leadName(lead)}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{leadMobile(lead) ?? '—'}</p>
                    {lead.email && (
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{lead.email}</p>
                    )}
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Source: {lead.source} &middot; ID: …{lead.id.slice(-6).toUpperCase()}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setPageState({ step: 'confirm', lead });
                      setConfirmError('');
                    }}
                    className="text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
                    style={{ color: '#f87171', border: '1px solid rgba(248,113,113,0.30)' }}
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
            className="hover:opacity-70 transition-opacity"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Back to search"
          >
            <X className="w-5 h-5" />
          </button>
          <h1
            className="text-2xl font-semibold"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}
          >
            Confirm Anonymisation
          </h1>
        </div>

        {/* Lead summary */}
        <div className="glass-panel p-5 space-y-1">
          <p className="text-xs uppercase tracking-wide font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Customer</p>
          <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{leadName(lead)}</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{leadMobile(lead) ?? '—'}</p>
          {lead.email && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{lead.email}</p>}
          <p className="text-xs pt-1" style={{ color: 'var(--text-muted)' }}>ID: …{lead.id.slice(-6).toUpperCase()}</p>
        </div>

        {/* What changes / what is preserved */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div
            className="rounded-xl p-4 space-y-2"
            style={{ backgroundColor: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)' }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#f87171' }}>Will be anonymised</p>
            <ul className="text-sm space-y-1 list-disc list-inside" style={{ color: '#f87171' }}>
              <li>Full name → <span className="font-mono">REDACTED-XXXXXX</span></li>
              <li>Phone → <span className="font-mono">REDACTED</span></li>
              <li>Email → <span className="font-mono">null</span></li>
              <li>PAN → <span className="font-mono">null</span></li>
              <li>Activity content → redacted text</li>
            </ul>
          </div>
          <div
            className="rounded-xl p-4 space-y-2"
            style={{ backgroundColor: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.20)' }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#34d399' }}>Will be preserved</p>
            <ul className="text-sm space-y-1 list-disc list-inside" style={{ color: '#34d399' }}>
              <li>Opportunity records (deal history)</li>
              <li>Commission records (financial audit trail)</li>
              <li>Activity timestamps and types</li>
              <li>RTBF event log (audit fact)</li>
            </ul>
          </div>
        </div>

        {/* Legal note */}
        <div
          className="flex gap-3 rounded-xl p-4"
          style={{ backgroundColor: 'rgba(201,169,97,0.08)', border: '1px solid rgba(201,169,97,0.25)' }}
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#C9A961' }} />
          <p className="text-sm" style={{ color: '#C9A961' }}>
            This action is <strong>irreversible</strong>. Required by DPDP Act 2023 right to
            erasure. The erasure event will be logged to <code className="text-xs px-1 rounded" style={{ backgroundColor: 'rgba(201,169,97,0.15)' }}>/rtbf_log</code> for
            compliance auditing.
          </p>
        </div>

        {/* Reason */}
        <div className="glass-panel p-5 space-y-4">
          <h2 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>Reason for erasure</h2>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              Reason <span style={{ color: '#f87171' }}>*</span>
            </label>
            <select
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              className="glass-inp w-full text-sm"
            >
              {ERASURE_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              Additional notes <span className="font-normal" style={{ color: 'var(--text-muted)' }}>(optional)</span>
            </label>
            <textarea
              value={reasonNotes}
              onChange={(e) => setReasonNotes(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="E.g. Ticket reference, customer communication details…"
              className="glass-inp w-full text-sm resize-none"
            />
          </div>
        </div>

        {confirmError && (
          <p
            className="text-sm rounded-xl px-4 py-3"
            style={{ backgroundColor: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171' }}
          >
            {confirmError}
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => handleAnonymise(lead)}
            disabled={processing}
            className="flex-1 py-3 rounded-xl font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            style={{ backgroundColor: '#f87171', color: '#fff' }}
          >
            {processing ? 'Anonymising…' : 'I understand — Anonymise this customer'}
          </button>
          <button
            onClick={resetToSearch}
            disabled={processing}
            className="flex-1 sm:flex-none sm:px-6 py-3 rounded-xl font-medium text-sm disabled:opacity-50 transition-colors hover:bg-(--shell-hover-soft)"
            style={{ border: '1px solid var(--shell-border-mid)', color: 'var(--text-primary)' }}
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
      <div
        className="glass-panel p-8 text-center space-y-4"
        style={{ border: '1px solid rgba(52,211,153,0.25)' }}
      >
        <CheckCircle className="w-12 h-12 mx-auto" style={{ color: '#34d399' }} />
        <h1
          className="text-2xl font-semibold"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}
        >
          Anonymisation complete
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Customer data has been permanently anonymised. An event has been recorded in{' '}
          <code className="text-xs px-1 rounded" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>/rtbf_log</code> for compliance
          auditing.
        </p>
        <div
          className="text-sm rounded-xl px-6 py-4 text-left space-y-1"
          style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}
        >
          <p><span style={{ color: 'var(--text-muted)' }}>Lead ID:</span> <span style={{ color: 'var(--text-primary)' }}>…{result.leadId.slice(-6).toUpperCase()}</span></p>
          <p>
            <span style={{ color: 'var(--text-muted)' }}>Activities redacted:</span>{' '}
            <span style={{ color: 'var(--text-primary)' }}>{result.activitiesRedacted}</span>
          </p>
          <p>
            <span style={{ color: 'var(--text-muted)' }}>Anonymised at:</span>{' '}
            <span style={{ color: 'var(--text-primary)' }}>{result.anonymisedAt.toLocaleString('en-IN')}</span>
          </p>
        </div>
        <button
          onClick={resetToSearch}
          className="mt-2 text-sm font-medium px-5 py-2 rounded-lg transition-colors hover:bg-(--shell-hover-soft)"
          style={{ color: '#C9A961', border: '1px solid rgba(201,169,97,0.30)' }}
        >
          Process another request
        </button>
      </div>
    </div>
  );
}
