import { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  Plus, Laptop, Smartphone, CreditCard, Wifi, Package,
  Search, Edit2, UserCheck, RotateCcw,
} from 'lucide-react';
import {
  collection, onSnapshot, addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { Modal } from '../../../components/ui/Modal';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import type { Asset, AssetType, AssetStatus, AssetCondition } from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';

// ─── Constants ────────────────────────────────────────────────────────────────

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  laptop:        'Laptop',
  sim_card:      'SIM Card',
  mobile_phone:  'Mobile Phone',
  access_card:   'Access Card',
  mouse:         'Mouse',
  visiting_card: 'Visiting Card',
  id_card:       'ID Card',
  other:         'Other',
};

const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  available:    'Available',
  assigned:     'Assigned',
  under_repair: 'Under Repair',
  retired:      'Retired',
};

const CONDITION_LABELS: Record<AssetCondition, string> = {
  good:    'Good',
  fair:    'Fair',
  damaged: 'Damaged',
};

function AssetIcon({ type, size = 16 }: { type: AssetType; size?: number }) {
  switch (type) {
    case 'laptop':       return <Laptop       size={size} />;
    case 'mobile_phone': return <Smartphone   size={size} />;
    case 'sim_card':     return <Wifi         size={size} />;
    case 'access_card':  return <CreditCard   size={size} />;
    default:             return <Package      size={size} />;
  }
}

function statusStyle(s: AssetStatus): { bg: string; text: string } {
  switch (s) {
    case 'available':    return { bg: '#D1FAE5', text: '#065F46' };
    case 'assigned':     return { bg: '#DBEAFE', text: '#1E40AF' };
    case 'under_repair': return { bg: '#FEF3C7', text: '#92400E' };
    case 'retired':      return { bg: 'var(--shell-hover-hard)', text: 'var(--text-muted)' };
  }
}

function conditionStyle(c: AssetCondition): { text: string } {
  switch (c) {
    case 'good':    return { text: '#065F46' };
    case 'fair':    return { text: '#92400E' };
    case 'damaged': return { text: '#DC2626' };
  }
}

const inp = 'w-full px-3.5 py-2.5 text-sm bg-(--glass-panel-bg) border border-(--shell-border) rounded-lg outline-none focus:border-(--shell-border-mid)';
const sel = 'w-full px-3.5 py-2.5 text-sm bg-(--glass-panel-bg) border border-(--shell-border) rounded-lg outline-none';

// ─── Add/Edit Asset modal ─────────────────────────────────────────────────────

interface AssetFormValues {
  assetType: AssetType;
  assetName: string;
  serialNumber: string;
  imei: string;
  simNumber: string;
  phoneNumber: string;
  purchaseDate: string;
  purchaseValue: string;
  condition: AssetCondition;
  notes: string;
}

function defaultFormValues(): AssetFormValues {
  return {
    assetType: 'laptop', assetName: '', serialNumber: '', imei: '',
    simNumber: '', phoneNumber: '', purchaseDate: '', purchaseValue: '',
    condition: 'good', notes: '',
  };
}

function AddEditAssetModal({ asset, adminUid, onClose }: {
  asset: Asset | null;  // null = add mode
  adminUid: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState<AssetFormValues>(() =>
    asset ? {
      assetType:     asset.assetType,
      assetName:     asset.assetName,
      serialNumber:  asset.serialNumber ?? '',
      imei:          asset.imei ?? '',
      simNumber:     asset.simNumber ?? '',
      phoneNumber:   asset.phoneNumber ?? '',
      purchaseDate:  asset.purchaseDate ?? '',
      purchaseValue: asset.purchaseValue != null ? String(asset.purchaseValue) : '',
      condition:     asset.condition,
      notes:         asset.notes ?? '',
    } : defaultFormValues()
  );
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof AssetFormValues>(k: K, v: AssetFormValues[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (!form.assetName.trim()) { setError('Asset name is required.'); return; }
    setBusy(true); setError('');
    try {
      const payload: Omit<Asset, 'id' | 'addedBy' | 'addedAt' | 'updatedAt' | 'currentStatus' | 'assignedTo' | 'assignedToName' | 'assignedDate' | 'returnedDate'> = {
        assetType:     form.assetType,
        assetName:     form.assetName.trim(),
        serialNumber:  form.serialNumber.trim() || null,
        imei:          form.assetType === 'mobile_phone' ? (form.imei.trim() || null) : null,
        simNumber:     form.assetType === 'sim_card'     ? (form.simNumber.trim() || null) : null,
        phoneNumber:   form.assetType === 'sim_card'     ? (form.phoneNumber.trim() || null) : null,
        purchaseDate:  form.purchaseDate || null,
        purchaseValue: form.purchaseValue ? Number(form.purchaseValue) : null,
        condition:     form.condition,
        notes:         form.notes.trim() || null,
      };

      if (asset) {
        await updateDoc(doc(db, 'assets', asset.id), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, 'assets'), {
          ...payload,
          currentStatus: 'available' as AssetStatus,
          assignedTo:     null,
          assignedToName: null,
          assignedDate:   null,
          returnedDate:   null,
          addedBy:        adminUid,
          addedAt:        serverTimestamp(),
          updatedAt:      serverTimestamp(),
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={asset ? 'Edit Asset' : 'Add Asset'} size="sm"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-(--shell-border) rounded-xl" style={{ color: 'var(--text-primary)' }}>Cancel</button>
          <button onClick={handleSave} disabled={busy}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }>
      <div className="space-y-3.5">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Asset Type</label>
          <select value={form.assetType} onChange={(e) => set('assetType', e.target.value as AssetType)} className={sel} style={{ color: 'var(--text-primary)' }}>
            {(Object.entries(ASSET_TYPE_LABELS) as [AssetType, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Asset Name *</label>
          <input value={form.assetName} onChange={(e) => set('assetName', e.target.value)}
            placeholder="e.g. Dell Latitude 5520" className={inp} style={{ color: 'var(--text-primary)' }} />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Serial Number</label>
          <input value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} className={inp} style={{ color: 'var(--text-primary)' }} />
        </div>
        {form.assetType === 'mobile_phone' && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>IMEI</label>
            <input value={form.imei} onChange={(e) => set('imei', e.target.value)} className={inp} style={{ color: 'var(--text-primary)' }} />
          </div>
        )}
        {form.assetType === 'sim_card' && (
          <>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>SIM Number</label>
              <input value={form.simNumber} onChange={(e) => set('simNumber', e.target.value)} className={inp} style={{ color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Phone Number</label>
              <input value={form.phoneNumber} onChange={(e) => set('phoneNumber', e.target.value)} className={inp} style={{ color: 'var(--text-primary)' }} />
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Purchase Date</label>
            <input type="date" value={form.purchaseDate} onChange={(e) => set('purchaseDate', e.target.value)} className={inp} style={{ color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Purchase Value (₹)</label>
            <input type="number" value={form.purchaseValue} onChange={(e) => set('purchaseValue', e.target.value)} className={inp} style={{ color: 'var(--text-primary)' }} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Condition</label>
          <select value={form.condition} onChange={(e) => set('condition', e.target.value as AssetCondition)} className={sel} style={{ color: 'var(--text-primary)' }}>
            {(Object.entries(CONDITION_LABELS) as [AssetCondition, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Notes</label>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2}
            className="w-full px-3.5 py-2.5 text-sm bg-(--glass-panel-bg) border border-(--shell-border) rounded-lg outline-none resize-none"
            style={{ color: 'var(--text-primary)' }} />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Assign Asset modal ───────────────────────────────────────────────────────

function AssignAssetModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { employees } = useAllEmployees();
  const activeEmployees = useMemo(
    () => employees.filter((e) => (e.employeeStatus ?? 'active') === 'active'),
    [employees],
  );
  const employeeOptions = useMemo(
    () => activeEmployees.map((e) => ({
      value: e.userId,
      label: e.displayName,
      description: e.department ?? '',
    })),
    [activeEmployees],
  );

  const [assignedTo,   setAssignedTo]   = useState('');
  const [assignDate,   setAssignDate]   = useState(format(new Date(), 'yyyy-MM-dd'));
  const [condition,    setCondition]    = useState<AssetCondition>(asset.condition);
  const [notes,        setNotes]        = useState('');
  const [busy,         setBusy]         = useState(false);
  const [error,        setError]        = useState('');

  const handleAssign = async () => {
    if (!assignedTo) { setError('Select an employee.'); return; }
    setBusy(true); setError('');
    try {
      const emp = activeEmployees.find((e) => e.userId === assignedTo);
      await updateDoc(doc(db, 'assets', asset.id), {
        currentStatus:  'assigned' as AssetStatus,
        assignedTo,
        assignedToName: emp?.displayName ?? '',
        assignedDate:   assignDate,
        condition,
        notes:          notes.trim() || asset.notes,
        updatedAt:      serverTimestamp(),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assignment failed');
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Assign: ${asset.assetName}`} size="sm"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-(--shell-border) rounded-xl" style={{ color: 'var(--text-primary)' }}>Cancel</button>
          <button onClick={handleAssign} disabled={busy || !assignedTo}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {busy ? 'Assigning…' : 'Assign'}
          </button>
        </>
      }>
      <div className="space-y-3.5">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Employee *</label>
          <SearchableSelect
            options={employeeOptions}
            value={assignedTo}
            onChange={setAssignedTo}
            placeholder="Search employee…"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Assignment Date</label>
          <input type="date" value={assignDate} onChange={(e) => setAssignDate(e.target.value)} className={inp} style={{ color: 'var(--text-primary)' }} />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Condition at Assignment</label>
          <select value={condition} onChange={(e) => setCondition(e.target.value as AssetCondition)} className={sel} style={{ color: 'var(--text-primary)' }}>
            {(Object.entries(CONDITION_LABELS) as [AssetCondition, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full px-3.5 py-2.5 text-sm bg-(--glass-panel-bg) border border-(--shell-border) rounded-lg outline-none resize-none"
            style={{ color: 'var(--text-primary)' }} />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Return Asset modal ───────────────────────────────────────────────────────

function ReturnAssetModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [returnDate, setReturnDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [condition,  setCondition]  = useState<AssetCondition>(asset.condition);
  const [notes,      setNotes]      = useState('');
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState('');

  const handleReturn = async () => {
    setBusy(true); setError('');
    try {
      await updateDoc(doc(db, 'assets', asset.id), {
        currentStatus:  'available' as AssetStatus,
        assignedTo:     null,
        assignedToName: null,
        assignedDate:   null,
        returnedDate:   returnDate,
        condition,
        notes:          notes.trim() || asset.notes,
        updatedAt:      serverTimestamp(),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Return failed');
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Return: ${asset.assetName}`} size="sm"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-(--shell-border) rounded-xl" style={{ color: 'var(--text-primary)' }}>Cancel</button>
          <button onClick={handleReturn} disabled={busy}
            className="px-7 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            {busy ? 'Processing…' : 'Confirm Return'}
          </button>
        </>
      }>
      <div className="space-y-3.5">
        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
          Returning from <strong>{asset.assignedToName}</strong>.
        </p>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Return Date</label>
          <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className={inp} style={{ color: 'var(--text-primary)' }} />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Condition on Return</label>
          <select value={condition} onChange={(e) => setCondition(e.target.value as AssetCondition)} className={sel} style={{ color: 'var(--text-primary)' }}>
            {(Object.entries(CONDITION_LABELS) as [AssetCondition, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Notes / Damage Report</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full px-3.5 py-2.5 text-sm bg-(--glass-panel-bg) border border-(--shell-border) rounded-lg outline-none resize-none"
            style={{ color: 'var(--text-primary)' }} />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AssetsPage() {
  const { user, profile } = useAuth();

  // ── All hooks unconditionally at top ────────────────────────────────────────
  const [assets,       setAssets]       = useState<Asset[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [typeFilter,   setTypeFilter]   = useState<AssetType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AssetStatus | 'all'>('all');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [addEditAsset, setAddEditAsset] = useState<Asset | null | 'new'>(null);
  const [assignAsset,  setAssignAsset]  = useState<Asset | null>(null);
  const [returnAsset,  setReturnAsset]  = useState<Asset | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'assets'), (snap) => {
      setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Asset));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  // ── Guard ────────────────────────────────────────────────────────────────────
  if (profile && profile.role !== 'admin' && !profile.isHrmsManager) {
    return <Navigate to="/hrms/dashboard" replace />;
  }

  const filtered = useMemo(() => assets.filter((a) => {
    if (typeFilter !== 'all'   && a.assetType !== typeFilter)       return false;
    if (statusFilter !== 'all' && a.currentStatus !== statusFilter) return false;
    if (assigneeFilter && a.assignedToName && !a.assignedToName.toLowerCase().includes(assigneeFilter.toLowerCase())) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        a.assetName.toLowerCase().includes(q) ||
        (a.serialNumber ?? '').toLowerCase().includes(q) ||
        (a.imei ?? '').toLowerCase().includes(q) ||
        (a.assignedToName ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  }), [assets, typeFilter, statusFilter, assigneeFilter, search]);

  const counts = useMemo(() => ({
    total:       assets.length,
    assigned:    assets.filter((a) => a.currentStatus === 'assigned').length,
    available:   assets.filter((a) => a.currentStatus === 'available').length,
    under_repair:assets.filter((a) => a.currentStatus === 'under_repair').length,
  }), [assets]);

  const adminUid = user?.uid ?? '';
  const thCls = 'px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-left whitespace-nowrap';

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <PageHeader
        title="Asset Inventory"
        subtitle="Track company assets — laptops, SIM cards, phones, and access cards"
        pinKey="hrms.assets"
        actions={
          <button
            onClick={() => setAddEditAsset('new')}
            className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl"
            style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
          >
            <Plus size={15} />
            Add Asset
          </button>
        }
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total',        value: counts.total,        color: 'var(--text-primary)' },
          { label: 'Assigned',     value: counts.assigned,     color: '#1E40AF' },
          { label: 'Available',    value: counts.available,    color: '#065F46' },
          { label: 'Under Repair', value: counts.under_repair, color: '#92400E' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-4">
            <p className="text-2xl font-bold" style={{ color }}>{value}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-muted)" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, serial, assignee…"
            className="text-sm border border-(--shell-border) rounded-lg pl-9 pr-4 py-2 bg-(--glass-panel-bg) focus:outline-none w-56"
            style={{ color: 'var(--text-primary)' }} />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as AssetType | 'all')}
          className="text-sm border border-(--shell-border) rounded-lg px-3 py-2 bg-(--glass-panel-bg) outline-none" style={{ color: 'var(--text-primary)' }}>
          <option value="all">All Types</option>
          {(Object.entries(ASSET_TYPE_LABELS) as [AssetType, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as AssetStatus | 'all')}
          className="text-sm border border-(--shell-border) rounded-lg px-3 py-2 bg-(--glass-panel-bg) outline-none" style={{ color: 'var(--text-primary)' }}>
          <option value="all">All Statuses</option>
          {(Object.entries(ASSET_STATUS_LABELS) as [AssetStatus, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="animate-pulse space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-(--glass-panel-bg) rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-(--shell-border) bg-(--glass-panel-bg)">
          <Package size={32} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>No assets found</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Add your first asset with the button above.</p>
        </div>
      ) : (
        <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--glass-panel-bg)', borderBottom: '1px solid var(--shell-border)' }}>
                  <th className={thCls} style={{ color: 'var(--text-muted)' }}>Asset</th>
                  <th className={thCls} style={{ color: 'var(--text-muted)' }}>Type</th>
                  <th className={thCls} style={{ color: 'var(--text-muted)' }}>Serial / IMEI</th>
                  <th className={thCls} style={{ color: 'var(--text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--text-muted)' }}>Assigned To</th>
                  <th className={thCls} style={{ color: 'var(--text-muted)' }}>Condition</th>
                  <th className={thCls} style={{ color: 'var(--text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((asset, idx) => {
                  const sStyle = statusStyle(asset.currentStatus);
                  const cStyle = conditionStyle(asset.condition);
                  return (
                    <tr key={asset.id} style={{ borderBottom: idx < filtered.length - 1 ? '1px solid var(--shell-border)' : 'none' }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span style={{ color: 'var(--text-primary)' }}>
                            <AssetIcon type={asset.assetType} size={15} />
                          </span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{asset.assetName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                        {ASSET_TYPE_LABELS[asset.assetType]}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                        {asset.imei ?? asset.simNumber ?? asset.serialNumber ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
                          style={{ backgroundColor: sStyle.bg, color: sStyle.text }}>
                          {ASSET_STATUS_LABELS[asset.currentStatus]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>
                        {asset.assignedToName ?? '—'}
                        {asset.assignedDate && (
                          <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>since {asset.assignedDate}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium" style={{ color: cStyle.text }}>
                        {CONDITION_LABELS[asset.condition]}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {asset.currentStatus === 'available' && (
                            <button onClick={() => setAssignAsset(asset)}
                              className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg transition-colors hover:opacity-80"
                              style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}>
                              <UserCheck size={11} /> Assign
                            </button>
                          )}
                          {asset.currentStatus === 'assigned' && (
                            <button onClick={() => setReturnAsset(asset)}
                              className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg transition-colors hover:opacity-80"
                              style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                              <RotateCcw size={11} /> Return
                            </button>
                          )}
                          <button onClick={() => setAddEditAsset(asset)}
                            className="p-1.5 text-(--text-muted) hover:text-(--text-primary) transition-colors">
                            <Edit2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {addEditAsset !== null && (
        <AddEditAssetModal
          asset={addEditAsset === 'new' ? null : addEditAsset}
          adminUid={adminUid}
          onClose={() => setAddEditAsset(null)}
        />
      )}
      {assignAsset && <AssignAssetModal asset={assignAsset} onClose={() => setAssignAsset(null)} />}
      {returnAsset  && <ReturnAssetModal asset={returnAsset}  onClose={() => setReturnAsset(null)} />}
    </div>
  );
}
