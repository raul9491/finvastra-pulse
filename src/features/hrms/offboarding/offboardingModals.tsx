/**
 * The three offboarding dialogs: tick-a-checklist-item, the FnF calculator,
 * and mark-FnF-settled.
 * 
 * Extracted verbatim from OffboardingPage.tsx (2026-07-23) - no behaviour
 * change.
 */
import { useState, useEffect, useMemo } from 'react';
import { Check, Calculator, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { doc, getDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type {
  ChecklistItem, ChecklistStatus, FnFDetails, OffboardingChecklist,
} from '../../../types';
import { computeFnF, type FnFInputs } from './fnf';
import { formatCurrency } from './OffboardingPage';
// ─── Tick Item Modal ──────────────────────────────────────────────────────────

export function TickItemModal({
  item, checklistId, uid, onClose,
}: {
  item: ChecklistItem; checklistId: string; uid: string; onClose: () => void;
}) {
  const [notes, setNotes] = useState(item.notes ?? '');
  const [saving, setSaving] = useState(false);

  // 'done' = actually done · 'not_applicable' = never applied (e.g. no laptop/SIM
  // to return) · null = back to pending. Both done + N/A resolve the item.
  const handleSave = async (outcome: 'done' | 'not_applicable' | null) => {
    setSaving(true);
    try {
      const ref = doc(db, 'offboarding_checklists', checklistId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const data = snap.data() as Omit<OffboardingChecklist, 'id'>;
      const complete = outcome !== null;
      const updatedItems = data.items.map(i =>
        i.id === item.id
          ? { ...i, completed: complete, outcome, completedAt: complete ? Timestamp.now() : null, completedBy: complete ? uid : null, notes: notes.trim() || null }
          : i
      );
      const allDone = updatedItems.every(i => i.completed);
      const anyDone = updatedItems.some(i => i.completed);
      const newStatus: ChecklistStatus = allDone ? 'completed' : anyDone ? 'in_progress' : 'pending';
      await updateDoc(ref, {
        items: updatedItems,
        status: newStatus,
        completedAt: allDone ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setSaving(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-base font-semibold text-(--text-primary)">{item.task}</h3>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Notes (optional)</label>
          <textarea className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-gold/30"
            rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add a note…" />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} disabled={saving}
            className="flex-1 border border-(--shell-border) rounded-xl py-2 text-sm font-medium text-muted hover:bg-(--glass-panel-bg) transition-colors">
            Cancel
          </button>
          {item.completed ? (
            <button onClick={() => handleSave(null)} disabled={saving}
              className="flex-1 border border-amber-200 rounded-xl py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 transition-colors">
              Reset to pending
            </button>
          ) : (
            <>
              <button onClick={() => handleSave('not_applicable')} disabled={saving}
                className="flex-1 border border-(--shell-border) rounded-xl py-2 text-sm font-medium text-muted hover:bg-(--glass-panel-bg) transition-colors"
                title="Never applied to this employee (e.g. no laptop/SIM to return)">
                Not applicable
              </button>
              <button onClick={() => handleSave('done')} disabled={saving}
                className="flex-1 bg-navy text-white rounded-xl py-2 text-sm font-semibold hover:bg-navy-soft transition-colors flex items-center justify-center gap-1.5">
                <Check size={14} />Mark Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── FnF Calculator Modal ─────────────────────────────────────────────────────

export function FnFCalculatorModal({
  checklist, currentUid, onClose,
}: {
  checklist: OffboardingChecklist; currentUid: string; onClose: () => void;
}) {
  const existing = checklist.fnfDetails;
  const [inputs, setInputs] = useState<FnFInputs>({
    grossSalary:            existing ? String(existing.grossSalary) : '',
    workingDaysInLastMonth: existing ? String(existing.workingDaysInLastMonth) : '26',
    daysWorked:             existing ? String(existing.daysWorked) : '',
    earnedLeaveBalance:     existing ? String(existing.earnedLeaveBalance) : '',
    joiningDateStr:         '',
    lastWorkingDateStr:     checklist.lastWorkingDate ?? '',
    noticePeriodDays:       existing ? String(existing.noticePeriodDays) : '30',
    noticePeriodServed:     existing ? String(existing.noticePeriodServed) : '',
    bonusAmount:            existing?.bonusAmount ? String(existing.bonusAmount) : '',
    fuelAmount:             existing?.fuelAmount ? String(existing.fuelAmount) : '',
    compOffDays:            existing?.compOffDays ? String(existing.compOffDays) : '',
    excessPaidRecovery:     existing?.excessPaidRecovery ? String(existing.excessPaidRecovery) : '',
    excessPaidRecoveryNotes:existing?.excessPaidRecoveryNotes ?? '',
    otherDeductions:        existing ? String(existing.otherDeductions) : '0',
    otherDeductionNotes:    existing?.otherDeductionNotes ?? '',
  });
  const [saving, setSaving] = useState(false);

  // Auto-fill grossSalary from employee_sensitive when opening a fresh FnF (no existing data).
  // Admin can override. Only runs once on mount when no fnfDetails yet.
  useEffect(() => {
    if (existing) return; // already has saved data — don't overwrite
    getDoc(doc(db, 'employee_sensitive', checklist.id)).then((snap) => {
      if (!snap.exists()) return;
      const d = snap.data() as { grossSalary?: number };
      if (d.grossSalary) {
        setInputs((prev) => ({ ...prev, grossSalary: String(d.grossSalary) }));
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const result = useMemo(() => computeFnF(inputs), [inputs]);

  const set = (k: keyof FnFInputs) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setInputs(prev => ({ ...prev, [k]: e.target.value }));

  const handleSave = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const finalResult: FnFDetails = {
        ...result,
        finalizedAt: serverTimestamp() as any,
        finalizedBy: currentUid,
        statementGeneratedAt: null,
      };
      await updateDoc(doc(db, 'offboarding_checklists', checklist.id), {
        fnfDetails: finalResult,
        fnfStatus: 'calculated',
        updatedAt: serverTimestamp(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = "w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold/30";
  const labelClass = "block text-xs font-medium text-muted mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-2xl my-4">
        <div className="px-6 py-4 border-b border-(--shell-border) flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calculator size={18} style={{ color: '#C9A961' }} />
            <h3 className="text-base font-semibold text-(--text-primary)">FnF Calculator — {checklist.employeeName}</h3>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Salary inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Gross Monthly Salary (₹) *</label>
              <input type="number" className={fieldClass} value={inputs.grossSalary} onChange={set('grossSalary')} placeholder="e.g. 45000" />
            </div>
            <div>
              <label className={labelClass}>Working Days in Last Month</label>
              <input type="number" className={fieldClass} value={inputs.workingDaysInLastMonth} onChange={set('workingDaysInLastMonth')} placeholder="26" />
            </div>
            <div>
              <label className={labelClass}>Days Worked in Last Month *</label>
              <input type="number" className={fieldClass} value={inputs.daysWorked} onChange={set('daysWorked')} placeholder="e.g. 18" />
            </div>
            <div>
              <label className={labelClass}>Earned Leave Balance (days)</label>
              <input type="number" className={fieldClass} value={inputs.earnedLeaveBalance} onChange={set('earnedLeaveBalance')} placeholder="e.g. 10 (max 30 encashed)" />
            </div>
          </div>

          {/* Tenure */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Joining Date (for gratuity)</label>
              <input type="text" className={fieldClass} value={inputs.joiningDateStr} onChange={set('joiningDateStr')} placeholder="DD-MM-YYYY or YYYY-MM-DD" />
            </div>
            <div>
              <label className={labelClass}>Last Working Date</label>
              <input type="text" className={fieldClass} value={inputs.lastWorkingDateStr} onChange={set('lastWorkingDateStr')} placeholder="DD-MM-YYYY or YYYY-MM-DD" />
            </div>
          </div>

          {/* Notice */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Notice Period (days)</label>
              <input type="number" className={fieldClass} value={inputs.noticePeriodDays} onChange={set('noticePeriodDays')} placeholder="30" />
            </div>
            <div>
              <label className={labelClass}>Notice Period Served (days)</label>
              <input type="number" className={fieldClass} value={inputs.noticePeriodServed} onChange={set('noticePeriodServed')} placeholder="e.g. 15" />
            </div>
          </div>

          {/* Additional earnings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Bonus Amount (₹)</label>
              <input type="number" className={fieldClass} value={inputs.bonusAmount} onChange={set('bonusAmount')} placeholder="0" />
            </div>
            <div>
              <label className={labelClass}>Fuel Allowance (₹)</label>
              <input type="number" className={fieldClass} value={inputs.fuelAmount} onChange={set('fuelAmount')} placeholder="0" />
            </div>
            <div>
              <label className={labelClass}>Comp Off Encashment (days)</label>
              <input type="number" className={fieldClass} value={inputs.compOffDays} onChange={set('compOffDays')} placeholder="0" />
            </div>
          </div>

          {/* Additional deductions */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Excess Paid Recovery (₹)</label>
              <input type="number" className={fieldClass} value={inputs.excessPaidRecovery} onChange={set('excessPaidRecovery')} placeholder="0" />
            </div>
            <div>
              <label className={labelClass}>Recovery Notes</label>
              <input type="text" className={fieldClass} value={inputs.excessPaidRecoveryNotes} onChange={set('excessPaidRecoveryNotes')} placeholder="e.g. Advance adjustment" />
            </div>
          </div>

          {/* Other deductions */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Other Deductions (₹)</label>
              <input type="number" className={fieldClass} value={inputs.otherDeductions} onChange={set('otherDeductions')} placeholder="0" />
            </div>
            <div>
              <label className={labelClass}>Deduction Notes</label>
              <input type="text" className={fieldClass} value={inputs.otherDeductionNotes} onChange={set('otherDeductionNotes')} placeholder="e.g. Advance recovery" />
            </div>
          </div>

          {/* Preview */}
          {result && (
            <div className="bg-(--glass-panel-bg) rounded-2xl p-4 space-y-2 text-sm">
              <p className="font-semibold text-(--text-primary) mb-3">Breakdown Preview</p>
              {/* Earnings */}
              {[
                ['Daily Rate', formatCurrency(result.dailyRate)],
                ['Salary for Days Worked', formatCurrency(result.salaryForDaysWorked)],
                ['Leave Encashment', formatCurrency(result.leaveEncashmentAmount)],
                [`Gratuity${result.gratuityApplicable ? '' : ' (not applicable)'}`, formatCurrency(result.gratuityAmount)],
                ...(result.bonusAmount ? [['Bonus', formatCurrency(result.bonusAmount)]] : []),
                ...(result.fuelAmount  ? [['Fuel Allowance', formatCurrency(result.fuelAmount)]] : []),
                ...(result.compOffDays ? [['Comp Off Encashment', formatCurrency(result.compOffEncashmentAmount ?? 0)]] : []),
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted">{label}</span>
                  <span className="font-medium text-(--text-primary)">{val}</span>
                </div>
              ))}
              <div className="border-t border-(--shell-border) my-2" />
              {/* Deductions */}
              {[
                ['Notice Deduction', `-${formatCurrency(result.noticePeriodDeduction)}`],
                ...(result.excessPaidRecovery ? [['Excess Paid Recovery', `-${formatCurrency(result.excessPaidRecovery)}`]] : []),
                ['Other Deductions', `-${formatCurrency(result.otherDeductions)}`],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted">{label}</span>
                  <span className="font-medium text-red-600">{val}</span>
                </div>
              ))}
              <div className="border-t border-(--shell-border) mt-2 pt-2 flex justify-between">
                <span className="font-bold text-(--text-primary)">Net Payable</span>
                <span className="font-bold text-lg" style={{ color: result.totalPayable >= 0 ? '#166534' : '#BE123C' }}>
                  {formatCurrency(result.totalPayable)}
                </span>
              </div>
            </div>
          )}

          {!result && (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-xl p-3">
              <AlertCircle size={15} />
              Enter gross salary and days worked to see the calculation.
            </div>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose} disabled={saving}
            className="flex-1 border border-(--shell-border) rounded-xl py-2 text-sm font-medium text-muted hover:bg-(--glass-panel-bg) transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!result || saving}
            className="flex-1 bg-navy text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-navy-soft transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50">
            <Check size={14} />Save FnF Calculation
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Settle FnF Modal ─────────────────────────────────────────────────────────

export function SettleFnFModal({
  checklist, currentUid, onClose,
}: {
  checklist: OffboardingChecklist; currentUid: string; onClose: () => void;
}) {
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSettle = async () => {
    if (!reference.trim()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'offboarding_checklists', checklist.id), {
        fnfStatus: 'settled',
        fnfSettledAt: serverTimestamp(),
        fnfSettledBy: currentUid,
        'fnfDetails.statementGeneratedAt': serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } finally {
      setSaving(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-(--glass-panel-bg) rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-semibold text-(--text-primary)">Mark FnF as Settled</h3>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Payment Date *</label>
          <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
            className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold/30" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Payment Reference / UTR *</label>
          <input type="text" value={reference} onChange={e => setReference(e.target.value)}
            placeholder="e.g. UTR123456789"
            className="w-full border border-(--shell-border) rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold/30" />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} disabled={saving}
            className="flex-1 border border-(--shell-border) rounded-xl py-2 text-sm font-medium text-muted hover:bg-(--glass-panel-bg) transition-colors">Cancel</button>
          <button onClick={handleSettle} disabled={!reference.trim() || saving}
            className="flex-1 bg-green-600 text-white rounded-xl py-2 text-sm font-semibold hover:bg-green-700 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50">
            <Check size={14} />Mark Settled
          </button>
        </div>
      </div>
    </div>
  );
}
