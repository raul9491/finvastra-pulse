/**
 * The per-employee offboarding detail view: the checklist itself plus the FnF
 * panel and its actions.
 * 
 * Extracted verbatim from OffboardingPage.tsx (2026-07-23) - no behaviour
 * change.
 */
import { useState, useEffect } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { format } from 'date-fns';
import {
  ChevronLeft, Check, Circle, CheckCircle2, FileText,
  Calculator, Download, IndianRupee, AlertCircle, ExternalLink,
} from 'lucide-react';
import { db } from '../../../lib/firebase';
import type {
  OffboardingChecklist, ChecklistItem, ChecklistItemCategory, ChecklistStatus, UserProfile,
} from '../../../types';
import { EXIT_REASON_LABELS } from '../../../types';
import { TickItemModal, FnFCalculatorModal, SettleFnFModal } from './offboardingModals';
import { generateFnFPdf, generateExperienceLetter, generateRelievingLetter } from './offboardingPdf';
import { toDate, formatCurrency, statusBadge, fnfBadge, CATEGORY_META } from './OffboardingPage';
// ─── Detail View ──────────────────────────────────────────────────────────────

export function ChecklistDetail({
  checklist, currentUid, onBack,
}: {
  checklist: OffboardingChecklist; currentUid: string; onBack: () => void;
}) {
  const [tickingItem, setTickingItem] = useState<ChecklistItem | null>(null);
  const [showFnFCalc, setShowFnFCalc] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [empProfile, setEmpProfile] = useState<UserProfile | null>(null);

  // Fetch employee profile (for letter generation) once on mount
  useEffect(() => {
    getDoc(doc(db, 'users', checklist.id)).then((snap) => {
      if (snap.exists()) setEmpProfile(snap.data() as UserProfile);
    }).catch(() => {});
  }, [checklist.id]);

  const handleExperienceLetter = () => {
    if (!empProfile) return;
    generateExperienceLetter(live, empProfile);
  };

  const handleRelievingLetter = () => {
    if (!empProfile) return;
    generateRelievingLetter(live, empProfile);
  };

  // Subscribe to live updates for this checklist
  const [live, setLive] = useState<OffboardingChecklist>(checklist);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'offboarding_checklists', checklist.id), snap => {
      if (snap.exists()) setLive({ id: snap.id, ...snap.data() } as OffboardingChecklist);
    });
    return unsub;
  }, [checklist.id]);

  // CRM reassignment item is rendered separately at the top if present
  const crmItem = live.items.find((i) => i.id === 'crm_reassignment');
  const crmReassigned = !crmItem || crmItem.completed;
  const nonCrmItems = live.items.filter((i) => i.id !== 'crm_reassignment');

  const grouped = Object.entries(
    nonCrmItems.reduce<Record<string, ChecklistItem[]>>((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {})
  ) as [ChecklistItemCategory, ChecklistItem[]][];

  const done = live.items.filter(i => i.completed).length;
  const total = live.items.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={onBack} className="mt-0.5 p-2 rounded-xl border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold text-(--text-primary)">{live.employeeName}</h2>
            {statusBadge(live.status)}
            {fnfBadge(live.fnfStatus)}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted mt-1 flex-wrap">
            {live.lastWorkingDate && <span>LWD: {live.lastWorkingDate}</span>}
            {live.exitReason && <span>Exit: {EXIT_REASON_LABELS[live.exitReason]}</span>}
          </div>
        </div>
      </div>

      {/* CRM Reassignment — shown at top when present and not yet done */}
      {crmItem && (
        <div className={`rounded-2xl border-2 p-5 shadow-sm ${crmItem.completed ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'}`}>
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="shrink-0 mt-0.5" style={{ color: crmItem.completed ? '#166534' : '#DC2626' }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: crmItem.completed ? '#166534' : '#DC2626' }}>
                {crmItem.completed ? 'CRM Reassignment Complete ✓' : 'Action Required: CRM Reassignment'}
              </p>
              <p className="text-sm mt-1" style={{ color: crmItem.completed ? '#166534' : '#991B1B' }}>
                {crmItem.task}
              </p>
              {!crmItem.completed && (
                <div className="flex items-center gap-3 mt-3">
                  <a
                    href={(crmItem as ChecklistItem & { metadata?: { reassignUrl?: string } }).metadata?.reassignUrl ?? '/crm/leads'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                    style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}
                  >
                    <ExternalLink size={12} />
                    Go to CRM to reassign →
                  </a>
                  <button
                    onClick={() => setTickingItem(crmItem)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-300 transition-colors hover:bg-red-100"
                    style={{ color: '#DC2626' }}
                  >
                    <Check size={12} />
                    Mark as done
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-(--text-primary)">Checklist Progress</span>
          <span className="text-2xl font-bold" style={{ color: pct === 100 ? '#16a34a' : '#ef4444' }}>{pct}%</span>
        </div>
        <div className="bg-(--glass-panel-bg) rounded-full h-2.5 overflow-hidden">
          <div className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: pct === 100 ? '#16a34a' : '#ef4444' }} />
        </div>
        <p className="text-xs text-muted mt-2">{done} of {total} tasks completed</p>
      </div>

      {/* FnF panel */}
      <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IndianRupee size={16} style={{ color: '#C9A961' }} />
            <span className="text-sm font-semibold text-(--text-primary)">Full &amp; Final Settlement</span>
          </div>
          {fnfBadge(live.fnfStatus)}
        </div>

        {live.fnfDetails && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs text-muted">Net Payable</p>
              <p className="font-bold text-lg" style={{ color: live.fnfDetails.totalPayable >= 0 ? '#166534' : '#BE123C' }}>
                {formatCurrency(live.fnfDetails.totalPayable)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Gross Salary Basis</p>
              <p className="font-medium">{formatCurrency(live.fnfDetails.grossSalary)}/mo</p>
            </div>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowFnFCalc(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
            <Calculator size={13} />
            {live.fnfDetails ? 'Recalculate FnF' : 'Calculate FnF'}
          </button>
          {live.fnfDetails && live.fnfStatus !== 'settled' && (
            <div className="relative group inline-flex">
              <button
                onClick={() => crmReassigned && setShowSettle(true)}
                disabled={!crmReassigned}
                title={!crmReassigned ? 'Reassign all open CRM items before settling FnF.' : undefined}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors"
                style={{
                  backgroundColor: crmReassigned ? '#16a34a' : '#D1FAE5',
                  color: crmReassigned ? '#FFFFFF' : '#6B7280',
                  cursor: crmReassigned ? 'pointer' : 'not-allowed',
                }}
              >
                <Check size={13} />Mark FnF as Settled
              </button>
              {!crmReassigned && (
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs bg-slate-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  Reassign all open CRM items before settling FnF.
                </span>
              )}
            </div>
          )}
          {live.fnfDetails && (
            <button
              onClick={() => {
                const withTimestamp: OffboardingChecklist = {
                  ...live,
                  fnfDetails: {
                    ...live.fnfDetails!,
                    statementGeneratedAt: live.fnfDetails!.statementGeneratedAt ?? { toDate: () => new Date() } as any,
                  },
                };
                generateFnFPdf(withTimestamp);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
              <Download size={13} />Download FnF PDF
            </button>
          )}
        </div>

        {live.fnfStatus === 'settled' && live.fnfSettledAt && (
          <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">
            Settled on {format(toDate(live.fnfSettledAt)!, 'dd MMM yyyy')}
          </p>
        )}
      </div>

      {/* Checklist items by category */}
      {grouped.map(([cat, items]) => {
        const meta = CATEGORY_META[cat] ?? CATEGORY_META.other;
        const catDone = items.filter(i => i.completed).length;
        return (
          <div key={cat} className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-(--shell-border)"
              style={{ background: `${meta.color}10` }}>
              <meta.icon size={15} style={{ color: meta.color }} />
              <span className="text-sm font-semibold" style={{ color: meta.color }}>{meta.label}</span>
              <span className="ml-auto text-xs text-muted">{catDone}/{items.length}</span>
            </div>
            <ul className="divide-y divide-(--shell-border)">
              {items.map(item => (
                <li key={item.id}
                  className={`flex items-start gap-3 px-5 py-3 transition-colors ${item.completed && item.task.toLowerCase().includes('disabled') ? 'opacity-60' : 'hover:bg-(--glass-panel-bg) cursor-pointer'}`}
                  onClick={() => !item.task.toLowerCase().includes('disabled') && setTickingItem(item)}>
                  <div className="mt-0.5 flex-shrink-0">
                    {item.outcome === 'not_applicable'
                      ? <Circle size={18} className="text-(--text-dim)" />
                      : item.completed
                        ? <CheckCircle2 size={18} className="text-green-500" />
                        : <div className="w-[18px] h-[18px] rounded-full border-2 border-(--shell-border-mid)" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${item.completed ? 'line-through text-muted' : 'text-(--text-primary)'}`}>{item.task}</p>
                    {item.notes && <p className="text-xs text-muted mt-0.5 truncate">{item.notes}</p>}
                    {item.completedAt && <p className="text-xs text-muted mt-0.5">{item.outcome === 'not_applicable' ? 'Marked N/A · ' : ''}{format(toDate(item.completedAt)!, 'dd MMM yyyy')}</p>}
                  </div>
                  {item.outcome === 'not_applicable' && (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full self-center"
                      style={{ backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-muted)' }}>N/A</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {/* HR Letters */}
      <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <FileText size={16} style={{ color: '#C9A961' }} />
          <span className="text-sm font-semibold text-(--text-primary)">HR Letters</span>
        </div>
        {!empProfile && (
          <p className="text-xs text-muted">Loading employee data…</p>
        )}
        {empProfile && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={handleExperienceLetter}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
              <Download size={13} />Experience Certificate
            </button>
            <button onClick={handleRelievingLetter}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors">
              <Download size={13} />Relieving Letter
            </button>
          </div>
        )}
      </div>

      {tickingItem && (
        <TickItemModal item={tickingItem} checklistId={live.id} uid={currentUid} onClose={() => setTickingItem(null)} />
      )}
      {showFnFCalc && (
        <FnFCalculatorModal checklist={live} currentUid={currentUid} onClose={() => setShowFnFCalc(false)} />
      )}
      {showSettle && (
        <SettleFnFModal checklist={live} currentUid={currentUid} onClose={() => setShowSettle(false)} />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export type OffboardingFilter = 'all' | ChecklistStatus | 'fnf_pending' | 'fnf_settled';
