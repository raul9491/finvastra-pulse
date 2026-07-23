/**
 * Stage 1 (Opened) underwriting capture - the read panel plus the edit modal
 * and its small layout helpers.
 * 
 * Extracted verbatim from CaseWorkspacePage.tsx (2026-07-23) - no behaviour
 * change.
 */
import type { Crm2Case } from '../../../types/crm2';
import { useState } from 'react';
import { FLabel, inp } from '../formPrimitives';
import { X } from 'lucide-react';
import { inr } from '../../../lib/money';

// ─── Stage-1 (Opened) underwriting panel ──────────────────────────────────────
export function Stage1Panel({ caseDoc, canWrite, patchCase }: {
  caseDoc: Crm2Case & { id: string }; canWrite: boolean;
  patchCase: (body: Record<string, unknown>, msg: string) => Promise<void>;
}) {
  const [edit, setEdit] = useState(false);
  const s1 = caseDoc.stage1 ?? null;
  const hasData = !!s1 && (
    !!s1.property || (s1.turnover?.length ?? 0) > 0 || !!s1.gstTurnover ||
    (s1.existingLoans?.length ?? 0) > 0 || !!s1.income || (s1.references?.length ?? 0) > 0 || !!s1.notes
  );
  return (
    <div className="glass-panel p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Stage 1 — Underwriting (Opened)
        </p>
        {canWrite && (
          <button onClick={() => setEdit(true)} className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' }}>
            {hasData ? 'Edit Stage-1 data' : '+ Add Stage-1 data'}
          </button>
        )}
      </div>
      {!hasData ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          No underwriting data captured yet — property, turnover, income, existing loans & references.
        </p>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          {s1?.property && (
            <S1Block title="Property">
              <S1Line k="Description" v={s1.property.description} />
              <S1Line k="Address" v={s1.property.address} />
              <S1Line k="Market value" v={s1.property.marketValue != null ? inr(s1.property.marketValue) : null} />
            </S1Block>
          )}
          {(s1?.turnover?.length ?? 0) > 0 && (
            <S1Block title="Turnover (3 yrs)">
              {s1!.turnover.map((t, i) => <S1Line key={i} k={t.fy || `Year ${i + 1}`} v={inr(t.amount)} />)}
            </S1Block>
          )}
          {s1?.gstTurnover && (
            <S1Block title="GST turnover">
              <S1Line k={s1.gstTurnover.period || 'Period'} v={s1.gstTurnover.amount != null ? inr(s1.gstTurnover.amount) : null} />
            </S1Block>
          )}
          {s1?.income && (
            <S1Block title="Income">
              <S1Line k="Company" v={s1.income.company != null ? inr(s1.income.company) : null} />
              <S1Line k="Individual" v={s1.income.individual != null ? inr(s1.income.individual) : null} />
              <S1Line k="Rental" v={s1.income.rental != null ? inr(s1.income.rental) : null} />
            </S1Block>
          )}
          {(s1?.existingLoans?.length ?? 0) > 0 && (
            <S1Block title="Existing loans">
              {s1!.existingLoans.map((l, i) => (
                <S1Line key={i} k={`${l.lender || '—'}${l.loanType ? ` · ${l.loanType}` : ''}`} v={`${inr(l.outstanding)} · EMI ${inr(l.emi)}`} />
              ))}
            </S1Block>
          )}
          {(s1?.references?.length ?? 0) > 0 && (
            <S1Block title="References">
              {s1!.references.map((r, i) => <S1Line key={i} k={r.name || `Ref ${i + 1}`} v={`${r.mobile || ''}${r.relation ? ` · ${r.relation}` : ''}`} />)}
            </S1Block>
          )}
          {s1?.notes && (
            <S1Block title="Notes (partner / director details)">
              <p style={{ color: 'var(--text-primary)' }}>{s1.notes}</p>
            </S1Block>
          )}
        </div>
      )}
      {edit && <Stage1Modal caseDoc={caseDoc} patchCase={patchCase} onClose={() => setEdit(false)} />}
    </div>
  );
}
export function S1Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-3" style={{ border: '1px solid var(--shell-border)' }}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: '#C9A961' }}>{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
export function S1Line({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span style={{ color: 'var(--text-muted)' }}>{k}</span>
      <span className="text-right" style={{ color: 'var(--text-primary)' }}>{v || '—'}</span>
    </div>
  );
}

// ─── Stage-1 edit modal — property, turnover, GST, loans, income, references ───
export function Stage1Modal({ caseDoc, patchCase, onClose }: {
  caseDoc: Crm2Case & { id: string };
  patchCase: (body: Record<string, unknown>, msg: string) => Promise<void>;
  onClose: () => void;
}) {
  const s0 = caseDoc.stage1 ?? null;
  const [prop, setProp] = useState({
    description: s0?.property?.description ?? '', address: s0?.property?.address ?? '',
    marketValue: s0?.property?.marketValue?.toString() ?? '',
  });
  const [turnover, setTurnover] = useState<Array<{ fy: string; amount: string }>>(
    s0?.turnover?.length ? s0.turnover.map((t) => ({ fy: t.fy, amount: String(t.amount) })) : [{ fy: '', amount: '' }, { fy: '', amount: '' }, { fy: '', amount: '' }]);
  const [gst, setGst] = useState({ period: s0?.gstTurnover?.period ?? '', amount: s0?.gstTurnover?.amount?.toString() ?? '' });
  const [income, setIncome] = useState({
    company: s0?.income?.company?.toString() ?? '', individual: s0?.income?.individual?.toString() ?? '', rental: s0?.income?.rental?.toString() ?? '',
  });
  const [loans, setLoans] = useState<Array<{ lender: string; loanType: string; outstanding: string; emi: string }>>(
    s0?.existingLoans?.length ? s0.existingLoans.map((l) => ({ lender: l.lender, loanType: l.loanType, outstanding: String(l.outstanding), emi: String(l.emi) })) : [{ lender: '', loanType: '', outstanding: '', emi: '' }]);
  const [refs, setRefs] = useState<Array<{ name: string; mobile: string; relation: string }>>(
    s0?.references?.length ? s0.references.map((r) => ({ ...r })) : [{ name: '', mobile: '', relation: '' }, { name: '', mobile: '', relation: '' }]);
  const [notes, setNotes] = useState(s0?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const n = (s: string) => (s.trim() ? Number(s) : null);

  const save = async () => {
    setBusy(true);
    try {
      await patchCase({
        stage1: {
          property: (prop.description || prop.address || prop.marketValue)
            ? { description: prop.description || null, address: prop.address || null, marketValue: n(prop.marketValue) } : null,
          turnover: turnover.map((t) => ({ fy: t.fy.trim(), amount: n(t.amount) ?? 0 })).filter((t) => t.fy || t.amount),
          gstTurnover: (gst.period || gst.amount) ? { period: gst.period || null, amount: n(gst.amount) } : null,
          existingLoans: loans.map((l) => ({ lender: l.lender.trim(), loanType: l.loanType.trim(), outstanding: n(l.outstanding) ?? 0, emi: n(l.emi) ?? 0 })).filter((l) => l.lender || l.outstanding || l.emi),
          income: (income.company || income.individual || income.rental) ? { company: n(income.company), individual: n(income.individual), rental: n(income.rental) } : null,
          references: refs.map((r) => ({ name: r.name.trim(), mobile: r.mobile.trim(), relation: r.relation.trim() })).filter((r) => r.name || r.mobile),
          notes: notes.trim() || null,
        },
      }, 'Stage-1 data saved');
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-2xl rounded-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-center justify-between px-5 py-4 sticky top-0 z-10">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Stage 1 — Underwriting · {caseDoc.id}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)"><X size={17} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <div className="p-5 space-y-5">
          <S1Section title="Property">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><FLabel text="Description" /><input className={inp()} value={prop.description} onChange={(e) => setProp({ ...prop, description: e.target.value })} /></div>
              <div className="col-span-2"><FLabel text="Address" /><input className={inp()} value={prop.address} onChange={(e) => setProp({ ...prop, address: e.target.value })} /></div>
              <div><FLabel text="Market Value ₹" /><input type="number" className={inp()} value={prop.marketValue} onChange={(e) => setProp({ ...prop, marketValue: e.target.value })} /></div>
            </div>
          </S1Section>

          <S1Section title="Turnover — last 3 financial years">
            {turnover.map((t, i) => (
              <div key={i} className="grid grid-cols-[120px_1fr] gap-2 mb-2">
                <input className={inp()} placeholder="FY (e.g. 2024-25)" value={t.fy} onChange={(e) => setTurnover((p) => p.map((x, j) => j === i ? { ...x, fy: e.target.value } : x))} />
                <input type="number" className={inp()} placeholder="Amount ₹" value={t.amount} onChange={(e) => setTurnover((p) => p.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div><FLabel text="GST turnover period" /><input className={inp()} value={gst.period} onChange={(e) => setGst({ ...gst, period: e.target.value })} placeholder="e.g. Apr–Dec 2025" /></div>
              <div><FLabel text="GST turnover ₹" /><input type="number" className={inp()} value={gst.amount} onChange={(e) => setGst({ ...gst, amount: e.target.value })} /></div>
            </div>
          </S1Section>

          <S1Section title="Income">
            <div className="grid grid-cols-3 gap-3">
              <div><FLabel text="Company ₹" /><input type="number" className={inp()} value={income.company} onChange={(e) => setIncome({ ...income, company: e.target.value })} /></div>
              <div><FLabel text="Individual ₹" /><input type="number" className={inp()} value={income.individual} onChange={(e) => setIncome({ ...income, individual: e.target.value })} /></div>
              <div><FLabel text="Rental ₹" /><input type="number" className={inp()} value={income.rental} onChange={(e) => setIncome({ ...income, rental: e.target.value })} /></div>
            </div>
          </S1Section>

          <S1Section title="Existing loans" onAdd={() => setLoans((p) => [...p, { lender: '', loanType: '', outstanding: '', emi: '' }])}>
            {loans.map((l, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_1fr_24px] gap-2 mb-2 items-center">
                <input className={inp()} placeholder="Lender" value={l.lender} onChange={(e) => setLoans((p) => p.map((x, j) => j === i ? { ...x, lender: e.target.value } : x))} />
                <input className={inp()} placeholder="Type" value={l.loanType} onChange={(e) => setLoans((p) => p.map((x, j) => j === i ? { ...x, loanType: e.target.value } : x))} />
                <input type="number" className={inp()} placeholder="Outstanding ₹" value={l.outstanding} onChange={(e) => setLoans((p) => p.map((x, j) => j === i ? { ...x, outstanding: e.target.value } : x))} />
                <input type="number" className={inp()} placeholder="EMI ₹" value={l.emi} onChange={(e) => setLoans((p) => p.map((x, j) => j === i ? { ...x, emi: e.target.value } : x))} />
                <button onClick={() => setLoans((p) => p.filter((_, j) => j !== i))} className="p-1 rounded hover:bg-(--shell-hover-hard)"><X size={13} style={{ color: '#f87171' }} /></button>
              </div>
            ))}
          </S1Section>

          <S1Section title="References (2)">
            {refs.map((r, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                <input className={inp()} placeholder="Name" value={r.name} onChange={(e) => setRefs((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input className={inp()} placeholder="Mobile" value={r.mobile} onChange={(e) => setRefs((p) => p.map((x, j) => j === i ? { ...x, mobile: e.target.value } : x))} />
                <input className={inp()} placeholder="Relation" value={r.relation} onChange={(e) => setRefs((p) => p.map((x, j) => j === i ? { ...x, relation: e.target.value } : x))} />
              </div>
            ))}
          </S1Section>

          <div><FLabel text="Notes — partner / director-as-applicant details, etc." /><textarea className={inp()} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--shell-border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={save} disabled={busy} className="flex-1 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>{busy ? 'Saving…' : 'Save Stage-1 data'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
export function S1Section({ title, onAdd, children }: { title: string; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#C9A961' }}>{title}</p>
        {onAdd && <button onClick={onAdd} className="text-[11px] font-semibold" style={{ color: '#C9A961' }}>+ Add row</button>}
      </div>
      {children}
    </div>
  );
}
