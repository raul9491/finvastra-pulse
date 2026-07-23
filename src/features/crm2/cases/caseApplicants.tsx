/**
 * The case's applicants tab - add / edit / remove the people on the file.
 * 
 * PAN is sent to the server for encryption and Aadhaar is last-4 ONLY (a full
 * 12-digit value is rejected at the API - UIDAI). Extracted verbatim from
 * CaseWorkspacePage.tsx (2026-07-23) - no behaviour change.
 */
import type { Applicant } from '../../../types/crm2';
import type { WithId } from './CaseWorkspacePage';
import { useState } from 'react';
import { apiCrm2 } from '../lib';
import { FLabel, inp } from '../formPrimitives';
import { useToast } from '../../../components/ui/Toast';
import { Plus, X } from 'lucide-react';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';

// ─── Applicants tab ───────────────────────────────────────────────────────────
export function ApplicantsTab({ caseId, applicants, canWrite }: {
  caseId: string; applicants: Array<WithId<Applicant>>; canWrite: boolean;
}) {
  const toast = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState({ name: '', type: 'CO_APPLICANT', relationshipToPrimary: 'OTHER', mobile: '', pan: '', aadhaarLast4: '' });
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (f.name.trim().length < 2) { setServerError('Name required'); return; }
    setBusy(true); setServerError('');
    try {
      const r = await apiCrm2<{ ok: boolean; newTrackerRows: number }>('POST', `/api/crm2/cases/${caseId}/applicants`, f);
      toast.success(`Applicant added — ${r.newTrackerRows} document row(s) expanded`);
      setShowAdd(false); setF({ name: '', type: 'CO_APPLICANT', relationshipToPrimary: 'OTHER', mobile: '', pan: '', aadhaarLast4: '' });
    } catch (e) { setServerError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };

  const remove = async (aid: string, name: string) => {
    if (!confirm(`Remove applicant "${name}"? Tracker rows with files are kept.`)) return;
    try {
      const r = await apiCrm2<{ ok: boolean; removedRows: number; keptRowsWithFiles: number }>(
        'DELETE', `/api/crm2/cases/${caseId}/applicants/${aid}`);
      toast.success(`Removed — ${r.removedRows} empty row(s) deleted, ${r.keptRowsWithFiles} kept (have files)`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <div className="space-y-3">
      {canWrite && (
        <button onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
          <Plus size={15} /> Add Applicant
        </button>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        {applicants.map((a) => (
          <div key={a.id} className="glass-panel p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{a.name}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {a.type.replace('_', ' ')} · {a.relationshipToPrimary}
                </p>
              </div>
              {canWrite && a.type !== 'PRIMARY' && (
                <button onClick={() => remove(a.id, a.name)} className="p-1 rounded hover:bg-(--shell-hover-hard)" aria-label="Remove">
                  <X size={14} style={{ color: '#f87171' }} />
                </button>
              )}
            </div>
            <div className="mt-2 text-[11px] space-y-0.5" style={{ color: 'var(--text-muted)' }}>
              <p>Mobile: {a.mobile || '—'}</p>
              <p>PAN: {a.panLast4 ? `••••••${a.panLast4}` : '—'} · Aadhaar: {a.aadhaarLast4 ? `••••••••${a.aadhaarLast4}` : '—'}</p>
            </div>
          </div>
        ))}
        {applicants.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No applicants yet.</p>
        )}
      </div>

      {showAdd && (
        <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="glass-modal-panel w-full max-w-md rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="glass-modal-header px-5 py-4">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Add Applicant</h3>
            </div>
            <div className="p-5 space-y-3">
              {serverError && <p className="text-sm" style={{ color: '#f87171' }}>{serverError}</p>}
              <div><FLabel text="Name" required /><input className={inp()} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FLabel text="Type" required />
                  <SearchableSelect value={f.type} onChange={(v) => setF({ ...f, type: v })}
                    options={['CO_APPLICANT', 'GUARANTOR'].map((t) => ({ value: t, label: t.replace('_', ' ') }))} />
                </div>
                <div>
                  <FLabel text="Relationship" />
                  <SearchableSelect value={f.relationshipToPrimary} onChange={(v) => setF({ ...f, relationshipToPrimary: v })}
                    options={['SPOUSE', 'FATHER', 'MOTHER', 'PARTNER', 'DIRECTOR', 'OTHER'].map((r) => ({ value: r, label: r }))} />
                </div>
                <div><FLabel text="Mobile" /><input className={inp()} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></div>
                <div><FLabel text="PAN" /><input className={inp()} value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" /></div>
                <div>
                  <FLabel text="Aadhaar — LAST 4 ONLY" />
                  <input className={inp()} value={f.aadhaarLast4} maxLength={4}
                    onChange={(e) => setF({ ...f, aadhaarLast4: e.target.value.replace(/\D/g, '') })} placeholder="1234" />
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowAdd(false)} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border"
                  style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
                <button onClick={add} disabled={busy}
                  className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
                  style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                  {busy ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
