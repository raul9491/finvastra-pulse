import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, UserCheck, X } from 'lucide-react';
import { format } from 'date-fns';
import {
  getDocs, updateDoc, addDoc, writeBatch,
  doc, collection, query, where, orderBy, limit, serverTimestamp,
} from 'firebase/firestore';
import { useAuth } from '../../auth/AuthContext';
import { useLeads } from '../hooks/useLeads';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useOpportunityTypes } from '../hooks/useOpportunities';
import { db } from '../../../lib/firebase';
import { BulkActionBar } from '../../../components/ui/BulkActionBar';
import type { Lead, LeadSource } from '../../../types';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';

const SOURCE_LABELS: Record<LeadSource, string> = {
  website: 'Website', instagram: 'Instagram', facebook: 'Facebook',
  walkin: 'Walk-in', referral: 'Referral', broker: 'Broker',
  offline_bulk: 'Offline Bulk', social_meta: 'Social Meta',
  employee_referral: 'Employee Referral',
};

function TableSkeleton() {
  return (
    <div className="animate-pulse">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="h-4 rounded w-40" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          <div className="h-4 rounded w-24 ml-auto" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          <div className="h-4 rounded w-20" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          <div className="h-4 rounded w-20" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          <div className="h-4 rounded w-24" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
        </div>
      ))}
    </div>
  );
}

const LEAD_BOARD_COLUMNS = [
  { key: 'interested',     label: 'Interested',     color: '#34d399' },
  { key: 'callback',       label: 'Callback later', color: '#C9A961' },
  { key: 'no_response',    label: 'No response',    color: '#fbbf24' },
  { key: 'not_interested', label: 'Not interested', color: '#f87171' },
  { key: 'wrong_number',   label: 'Wrong number',   color: '#9ca3af' },
] as const;

export function LeadsPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { leads, loading } = useLeads(user?.uid ?? null, isAdmin);
  const { employees } = useAllEmployees();
  const { types } = useOpportunityTypes();

  const [search, setSearch] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterImport, setFilterImport] = useState('');
  const [filterRm, setFilterRm] = useState('');
  const [filterUnassigned, setFilterUnassigned] = useState(false);
  const [assigningLead, setAssigningLead] = useState<Lead | null>(null);

  // ─── Bulk selection state ──────────────────────────────────────────────────
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const rmOptions = useMemo(
    () => employees.filter((e) => e.crmAccess === true || e.role === 'admin'),
    [employees],
  );

  const unassignedCount = useMemo(
    () => leads.filter((l) => l.primaryOwnerId === 'UNASSIGNED').length,
    [leads],
  );

  // Distinct import-batch names (the label admins set at import time, e.g. "Sample Test")
  const importOptions = useMemo(
    () => Array.from(new Set(leads.map((l) => l.importName).filter((n): n is string => !!n))).sort(),
    [leads],
  );

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (filterUnassigned) return l.primaryOwnerId === 'UNASSIGNED';
      if (filterSource && l.source !== filterSource) return false;
      if (filterImport && l.importName !== filterImport) return false;
      if (filterRm && l.primaryOwnerId !== filterRm) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!l.displayName.toLowerCase().includes(q) && !l.phone.includes(q)) return false;
      }
      return true;
    });
  }, [leads, search, filterSource, filterImport, filterRm, filterUnassigned]);

  // Dispositioned leads move to the Kanban board; only "remaining" leads stay in the table.
  const tableLeads = useMemo(
    () => filtered.filter((l) => !l.leadStatus || l.leadStatus === 'new'),
    [filtered],
  );
  const boardByStatus = useMemo(() => {
    const m = new Map<string, Lead[]>();
    filtered.forEach((l) => {
      if (l.leadStatus && l.leadStatus !== 'new') {
        if (!m.has(l.leadStatus)) m.set(l.leadStatus, []);
        m.get(l.leadStatus)!.push(l);
      }
    });
    return m;
  }, [filtered]);

  // Stage options derived from the first active loan opportunity type, with a
  // hardcoded fallback so the dropdown is never empty before Firestore loads.
  const loanStages = useMemo(() => {
    const loanType = types.find((t) => t.businessLine === 'loan');
    return loanType?.stages ?? [
      'New', 'Contacted', 'Documents Collected',
      'Submitted to Bank', 'Under Review', 'Sanctioned', 'Disbursed',
    ];
  }, [types]);

  const rmName = (uid: string) => {
    if (uid === 'UNASSIGNED') return '—';
    return employees.find((e) => e.userId === uid)?.displayName ?? uid.slice(0, 8);
  };

  const selectClass = "glass-inp text-sm w-full";

  // ─── Select-all toggle ────────────────────────────────────────────────────
  const allFilteredSelected =
    tableLeads.length > 0 && tableLeads.every((l) => selectedLeadIds.has(l.id));

  const handleSelectAll = (checked: boolean) => {
    setSelectedLeadIds(checked ? new Set(tableLeads.map((l) => l.id)) : new Set());
  };

  const handleToggleRow = (id: string, checked: boolean) => {
    const next = new Set(selectedLeadIds);
    if (checked) next.add(id); else next.delete(id);
    setSelectedLeadIds(next);
  };

  // ─── Bulk: move most-recent open opportunity to a new stage ───────────────
  // Only affects the single most-recently-created open opportunity per lead.
  const handleBulkStageUpdate = async (stage: string) => {
    const selected = filtered.filter((l) => selectedLeadIds.has(l.id));
    if (selected.length === 0) return;
    const confirmed = window.confirm(
      `Move ${selected.length} lead${selected.length !== 1 ? 's' : ''} to stage "${stage}"?\n` +
      `This will update the most recent open opportunity on each lead.`,
    );
    if (!confirmed) return;

    setBulkProcessing(true);
    try {
      for (const lead of selected) {
        try {
          const oppsSnap = await getDocs(
            query(
              collection(db, 'leads', lead.id, 'opportunities'),
              where('status', '==', 'open'),
              orderBy('createdAt', 'desc'),
              limit(1),
            ),
          );
          if (oppsSnap.empty) continue;
          const opp = oppsSnap.docs[0];
          await updateDoc(doc(db, 'leads', lead.id, 'opportunities', opp.id), {
            stage,
            updatedAt: serverTimestamp(),
          });
          await addDoc(
            collection(db, 'leads', lead.id, 'opportunities', opp.id, 'activities'),
            {
              type: 'status_change',
              content: `Stage updated to "${stage}" via bulk action`,
              by: user!.uid,
              at: serverTimestamp(),
            },
          );
        } catch {
          // Skip individual failures — they show up as unchanged rows; user can retry
        }
      }
      setSelectedLeadIds(new Set());
    } finally {
      setBulkProcessing(false);
    }
  };

  // ─── Bulk: reassign primaryOwnerId ───────────────────────────────────────
  const handleBulkAssignRm = async (rmId: string) => {
    const selected = filtered.filter((l) => selectedLeadIds.has(l.id));
    if (selected.length === 0) return;
    const targetName = employees.find((e) => e.userId === rmId)?.displayName ?? rmId;
    const confirmed = window.confirm(
      `Assign ${selected.length} lead${selected.length !== 1 ? 's' : ''} to ${targetName}?`,
    );
    if (!confirmed) return;

    setBulkProcessing(true);
    try {
      // Firestore batched writes max out at 500 operations per batch.
      const BATCH_SIZE = 499;
      for (let i = 0; i < selected.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = selected.slice(i, i + BATCH_SIZE);
        for (const lead of chunk) {
          batch.update(doc(db, 'leads', lead.id), {
            primaryOwnerId: rmId,
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }
      setSelectedLeadIds(new Set());
    } finally {
      setBulkProcessing(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            Customers
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {loading ? 'Loading…' : `${tableLeads.length} to action · ${filtered.length} total · each row is a person, not a deal`}
          </p>
        </div>
        <button
          onClick={() => navigate('/crm/leads/new')}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
        >
          <Plus size={16} /> New Customer
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone…"
            className="glass-inp text-sm pl-9 pr-4 py-2 w-52"
          />
        </div>
        <select className={selectClass} value={filterSource} onChange={(e) => setFilterSource(e.target.value)}
          style={{ width: 'auto', minWidth: 120 }}>
          <option value="">All Sources</option>
          {(Object.keys(SOURCE_LABELS) as LeadSource[]).map((s) => (
            <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
          ))}
        </select>
        {importOptions.length > 0 && (
          <select className={selectClass} value={filterImport} onChange={(e) => setFilterImport(e.target.value)}
            style={{ width: 'auto', minWidth: 150 }}>
            <option value="">All Imports</option>
            {importOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        )}
        <SearchableSelect
          options={[
            { value: '', label: 'All RMs' },
            ...rmOptions.map((e) => ({ value: e.userId, label: e.displayName })),
          ]}
          value={filterRm}
          onChange={(v) => setFilterRm(v)}
          label="Filter by RM"
        />
        {/* Referrals quick-filter chip — visible to admin and CRM-role employees */}
        {(isAdmin || !!profile?.crmRole) && (
          <button
            onClick={() =>
              setFilterSource((prev) => (prev === 'employee_referral' ? '' : 'employee_referral'))
            }
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full border transition-colors"
            style={
              filterSource === 'employee_referral'
                ? { backgroundColor: '#C9A961', color: '#0B1538', borderColor: '#C9A961' }
                : { backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', borderColor: 'rgba(255,255,255,0.12)' }
            }
          >
            🔖 Referrals
          </button>
        )}
        {/* Unassigned chip — admin/manager only; shows count badge when leads are waiting */}
        {isAdmin && (
          <button
            onClick={() => { setFilterUnassigned((v) => !v); setFilterSource(''); setFilterRm(''); }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full border transition-colors"
            style={
              filterUnassigned
                ? { backgroundColor: '#f87171', color: '#fff', borderColor: '#f87171' }
                : { backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', borderColor: 'rgba(255,255,255,0.12)' }
            }
          >
            <UserCheck size={12} />
            Unassigned
            {unassignedCount > 0 && !filterUnassigned && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                style={{ backgroundColor: 'rgba(248,113,113,0.25)', color: '#f87171' }}>
                {unassignedCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Disposition board — dispositioned leads grouped by status (click a card to open) */}
      {!loading && (
        <div className="mb-5 overflow-x-auto">
          <div className="flex gap-3 min-w-max pb-1">
            {LEAD_BOARD_COLUMNS.map((col) => {
              const items = boardByStatus.get(col.key) ?? [];
              return (
                <div key={col.key} className="w-56 shrink-0 glass-panel p-3" style={{ borderTop: `2px solid ${col.color}` }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold" style={{ color: col.color }}>{col.label}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${col.color}22`, color: col.color }}>{items.length}</span>
                  </div>
                  <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 240 }}>
                    {items.map((l) => (
                      <button key={l.id} onClick={() => navigate(`/crm/leads/${l.id}`)}
                        className="w-full text-left px-2.5 py-2 rounded-lg transition-colors hover:bg-white/5" style={{ border: '1px solid var(--shell-border)' }}>
                        <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{l.displayName}</p>
                        <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{l.phone} · {rmName(l.primaryOwnerId)}</p>
                      </button>
                    ))}
                    {items.length === 0 && <p className="text-[10px] text-center py-3" style={{ color: 'var(--text-muted)' }}>None</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Table — watermarked with employee name + date to deter screenshots */}
      <div className="glass-panel overflow-hidden relative">
        <LeadListWatermark
          name={profile?.displayName ?? ''}
          date={format(new Date(), 'dd MMM yyyy')}
        />
        {loading ? (
          <TableSkeleton />
        ) : tableLeads.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-lg mb-2" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', color: 'var(--text-primary)' }}>
              {leads.length === 0 ? 'No customers yet.' : filtered.length === 0 ? 'No customers match your filters.' : 'All matching leads have been actioned 🎉'}
            </p>
            {leads.length === 0 && (
              <button onClick={() => navigate('/crm/leads/new')}
                className="mt-3 text-sm font-semibold underline" style={{ color: '#C9A961' }}>
                Add your first customer →
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {/* Select-all checkbox */}
                  <th className="px-5 py-3.5 w-10">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className="cursor-pointer"
                      aria-label="Select all visible leads"
                    />
                  </th>
                  {['Name', 'Phone', 'Source', 'Import', 'Primary RM'].map((h) => (
                    <th key={h} className="px-5 py-3.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableLeads.map((lead: Lead) => (
                  <tr key={lead.id}
                    onClick={() => navigate(`/crm/leads/${lead.id}`)}
                    className="cursor-pointer hover:bg-white/5 transition-colors"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {/* Per-row checkbox — stopPropagation so clicking it doesn't navigate */}
                    <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedLeadIds.has(lead.id)}
                        onChange={(e) => handleToggleRow(lead.id, e.target.checked)}
                        className="cursor-pointer"
                        aria-label={`Select ${lead.displayName}`}
                      />
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{lead.displayName}</p>
                    </td>
                    <td className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>{lead.phone}</td>
                    <td className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>
                      {SOURCE_LABELS[lead.source] ?? lead.source}
                    </td>
                    <td className="px-5 py-4 text-sm">
                      {lead.importName
                        ? <span className="px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961' }}>{lead.importName}</span>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>
                      {lead.primaryOwnerId === 'UNASSIGNED'
                        ? <span style={{ color: '#f87171' }}>Unassigned</span>
                        : rmName(lead.primaryOwnerId)}
                    </td>
                    {/* Assign button — shown on unassigned rows for admin */}
                    {isAdmin && lead.primaryOwnerId === 'UNASSIGNED' && (
                      <td className="px-3 py-4" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setAssigningLead(lead)}
                          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
                          style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
                          <UserCheck size={12} /> Assign
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Floating bulk-action bar — appears when at least one lead is selected */}
      {selectedLeadIds.size > 0 && (
        <BulkActionBar
          selectedCount={selectedLeadIds.size}
          onClearSelection={() => setSelectedLeadIds(new Set())}
          stageOptions={loanStages.map((s) => ({ label: s, value: s }))}
          onStageUpdate={handleBulkStageUpdate}
          rmOptions={rmOptions.map((e) => ({ label: e.displayName, value: e.userId }))}
          onAssignRm={handleBulkAssignRm}
          onAddTag={() => {}} // Phase 2.5c: tag management
          isProcessing={bulkProcessing}
        />
      )}

      {/* Assign lead modal */}
      {assigningLead && (
        <AssignLeadModal
          lead={assigningLead}
          generatorOptions={employees
            .filter((e) => e.crmRole === 'lead_generator' || e.role === 'admin')
            .map((e) => ({ value: e.userId, label: e.displayName }))}
          onClose={() => setAssigningLead(null)}
        />
      )}
    </div>
  );
}

// ─── Lead List Watermark ──────────────────────────────────────────────────────
// Diagonal repeating overlay — visible in screenshots to deter/trace data leaks.
// pointer-events:none so it never blocks clicks or selection.

function LeadListWatermark({ name, date }: { name: string; date: string }) {
  const text = `${name}  ·  ${date}`;
  const entries = Array.from({ length: 24 });
  return (
    <div
      className="absolute inset-0 overflow-hidden select-none"
      style={{ pointerEvents: 'none', zIndex: 2 }}
      aria-hidden="true"
    >
      {entries.map((_, i) => {
        const row = Math.floor(i / 4);
        const col = i % 4;
        return (
          <span
            key={i}
            className="absolute text-[10px] font-semibold tracking-widest whitespace-nowrap"
            style={{
              top:       `${row * 18 + 4}%`,
              left:      `${col * 28 - 6}%`,
              transform: 'rotate(-22deg)',
              color:     'rgba(201,169,97,0.09)',
              letterSpacing: '0.12em',
            }}
          >
            {text}
          </span>
        );
      })}
    </div>
  );
}

// ─── Assign Lead Modal ────────────────────────────────────────────────────────

function AssignLeadModal({
  lead,
  generatorOptions,
  onClose,
}: {
  lead: Lead;
  generatorOptions: { value: string; label: string }[];
  onClose: () => void;
}) {
  const [selectedUid, setSelectedUid] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleAssign = async () => {
    if (!selectedUid) { setErr('Select an RM to assign this lead.'); return; }
    setSaving(true);
    try {
      await updateDoc(doc(db, 'leads', lead.id), {
        primaryOwnerId: selectedUid,
        updatedAt:      serverTimestamp(),
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to assign. Try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 glass-modal-overlay">
      <div className="glass-modal-panel w-full max-w-sm">
        {/* Header */}
        <div className="glass-modal-header flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Assign Lead</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--shell-text-dim)' }}>{lead.displayName} · {lead.phone}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg nav-item-hover">
            <X size={15} style={{ color: 'var(--shell-text-dim)' }} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-2"
              style={{ color: 'var(--shell-text-dim)' }}>
              Assign to RM *
            </label>
            <SearchableSelect
              options={generatorOptions}
              value={selectedUid}
              onChange={(v) => { setSelectedUid(v); setErr(''); }}
              label="Select RM…"
            />
          </div>
          {err && <p className="text-xs" style={{ color: '#f87171' }}>{err}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex gap-3" style={{ borderTop: '1px solid var(--shell-border)' }}>
          <button
            onClick={handleAssign}
            disabled={saving || !selectedUid}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            <UserCheck size={14} />
            {saving ? 'Assigning…' : 'Confirm Assignment'}
          </button>
          <button onClick={onClose} className="text-sm transition-opacity hover:opacity-60"
            style={{ color: 'var(--shell-text-secondary)' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
