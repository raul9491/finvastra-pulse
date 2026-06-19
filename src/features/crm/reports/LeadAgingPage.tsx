import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, collectionGroup, getDocs, query, where } from 'firebase/firestore';
import { Download, Loader2, Clock } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { DataView } from '../../../components/ui/DataView';
import { RePie } from '../../../components/ui/charts';
import type { LeadAgingBucket } from '../../../types';

const BUCKET_META: Record<LeadAgingBucket, { label: string; color: string; range: string }> = {
  fresh:  { label: 'Fresh',  color: '#34d399', range: '0–7d' },
  active: { label: 'Active', color: '#C9A961', range: '8–30d' },
  aging:  { label: 'Aging',  color: '#fbbf24', range: '31–60d' },
  stale:  { label: 'Stale',  color: '#f87171', range: '61d+' },
};
const ORDER: LeadAgingBucket[] = ['fresh', 'active', 'aging', 'stale'];

function bucketOf(age: number): LeadAgingBucket {
  if (age <= 7) return 'fresh';
  if (age <= 30) return 'active';
  if (age <= 60) return 'aging';
  return 'stale';
}
const tsMs = (v: any): number => (v && typeof v.toMillis === 'function' ? v.toMillis() : 0);
const daysSince = (ms: number) => (ms ? Math.max(0, Math.floor((Date.now() - ms) / 86400000)) : 0);

interface Row {
  leadId: string; name: string; rmId: string; rmName: string; source: string;
  stage: string; businessLine: string; age: number; bucket: LeadAgingBucket;
  lastActivity: string; daysSinceActivity: number;
}

export function LeadAgingPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canAccess = profile?.role === 'admin' || profile?.crmRole === 'manager';

  const [rows, setRows] = useState<Row[] | null>(null);
  const [bucketFilter, setBucketFilter] = useState<LeadAgingBucket | null>(null);
  const [rmFilter, setRmFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [lineFilter, setLineFilter] = useState('');

  useEffect(() => {
    if (!canAccess) return;
    let alive = true;
    (async () => {
      const [leadsSnap, oppsSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, 'leads'), where('deleted', '==', false))),
        getDocs(collectionGroup(db, 'opportunities')),
        getDocs(collection(db, 'users')),
      ]);
      const nameByUid = new Map<string, string>();
      usersSnap.forEach((d) => nameByUid.set(d.id, (d.data() as any).displayName ?? d.id));

      // Map leadId → { stage, businessLine } (prefer an open opportunity)
      const oppByLead = new Map<string, { stage: string; line: string; open: boolean }>();
      oppsSnap.forEach((d) => {
        const o = d.data() as any;
        const leadId = d.ref.parent.parent?.id;
        if (!leadId) return;
        const existing = oppByLead.get(leadId);
        const open = o.status === 'open';
        if (!existing || (open && !existing.open)) {
          oppByLead.set(leadId, { stage: o.stage ?? '—', line: o.opportunityType ?? '—', open });
        }
      });

      const out: Row[] = leadsSnap.docs.map((d) => {
        const l = d.data() as any;
        const age = daysSince(tsMs(l.createdAt));
        const opp = oppByLead.get(d.id);
        const actMs = tsMs(l.updatedAt) || tsMs(l.createdAt);
        return {
          leadId: d.id,
          name: l.displayName ?? '—',
          rmId: l.primaryOwnerId ?? '',
          rmName: nameByUid.get(l.primaryOwnerId) ?? l.primaryOwnerId ?? 'Unassigned',
          source: l.source ?? '—',
          stage: opp?.stage ?? '—',
          businessLine: opp?.line ?? '—',
          age,
          bucket: bucketOf(age),
          lastActivity: actMs ? new Date(actMs).toISOString().slice(0, 10) : '—',
          daysSinceActivity: daysSince(actMs),
        };
      });
      if (alive) setRows(out);
    })().catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [canAccess]);

  const counts = useMemo(() => {
    const c: Record<LeadAgingBucket, number> = { fresh: 0, active: 0, aging: 0, stale: 0 };
    (rows ?? []).forEach((r) => { c[r.bucket]++; });
    return c;
  }, [rows]);

  const rmOptions = useMemo(() => {
    const seen = new Map<string, string>();
    (rows ?? []).forEach((r) => { if (r.rmId) seen.set(r.rmId, r.rmName); });
    return [{ value: '', label: 'All RMs' }, ...Array.from(seen, ([value, label]) => ({ value, label }))];
  }, [rows]);
  const stageOptions = useMemo(() => {
    const s = new Set<string>(); (rows ?? []).forEach((r) => s.add(r.stage));
    return [{ value: '', label: 'All stages' }, ...Array.from(s).filter((x) => x !== '—').map((v) => ({ value: v, label: v }))];
  }, [rows]);

  const filtered = useMemo(() => (rows ?? []).filter((r) =>
    (!bucketFilter || r.bucket === bucketFilter) &&
    (!rmFilter || r.rmId === rmFilter) &&
    (!stageFilter || r.stage === stageFilter) &&
    (!lineFilter || r.businessLine === lineFilter),
  ).sort((a, b) => b.age - a.age), [rows, bucketFilter, rmFilter, stageFilter, lineFilter]);

  const exportCsv = () => {
    const head = ['Lead', 'RM', 'Source', 'Stage', 'Business Line', 'Age (days)', 'Bucket', 'Last Activity', 'Days Since Activity'];
    const lines = filtered.map((r) => [r.name, r.rmName, r.source, r.stage, r.businessLine, r.age, BUCKET_META[r.bucket].label, r.lastActivity, r.daysSinceActivity]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([head.join(',') + '\n' + lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `lead-aging-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!canAccess) return <div className="glass-panel p-6 text-center text-sm" style={{ color: 'var(--shell-text-dim)' }}>Admin / manager access only.</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div>
        <h2 className="text-3xl mb-1 flex items-center gap-2" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          <Clock size={22} style={{ color: '#C9A961' }} /> Lead Aging
        </h2>
        <p className="text-sm" style={{ color: 'var(--shell-text-dim)' }}>How long leads have sat since creation. Click a bucket to filter.</p>
      </div>

      {/* Summary strip — cards (interactive filters) ⇄ donut */}
      <DataView headless
        graph={<RePie height={240} colors={ORDER.map((b) => BUCKET_META[b].color)} data={ORDER.map((b) => ({ name: BUCKET_META[b].label, value: counts[b] }))} />}
        table={
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {ORDER.map((b) => {
              const active = bucketFilter === b;
              return (
                <button key={b} onClick={() => setBucketFilter(active ? null : b)}
                  className="glass-panel p-4 text-left transition-all" style={{ border: `1px solid ${active ? BUCKET_META[b].color : 'var(--shell-border)'}` }}>
                  <p className="text-2xl font-bold" style={{ color: BUCKET_META[b].color }}>{counts[b]}</p>
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{BUCKET_META[b].label}</p>
                  <p className="text-[10px]" style={{ color: 'var(--shell-text-dim)' }}>{BUCKET_META[b].range}</p>
                </button>
              );
            })}
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-48"><SearchableSelect options={rmOptions} value={rmFilter} onChange={setRmFilter} placeholder="RM" /></div>
        <div className="w-48"><SearchableSelect options={stageOptions} value={stageFilter} onChange={setStageFilter} placeholder="Stage" /></div>
        <div className="w-48"><SearchableSelect options={[{ value: '', label: 'All lines' }, { value: 'loan', label: 'Loan' }, { value: 'wealth', label: 'Wealth' }, { value: 'insurance', label: 'Insurance' }]} value={lineFilter} onChange={setLineFilter} placeholder="Business line" /></div>
        <button onClick={exportCsv} className="ml-auto flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Table */}
      {rows === null ? (
        <div className="glass-panel p-8 flex justify-center"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--shell-text-dim)' }} /></div>
      ) : (
        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto" style={{ maxHeight: 560 }}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--glass-panel-bg)', borderBottom: '1px solid var(--shell-border)', position: 'sticky', top: 0 }}>
                  {['Lead', 'RM', 'Source', 'Stage', 'Age', 'Last Activity', 'Days Since', ''].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: 'var(--shell-text-dim)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.leadId} style={{ borderBottom: '1px solid var(--shell-border)' }}>
                    <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{r.name}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--shell-text-secondary)' }}>{r.rmName}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--shell-text-dim)' }}>{r.source}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--shell-text-secondary)' }}>{r.stage}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${BUCKET_META[r.bucket].color}22`, color: BUCKET_META[r.bucket].color }}>{r.age}d</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--shell-text-dim)' }}>{r.lastActivity}</td>
                    <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: r.daysSinceActivity > 3 ? '#f87171' : 'var(--shell-text-secondary)' }}>{r.daysSinceActivity}d</td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => navigate(`/crm/leads/${r.leadId}`)} className="text-xs font-semibold hover:underline" style={{ color: '#60a5fa' }}>View</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--shell-text-dim)' }}>No leads match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
