import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { logCallOutcome } from '../hooks/useMyLeads';
import type { Lead } from '../../../types';

interface Props {
  lead: Lead;
  oppId: string | null;
}

const CALL_OUTCOMES = [
  'Called - Interested',
  'Called - Not interested',
  'Called - No answer',
  'Called - Callback requested',
  'Called - Wrong number',
  'Left voicemail',
] as const;

export function QuickContactBar({ lead, oppId }: Props) {
  const { user } = useAuth();

  const [logOpen, setLogOpen] = useState(false);
  const [outcome, setOutcome] = useState<string>(CALL_OUTCOMES[0]);
  const [notes,   setNotes]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  const waLink = `https://wa.me/91${lead.phone}?text=${encodeURIComponent(
    'Hello ' + lead.displayName.split(' ')[0] + ', ',
  )}`;

  const handleLogSubmit = async () => {
    if (!user) return;

    if (!oppId) {
      // Guard — button is disabled, but defensive check
      alert('No open opportunity on this lead. Cannot log call.');
      return;
    }

    setSaving(true);
    try {
      await logCallOutcome(lead.id, oppId, outcome, notes, user.uid);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        setLogOpen(false);
        setNotes('');
        setOutcome(CALL_OUTCOMES[0]);
      }, 1200);
    } catch {
      alert('Failed to save call log. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="sticky top-0 z-10 rounded-xl border border-slate-200 overflow-hidden"
      style={{ backgroundColor: '#FFFFFF' }}
    >
      {/* ─── Action bar ─────────────────────────────────────────────────── */}
      <div className="px-6 py-3 flex items-center gap-3 flex-wrap border-b border-slate-100">
        <span
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: '#8B8B85' }}
        >
          Quick Actions
        </span>

        {/* Log Call */}
        <button
          onClick={() => oppId && setLogOpen((v) => !v)}
          disabled={!oppId}
          title={oppId ? 'Log a call outcome' : 'No open opportunity on this lead'}
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-medium transition-colors hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: '#0B1538' }}
        >
          📞 Log Call
        </button>

        {/* WhatsApp */}
        <a
          href={waLink}
          target="_blank"
          rel="noreferrer"
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-medium transition-colors hover:bg-slate-50 no-underline"
          style={{ color: '#0B1538' }}
        >
          💬 WhatsApp
        </a>

        {/* Email — only when email is present */}
        {lead.email && (
          <a
            href={`mailto:${lead.email}`}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-medium transition-colors hover:bg-slate-50 no-underline"
            style={{ color: '#0B1538' }}
          >
            ✉ Email
          </a>
        )}
      </div>

      {/* ─── Inline log form ────────────────────────────────────────────── */}
      {logOpen && (
        <div className="px-6 py-4 space-y-3" style={{ backgroundColor: '#FAFAF7' }}>
          {saved ? (
            <p className="text-sm font-semibold py-1" style={{ color: '#166534' }}>
              Saved ✓
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <p
                    className="text-[10px] font-bold uppercase tracking-widest mb-1"
                    style={{ color: '#8B8B85' }}
                  >
                    Outcome
                  </p>
                  <select
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                    className="text-sm px-3 py-1.5 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-100 transition-colors"
                    style={{ color: '#0A0A0A' }}
                  >
                    {CALL_OUTCOMES.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>

                <div className="flex-1 min-w-48">
                  <p
                    className="text-[10px] font-bold uppercase tracking-widest mb-1"
                    style={{ color: '#8B8B85' }}
                  >
                    Notes (optional)
                  </p>
                  <input
                    type="text"
                    placeholder="Notes (optional)…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full text-sm px-3 py-1.5 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-100 transition-colors"
                    style={{ color: '#0A0A0A' }}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleLogSubmit}
                    disabled={saving}
                    className="text-sm px-4 py-1.5 font-semibold rounded-lg transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setLogOpen(false);
                      setNotes('');
                      setOutcome(CALL_OUTCOMES[0]);
                    }}
                    className="text-sm px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                    style={{ color: '#2A2A2A' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>

              {outcome === 'Called - Not interested' && (
                <p
                  className="text-xs px-3 py-2 rounded-lg"
                  style={{ backgroundColor: '#FFF7ED', color: '#9A3412', border: '1px solid #FED7AA' }}
                >
                  Consider marking this opportunity as lost.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
