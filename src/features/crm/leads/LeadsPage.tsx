import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
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
    <div className="animate-pulse divide-y divide-slate-100">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-6 py-4">
          <div className="h-4 bg-slate-200 rounded w-40" />
          <div className="h-4 bg-slate-100 rounded w-24 ml-auto" />
          <div className="h-4 bg-slate-100 rounded w-20" />
          <div className="h-4 bg-slate-100 rounded w-20" />
          <div className="h-4 bg-slate-100 rounded w-24" />
        </div>
      ))}
    </div>
  );
}

export function LeadsPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { leads, loading } = useLeads(user?.uid ?? null, isAdmin);
  const { employees } = useAllEmployees();
  const { types } = useOpportunityTypes();

  const [search, setSearch] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterRm, setFilterRm] = useState('');

  // ─── Bulk selection state ──────────────────────────────────────────────────
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const rmOptions = useMemo(
    () => employees.filter((e) => e.crmAccess === true || e.role === 'admin'),
    [employees],
  );

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (filterSource && l.source !== filterSource) return false;
      if (filterRm && l.primaryOwnerId !== filterRm) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!l.displayName.toLowerCase().includes(q) && !l.phone.includes(q)) return false;
      }
      return true;
    });
  }, [leads, search, filterSource, filterRm]);

  // Stage options derived from the first active loan opportunity type, with a
  // hardcoded fallback so the dropdown is never empty before Firestore loads.
  const loanStages = useMemo(() => {
    const loanType = types.find((t) => t.businessLine === 'loan');
    return loanType?.stages ?? [
      'New', 'Contacted', 'Documents Collected',
      'Submitted to Bank', 'Under Review', 'Sanctioned', 'Disbursed',
    ];
  }, [types]);

  const rmName = (uid: string) =>
    employees.find((e) => e.userId === uid)?.displayName ?? uid.slice(0, 8);

  const selectClass = "text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none";

  // ─── Select-all toggle ────────────────────────────────────────────────────
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((l) => selectedLeadIds.has(l.id));

  const handleSelectAll = (checked: boolean) => {
    setSelectedLeadIds(checked ? new Set(filtered.map((l) => l.id)) : new Set());
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
          <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
            Customers
          </h2>
          <p className="text-sm" style={{ color: '#8B8B85' }}>
            {loading ? 'Loading…' : `${filtered.length} customer${filtered.length !== 1 ? 's' : ''} · each row is a person, not a deal`}
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
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone…"
            className="text-sm border border-slate-200 rounded-lg pl-9 pr-4 py-2 bg-white focus:outline-none w-52"
          />
        </div>
        <select className={selectClass} value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
          <option value="">All Sources</option>
          {(Object.keys(SOURCE_LABELS) as LeadSource[]).map((s) => (
            <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
          ))}
        </select>
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
                : { backgroundColor: '#FFFFFF', color: '#2A2A2A', borderColor: '#E2E8F0' }
            }
          >
            🔖 Referrals
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-lg mb-2" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', color: '#0A0A0A' }}>
              {leads.length === 0 ? 'No customers yet.' : 'No customers match your filters.'}
            </p>
            {leads.length === 0 && (
              <button onClick={() => navigate('/crm/leads/new')}
                className="mt-3 text-sm font-semibold underline" style={{ color: '#0B1538' }}>
                Add your first customer →
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ backgroundColor: '#FAFAF7', borderBottom: '1px solid #E2E8F0' }}>
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
                  {['Name', 'Phone', 'Source', 'Tags', 'Primary RM', 'Created'].map((h) => (
                    <th key={h} className="px-5 py-3.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead: Lead) => (
                  <tr key={lead.id}
                    onClick={() => navigate(`/crm/leads/${lead.id}`)}
                    className="cursor-pointer hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors">
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
                      <p className="text-sm font-semibold" style={{ color: '#0A0A0A' }}>{lead.displayName}</p>
                    </td>
                    <td className="px-5 py-4 text-sm" style={{ color: '#8B8B85' }}>{lead.phone}</td>
                    <td className="px-5 py-4 text-sm" style={{ color: '#2A2A2A' }}>
                      {SOURCE_LABELS[lead.source] ?? lead.source}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1">
                        {(lead.tags ?? []).map((tag) => (
                          <span key={tag} className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">{tag}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm" style={{ color: '#2A2A2A' }}>
                      {rmName(lead.primaryOwnerId)}
                    </td>
                    <td className="px-5 py-4 text-xs" style={{ color: '#8B8B85' }}>
                      {lead.createdAt?.toDate ? format(lead.createdAt.toDate(), 'dd MMM yy') : '—'}
                    </td>
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
    </div>
  );
}
