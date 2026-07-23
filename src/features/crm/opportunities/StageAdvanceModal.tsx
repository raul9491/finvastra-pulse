/**
 * The 'advance to next stage' modal - picks the right capture form for the
 * target stage, validates it, and hands the payload back to the page.
 * 
 * Extracted verbatim from OpportunityDetailPage.tsx (2026-07-23) - no
 * behaviour change.
 */
import { useState } from 'react';
import type { OpportunityType } from '../../../types';
import {
  ContactedForm, DocumentsCollectedForm, SubmittedToBankForm, UnderReviewForm,
  SanctionedForm, DisbursedForm, GInp, LOAN_DOCS, PRODUCT_EXTRA_DOCS, TYPE_COLORS,
  type AnyStageData, type ContactedData, type DocumentsData, type SubmittedData,
  type SanctionedData, type DisbursedData,
} from './stageForms';
// ─── Stage Advance Modal ──────────────────────────────────────────────────────

export function StageAdvanceModal({ targetStage, opportunityType, product, existingStageData, onConfirm, onCancel, saving }: {
  targetStage: string;
  opportunityType: OpportunityType;
  product: string;
  existingStageData: Record<string, AnyStageData>;
  onConfirm: (data: AnyStageData) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}) {
  const col   = TYPE_COLORS[opportunityType];
  const key   = targetStage.toLowerCase().trim();
  const prevSubKey = 'submitted to bank';
  const prevSub = existingStageData[prevSubKey] as SubmittedData | undefined;

  // ── per-stage initial form state ────────────────────────────────────────────
  const [contactedData, setContactedData] = useState<ContactedData>({
    contactType: 'call', contactDate: '', contactedByName: '', notes: '',
  });
  const [docsData, setDocsData] = useState<DocumentsData>({ documents: [], notes: '' });
  const [submittedData, setSubmittedData] = useState<SubmittedData>({
    bankName: '', applicationNo: '', submittedDate: '',
    smName: '', smEmail: '', smPhone: '',
    asmName: '', asmEmail: '', asmPhone: '', notes: '',
  });
  const [reviewNotes, setReviewNotes] = useState('');
  const [sanctionedData, setSanctionedData] = useState<SanctionedData>({
    sanctionedAmount: '', sanctionDate: '', sanctionLetterNo: '',
    interestRate: '', tenureMonths: '', notes: '',
  });
  const [disbursedData, setDisbursedData] = useState<DisbursedData>({
    applicationNo: prevSub?.applicationNo ?? '',
    loanNo: '', customerCompanyName: '', disbursalDate: '', disbursedAmount: '',
    cityState: '',
    smEmail: prevSub?.smEmail ?? '', smPhone: prevSub?.smPhone ?? '',
    asmEmail: prevSub?.asmEmail ?? '', asmPhone: prevSub?.asmPhone ?? '',
    dsaName: '', dsaCode: '', notes: '',
  });
  const [genericNotes, setGenericNotes] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleConfirm = async () => {
    const errs: Record<string, string> = {};
    let payload: AnyStageData;

    if (key === 'contacted') {
      if (!contactedData.contactDate) errs.contactDate = 'Required';
      payload = contactedData;
    } else if (key === 'documents collected') {
      payload = { ...docsData, documents: docsData.documents.length === 0
        ? [...LOAN_DOCS, ...(PRODUCT_EXTRA_DOCS[product] ?? [])].map(name => ({ name, collected: false, receivedVia: '' as const }))
        : docsData.documents };
    } else if (key === 'submitted to bank') {
      if (!submittedData.bankName.trim()) errs.bankName = 'Required';
      if (!submittedData.applicationNo.trim()) errs.applicationNo = 'Required';
      payload = submittedData;
    } else if (key === 'under review') {
      payload = { notes: reviewNotes };
    } else if (key === 'sanctioned') {
      if (!sanctionedData.sanctionedAmount) errs.sanctionedAmount = 'Required';
      if (!sanctionedData.sanctionDate) errs.sanctionDate = 'Required';
      payload = sanctionedData;
    } else if (key === 'disbursed') {
      if (!disbursedData.applicationNo.trim()) errs.applicationNo = 'Required';
      if (!disbursedData.loanNo.trim()) errs.loanNo = 'Required';
      if (!disbursedData.disbursalDate) errs.disbursalDate = 'Required';
      payload = disbursedData;
    } else {
      payload = { notes: genericNotes };
    }

    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }
    setFieldErrors({});
    await onConfirm(payload);
  };

  const title: Record<string, string> = {
    'contacted':         '📞 Contacted',
    'documents collected': '📋 Documents Collected',
    'submitted to bank': '🏦 Submitted to Bank',
    'under review':      '🔍 Under Review',
    'sanctioned':        '✅ Sanctioned',
    'disbursed':         '💰 Disbursed',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center glass-modal-overlay">
      <div className="glass-modal-panel p-6 w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base"
              style={{ backgroundColor: col.bg }}>
              {title[key]?.split(' ')[0] ?? '📌'}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-muted)' }}>
                Moving to stage
              </p>
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {targetStage}
              </h3>
            </div>
          </div>
        </div>

        {/* Form body */}
        <div className="mb-6">
          {key === 'contacted' && (
            <ContactedForm value={contactedData} onChange={setContactedData} errors={fieldErrors} />
          )}
          {key === 'documents collected' && (
            <DocumentsCollectedForm value={docsData} onChange={setDocsData} product={product} />
          )}
          {key === 'submitted to bank' && (
            <SubmittedToBankForm value={submittedData} onChange={setSubmittedData} errors={fieldErrors} />
          )}
          {key === 'under review' && (
            <UnderReviewForm submittedData={prevSub ?? null} notes={reviewNotes} onChange={setReviewNotes} />
          )}
          {key === 'sanctioned' && (
            <SanctionedForm value={sanctionedData} onChange={setSanctionedData} errors={fieldErrors} />
          )}
          {key === 'disbursed' && (
            <DisbursedForm value={disbursedData} onChange={setDisbursedData} errors={fieldErrors} />
          )}
          {!['contacted','documents collected','submitted to bank','under review','sanctioned','disbursed'].includes(key) && (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Add any notes about this stage transition (optional).
              </p>
              <textarea rows={4} value={genericNotes} onChange={e => setGenericNotes(e.target.value)}
                placeholder="Notes about moving to this stage…"
                className={`${GInp()} resize-none`} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 pt-4" style={{ borderTop: '1px solid var(--shell-border)' }}>
          <button onClick={onCancel} type="button"
            className="flex-1 px-4 py-2.5 text-sm border rounded-xl hover:bg-(--shell-hover-soft) transition-colors"
            style={{ color: 'var(--text-muted)', borderColor: 'var(--shell-border-mid)' }}>
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={saving} type="button"
            className="flex-2 px-6 py-2.5 text-sm font-semibold rounded-xl transition-opacity disabled:opacity-40"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {saving ? 'Saving…' : `Save & Move to ${targetStage}`}
          </button>
        </div>
      </div>
    </div>
  );
}
