/**
 * Accordion timeline of everything captured at each stage the opportunity has
 * passed through.
 * 
 * Extracted verbatim from OpportunityDetailPage.tsx (2026-07-23) - no
 * behaviour change.
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle2, Circle, ChevronDown, ChevronUp } from 'lucide-react';
import type {
  AnyStageData, ContactedData, DocumentsData, SubmittedData, SanctionedData, DisbursedData,
} from './stageForms';
// ─── Stage Data History Accordion ─────────────────────────────────────────────

export function StageDataHistory({ stages, stageData }: {
  stages: string[];
  stageData: Record<string, AnyStageData> | undefined;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!stageData) return null;

  // Only show stages that have captured data, in pipeline order
  const captured = stages.filter(s => stageData[s.toLowerCase().trim()]);
  if (captured.length === 0) return null;

  const toggle = (s: string) => setExpanded(prev => prev === s ? null : s);

  const renderBody = (stage: string) => {
    const key  = stage.toLowerCase().trim();
    const data = stageData[key] as Record<string, unknown>;
    if (!data) return null;

    if (key === 'contacted') {
      const d = data as unknown as ContactedData;
      const typeEmoji: Record<string, string> = { call: '📞', whatsapp: '💬', email: '✉️', meeting: '🤝' };
      return (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Method</p>
            <p style={{ color: 'var(--text-primary)' }}>{typeEmoji[d.contactType] ?? ''} {d.contactType}</p></div>
          {d.contactDate && <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Date</p>
            <p style={{ color: 'var(--text-primary)' }}>{format(new Date(d.contactDate), 'dd MMM yyyy')}</p></div>}
          {d.contactedByName && <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>By</p>
            <p style={{ color: 'var(--text-primary)' }}>{d.contactedByName}</p></div>}
          {d.notes && <div className="col-span-2"><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Notes</p>
            <p style={{ color: 'var(--text-muted)' }}>{d.notes}</p></div>}
        </div>
      );
    }

    if (key === 'documents collected') {
      const d = data as unknown as DocumentsData;
      const docs = d.documents ?? [];
      const collected = docs.filter(doc => doc.collected);
      const viaLabel: Record<string, string> = { whatsapp: '💬 WhatsApp', email: '✉️ Email', physical: '📄 Physical', portal: '🌐 Portal' };
      return (
        <div className="space-y-2">
          <p className="text-xs font-semibold" style={{ color: collected.length === docs.length ? '#34d399' : '#fb923c' }}>
            {collected.length} of {docs.length} documents collected
          </p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {docs.map((doc, i) => (
              <div key={i} className="flex items-center gap-2 text-xs py-1"
                style={{ borderBottom: '1px solid var(--shell-border)' }}>
                {doc.collected
                  ? <CheckCircle2 size={13} style={{ color: '#34d399' }} />
                  : <Circle size={13} style={{ color: 'var(--text-dim)' }} />}
                <span className="flex-1" style={{ color: doc.collected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {doc.name}
                </span>
                {doc.collected && doc.receivedVia && (
                  <span className="px-1.5 py-0.5 rounded text-[10px]"
                    style={{ backgroundColor: 'var(--glass-panel-bg)', color: 'var(--text-muted)' }}>
                    {viaLabel[doc.receivedVia] ?? doc.receivedVia}
                  </span>
                )}
              </div>
            ))}
          </div>
          {d.notes && <p className="text-xs pt-1" style={{ color: 'var(--text-muted)' }}>{d.notes}</p>}
        </div>
      );
    }

    if (key === 'submitted to bank') {
      const d = data as unknown as SubmittedData;
      return (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Bank / NBFC</p>
              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{d.bankName || '—'}</p></div>
            <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Application No</p>
              <p style={{ color: 'var(--text-primary)' }}>{d.applicationNo || '—'}</p></div>
            {d.submittedDate && <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Submitted On</p>
              <p style={{ color: 'var(--text-primary)' }}>{format(new Date(d.submittedDate), 'dd MMM yyyy')}</p></div>}
          </div>
          {(d.smName || d.smEmail || d.smPhone) && (
            <div className="rounded-lg px-3 py-2 text-xs space-y-0.5"
              style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}>
              <p className="font-bold uppercase tracking-widest mb-1" style={{ color: '#C9A961' }}>SM</p>
              {d.smName && <p style={{ color: 'var(--text-primary)' }}>{d.smName}</p>}
              {d.smEmail && <p style={{ color: 'var(--text-muted)' }}>{d.smEmail}</p>}
              {d.smPhone && <p style={{ color: 'var(--text-muted)' }}>{d.smPhone}</p>}
            </div>
          )}
          {(d.asmName || d.asmEmail || d.asmPhone) && (
            <div className="rounded-lg px-3 py-2 text-xs space-y-0.5"
              style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border)' }}>
              <p className="font-bold uppercase tracking-widest mb-1" style={{ color: '#C9A961' }}>ASM</p>
              {d.asmName && <p style={{ color: 'var(--text-primary)' }}>{d.asmName}</p>}
              {d.asmEmail && <p style={{ color: 'var(--text-muted)' }}>{d.asmEmail}</p>}
              {d.asmPhone && <p style={{ color: 'var(--text-muted)' }}>{d.asmPhone}</p>}
            </div>
          )}
          {d.notes && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.notes}</p>}
        </div>
      );
    }

    if (key === 'under review') {
      const prevSub = stageData['submitted to bank'] as unknown as SubmittedData | undefined;
      const reviewNotes = (data as unknown as { notes: string }).notes;
      return (
        <div className="space-y-3">
          {prevSub?.bankName && (
            <div className="rounded-xl px-4 py-3"
              style={{ backgroundColor: 'rgba(201,169,97,0.08)', borderLeft: '3px solid #C9A961' }}>
              <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: '#C9A961' }}>Submitted To</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{prevSub.bankName}</p>
              {prevSub.applicationNo && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>App# {prevSub.applicationNo}</p>}
              {prevSub.smPhone && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>SM: {prevSub.smName} {prevSub.smPhone}</p>}
            </div>
          )}
          {reviewNotes && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{reviewNotes}</p>}
        </div>
      );
    }

    if (key === 'sanctioned') {
      const d = data as unknown as SanctionedData;
      return (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Sanctioned Amount</p>
            <p className="font-semibold" style={{ color: '#34d399' }}>
              {d.sanctionedAmount ? `₹${Number(d.sanctionedAmount).toLocaleString('en-IN')}` : '—'}
            </p></div>
          <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Sanction Date</p>
            <p style={{ color: 'var(--text-primary)' }}>
              {d.sanctionDate ? format(new Date(d.sanctionDate), 'dd MMM yyyy') : '—'}
            </p></div>
          {d.sanctionLetterNo && <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Letter No</p>
            <p style={{ color: 'var(--text-primary)' }}>{d.sanctionLetterNo}</p></div>}
          {d.interestRate && <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Interest Rate</p>
            <p style={{ color: 'var(--text-primary)' }}>{d.interestRate}%</p></div>}
          {d.tenureMonths && <div><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Tenure</p>
            <p style={{ color: 'var(--text-primary)' }}>{d.tenureMonths} months</p></div>}
          {d.notes && <div className="col-span-2"><p className="text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>Notes</p>
            <p style={{ color: 'var(--text-muted)' }}>{d.notes}</p></div>}
        </div>
      );
    }

    if (key === 'disbursed') {
      const d = data as unknown as DisbursedData;
      const rows: { label: string; value: string | undefined }[] = [
        { label: 'Application No',    value: d.applicationNo },
        { label: 'Loan No',           value: d.loanNo },
        { label: 'Company',           value: d.customerCompanyName },
        { label: 'Disbursal Date',    value: d.disbursalDate ? format(new Date(d.disbursalDate), 'dd MMM yyyy') : undefined },
        { label: 'Disbursed Amount',  value: d.disbursedAmount ? `₹${Number(d.disbursedAmount).toLocaleString('en-IN')}` : undefined },
        { label: 'City / State',      value: d.cityState },
        { label: 'SM Email',          value: d.smEmail },
        { label: 'SM Phone',          value: d.smPhone },
        { label: 'ASM Email',         value: d.asmEmail },
        { label: 'ASM Phone',         value: d.asmPhone },
        { label: 'DSA Name',          value: d.dsaName },
        { label: 'DSA Code',          value: d.dsaCode },
      ].filter(r => r.value);
      return (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(201,169,97,0.20)' }}>
          {rows.map(({ label, value }, i) => (
            <div key={label}
              className="flex items-center gap-3 px-4 py-2.5 text-sm"
              style={{ backgroundColor: i % 2 === 0 ? 'rgba(201,169,97,0.04)' : 'transparent' }}>
              <span className="w-36 shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                {label}
              </span>
              <span style={{ color: 'var(--text-primary)' }}>{value}</span>
            </div>
          ))}
          {d.notes && (
            <div className="px-4 py-2.5" style={{ borderTop: '1px solid var(--shell-border)' }}>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.notes}</p>
            </div>
          )}
        </div>
      );
    }

    // Generic fallback
    const notes = (data as { notes?: string }).notes;
    return notes ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{notes}</p> : null;
  };

  return (
    <div className="glass-panel p-5">
      <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
        Stage History <span className="ml-1 font-normal normal-case tracking-normal">({captured.length} stage{captured.length !== 1 ? 's' : ''} captured)</span>
      </h3>
      <div className="space-y-1">
        {captured.map((stage) => {
          const isOpen = expanded === stage;
          return (
            <div key={stage} className="rounded-xl overflow-hidden"
              style={{ border: '1px solid var(--shell-border)' }}>
              <button
                onClick={() => toggle(stage)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-(--shell-hover-soft) transition-colors"
              >
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{stage}</span>
                {isOpen
                  ? <ChevronUp size={15} style={{ color: 'var(--text-muted)' }} />
                  : <ChevronDown size={15} style={{ color: 'var(--text-muted)' }} />}
              </button>
              {isOpen && (
                <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--shell-border)' }}>
                  <div className="pt-3">
                    {renderBody(stage)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
