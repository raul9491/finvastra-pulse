/**
 * The case document tracker and the vault picker that links an existing
 * client vault file to a tracker row (it REFERENCES, never copies).
 * 
 * Extracted verbatim from CaseWorkspacePage.tsx (2026-07-23) - no behaviour
 * change.
 */
import type { DocTrackerRow, VaultDoc, DocumentDef, Applicant } from '../../../types/crm2';
import type { WithId } from './CaseWorkspacePage';
import { fmtTs } from './CaseWorkspacePage';
import { useState } from 'react';
import { apiCrm2 } from '../lib';
import { useToast } from '../../../components/ui/Toast';
import { FileText, Upload, X, AlertTriangle } from 'lucide-react';

// ─── Documents tab — tracker grouped by stage + vault picker ─────────────────
export const TRACKER_STATUSES = ['PENDING', 'REQUESTED', 'RECEIVED', 'VERIFIED', 'REJECTED_REUPLOAD', 'EXPIRED'];
const STAGE_GROUPS: Array<{ key: string; label: string; gate: string | null }> = [
  { key: 'LOGIN', label: 'Login documents', gate: 'Blocks stage → LOGIN until all VERIFIED' },
  { key: 'SANCTION', label: 'Sanction documents', gate: null },
  { key: 'DISBURSEMENT', label: 'Disbursement documents', gate: 'Checked by the disburse endpoint (Phase 4)' },
  { key: 'PDD', label: 'PDD documents', gate: 'Blocks PDD status → CLEARED until all VERIFIED' },
];

export function DocumentsTab({ caseId, tracker, vaultDocs, clientId, defName, applicantName, docDefs, applicants, canWrite }: {
  caseId: string;
  tracker: Array<WithId<DocTrackerRow>>;
  vaultDocs: Array<WithId<VaultDoc>>;
  clientId: string;
  defName: (id: string) => string;
  applicantName: (id: string | null) => string;
  docDefs: Array<WithId<DocumentDef>>;
  applicants: Array<WithId<Applicant>>;
  canWrite: boolean;
}) {
  const toast = useToast();
  const [pickerFor, setPickerFor] = useState<WithId<DocTrackerRow> | null>(null);

  const patchRow = async (rowId: string, body: Record<string, unknown>, msg: string) => {
    try { await apiCrm2('PATCH', `/api/crm2/cases/${caseId}/doc-tracker/${rowId}`, body); toast.success(msg); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <div className="space-y-4">
      {STAGE_GROUPS.map((g) => {
        const rows = tracker.filter((r) => r.requiredByStage === g.key);
        if (rows.length === 0) return null;
        const verified = rows.filter((r) => r.status === 'VERIFIED').length;
        const gated = g.gate && verified < rows.length;
        return (
          <div key={g.key} className="glass-panel p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText size={14} style={{ color: '#C9A961' }} />
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{g.label}</h3>
              <span className="text-xs" style={{ color: verified === rows.length ? '#34d399' : 'var(--text-muted)' }}>
                {verified}/{rows.length} verified
              </span>
              {gated && (
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: '#fbbf24' }}>
                  <AlertTriangle size={11} /> {g.gate}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {rows.map((r) => {
                const linked = vaultDocs.find((v) => v.id === r.vaultDocId);
                return (
                  <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg" style={{ border: '1px solid var(--shell-border)' }}>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{defName(r.documentDefId)}</p>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {applicantName(r.applicantId)}
                        {linked ? <> · <a href={(linked as VaultDoc & { downloadUrl?: string }).downloadUrl} target="_blank" rel="noreferrer" className="underline" style={{ color: '#C9A961' }}>{linked.fileName}</a></> : ' · no file linked'}
                        {r.verifiedBy ? ` · verified by ${r.verifiedBy}` : ''}
                      </p>
                    </div>
                    {canWrite ? (
                      <>
                        <button onClick={() => setPickerFor(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border"
                          style={{ borderColor: 'rgba(201,169,97,0.35)', color: '#C9A961' }}>
                          <Upload size={11} /> {r.vaultDocId ? 'Change file' : 'Attach'}
                        </button>
                        <select className="glass-inp text-xs py-1.5" value={r.status}
                          onChange={(e) => patchRow(r.id, { status: e.target.value }, `→ ${e.target.value}`)}>
                          {TRACKER_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                        </select>
                      </>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: r.status === 'VERIFIED' ? 'rgba(52,211,153,0.15)' : 'var(--shell-hover-hard)',
                                 color: r.status === 'VERIFIED' ? '#34d399' : 'var(--text-muted)' }}>{r.status}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {tracker.length === 0 && (
        <div className="glass-panel p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No document requirements — link document types to this product in Masters → Documents.
        </div>
      )}

      {pickerFor && (
        <VaultPickerModal row={pickerFor} clientId={clientId} caseId={caseId}
          vaultDocs={vaultDocs} defName={defName} docDefs={docDefs} applicants={applicants}
          onClose={() => setPickerFor(null)}
          onLinked={(vid) => { patchRow(pickerFor.id, { vaultDocId: vid, status: 'RECEIVED' }, 'File linked'); setPickerFor(null); }} />
      )}
    </div>
  );
}

/** Pick an existing vault doc (upload once, reference everywhere) or upload new. */
export function VaultPickerModal({ row, clientId, vaultDocs, defName, onClose, onLinked }: {
  row: WithId<DocTrackerRow>; clientId: string; caseId: string;
  vaultDocs: Array<WithId<VaultDoc>>; defName: (id: string) => string;
  docDefs: Array<WithId<DocumentDef>>; applicants: Array<WithId<Applicant>>;
  onClose: () => void; onLinked: (vaultDocId: string) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const candidates = vaultDocs.filter((v) => v.documentDefId === row.documentDefId && v.status === 'VALID');

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const res = await apiCrm2<{ ok: boolean; vaultDocId: string }>('POST', `/api/crm2/clients/${clientId}/vault`, {
        documentDefId: row.documentDefId, applicantId: row.applicantId,
        fileName: file.name, contentBase64: b64, contentType: file.type || 'application/octet-stream',
      });
      toast.success('Uploaded to vault');
      onLinked(res.vaultDocId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-md rounded-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{defName(row.documentDefId)}</h3>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Pick from the client vault or upload — files are stored once and referenced.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close">
            <X size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {candidates.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>In the vault</p>
              {candidates.map((v) => (
                <button key={v.id} onClick={() => onLinked(v.id)}
                  className="w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-2 hover:bg-(--shell-hover-soft) transition-colors"
                  style={{ border: '1px solid var(--shell-border)' }}>
                  <FileText size={14} style={{ color: '#C9A961' }} />
                  <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{v.fileName}</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{fmtTs(v.uploadedAt)}</span>
                </button>
              ))}
            </div>
          )}
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Upload new (max 10 MB)</span>
            <input type="file" disabled={busy} className="mt-1.5 block w-full text-xs" style={{ color: 'var(--text-muted)' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
          </label>
          {busy && <p className="text-xs" style={{ color: '#C9A961' }}>Uploading…</p>}
        </div>
      </div>
    </div>
  );
}
