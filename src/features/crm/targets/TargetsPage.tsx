import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection, collectionGroup, doc, getDoc, getDocs, query, where,
} from 'firebase/firestore';
import { Target, Loader2, Pencil, FileText } from 'lucide-react';
import { db, auth } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { DataView } from '../../../components/ui/DataView';
import { ReBar } from '../../../components/ui/charts';
import {
  useMyTargets, useTeamTargets, setTarget, achievementPct,
  type TeamTargetRow,
} from '../hooks/useRmTargets';
import type { RmTarget, RmActuals } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function daysLeftInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number);
  const cur = currentPeriod();
  const lastDay = new Date(y, m, 0).getDate();
  if (period === cur) return lastDay - new Date().getDate();
  return period < cur ? 0 : lastDay;
}

const fmtINR = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const fmtVal = (kind: 'count' | 'money', n: number) => (kind === 'money' ? fmtINR(n) : String(n));

const METRICS = [
  { key: 'newLeads',            label: 'New Leads',   kind: 'count' as const },
  { key: 'leadsConverted',      label: 'Conversions', kind: 'count' as const },
  { key: 'disbursalAmount',     label: 'Disbursals',  kind: 'money' as const },
  { key: 'commissionGenerated', label: 'Commission',  kind: 'money' as const },
] as const;

type MetricKey = typeof METRICS[number]['key'];

async function apiPost(path: string) {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${token ?? ''}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// ─── Progress card (individual view) ──────────────────────────────────────────

function ProgressCard({ label, kind, actual, target, daysLeft }: {
  label: string; kind: 'count' | 'money'; actual: number; target: number; daysLeft: number;
}) {
  const pct = achievementPct(actual, target);
  const done = pct >= 100;
  const danger = pct < 50 && daysLeft < 15;
  const barColor = done ? '#34d399' : danger ? '#f87171' : '#C9A961';

  return (
    <div className="glass-panel p-5">
      <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--shell-text-dim)' }}>{label}</p>
      <div className="flex items-end justify-between mb-2">
        <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtVal(kind, actual)}</span>
        <span className="text-xs" style={{ color: 'var(--shell-text-dim)' }}>of {target > 0 ? fmtVal(kind, target) : '—'}</span>
      </div>
      <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
      <p className="text-xs mt-1.5 font-semibold" style={{ color: barColor }}>{pct}% achieved</p>
    </div>
  );
}

// ─── Set Target modal (admin / manager) ───────────────────────────────────────

function SetTargetModal({ uid, rmName, period, current, setBy, onClose }: {
  uid: string; rmName: string; period: string; current: RmTarget | null; setBy: string; onClose: () => void;
}) {
  const [form, setForm] = useState({
    newLeads:            String(current?.targets.newLeads ?? ''),
    leadsConverted:      String(current?.targets.leadsConverted ?? ''),
    disbursalAmount:     String(current?.targets.disbursalAmount ?? ''),
    commissionGenerated: String(current?.targets.commissionGenerated ?? ''),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setSaving(true); setErr('');
    try {
      await setTarget(uid, period, {
        newLeads: Number(form.newLeads) || 0,
        leadsConverted: Number(form.leadsConverted) || 0,
        disbursalAmount: Number(form.disbursalAmount) || 0,
        commissionGenerated: Number(form.commissionGenerated) || 0,
      }, { rmName, setBy });
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed.'); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="glass-modal-panel p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Set targets — {rmName}</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--shell-text-dim)' }}>Period {period}</p>
        <div className="space-y-3">
          {METRICS.map((m) => (
            <div key={m.key}>
              <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--shell-text-dim)' }}>
                {m.label}{m.kind === 'money' ? ' (₹)' : ''}
              </label>
              <input type="number" min={0} className="glass-inp w-full text-sm"
                value={form[m.key]} onChange={(e) => setForm((p) => ({ ...p, [m.key]: e.target.value }))} />
            </div>
          ))}
        </div>
        {err && <p className="text-sm mt-3" style={{ color: '#f87171' }}>{err}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--shell-border)', color: 'var(--text-primary)' }}>Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-2" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            {saving && <Loader2 size={14} className="animate-spin" />}Save targets
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pipeline mini-table (individual view) ────────────────────────────────────

interface PipeRow { leadId: string; name: string; stage: string; dealSize: number; daysInStage: number; }

function PipelineMiniTable({ uid }: { uid: string }) {
  const [rows, setRows] = useState<PipeRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const snap = await getDocs(query(collectionGroup(db, 'opportunities'), where('status', '==', 'open')));
      const mine = snap.docs.filter((d) => (d.data() as any).ownerId === uid).slice(0, 50);
      const out: PipeRow[] = [];
      for (const d of mine) {
        const o = d.data() as any;
        const leadRef = d.ref.parent.parent;
        let name = 'Lead';
        if (leadRef) { try { const ls = await getDoc(leadRef); name = (ls.data() as any)?.displayName ?? 'Lead'; } catch { /* ignore */ } }
        const ts = o.updatedAt?.toMillis?.() ?? o.createdAt?.toMillis?.() ?? Date.now();
        out.push({
          leadId: leadRef?.id ?? d.id,
          name,
          stage: o.stage ?? '—',
          dealSize: Number(o.dealSize ?? 0),
          daysInStage: Math.max(0, Math.floor((Date.now() - ts) / 86400000)),
        });
      }
      out.sort((a, b) => b.dealSize - a.dealSize);
      if (alive) setRows(out.slice(0, 10));
    })().catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [uid]);

  if (rows === null) return <div className="glass-panel p-6"><Loader2 size={16} className="animate-spin" style={{ color: 'var(--shell-text-dim)' }} /></div>;
  if (rows.length === 0) return null;

  return (
    <div className="glass-panel p-5">
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>My Pipeline this month</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--shell-border)' }}>
              {['Lead', 'Stage', 'Deal size', 'Days in stage'].map((h) => (
                <th key={h} className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.leadId} style={{ borderBottom: '1px solid var(--shell-border)' }}>
                <td className="px-2 py-2" style={{ color: 'var(--text-primary)' }}>{r.name}</td>
                <td className="px-2 py-2" style={{ color: 'var(--shell-text-secondary)' }}>{r.stage}</td>
                <td className="px-2 py-2 font-semibold" style={{ color: '#C9A961' }}>{fmtINR(r.dealSize)}</td>
                <td className="px-2 py-2" style={{ color: r.daysInStage > 7 ? '#f87171' : 'var(--shell-text-secondary)' }}>{r.daysInStage}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Team view ────────────────────────────────────────────────────────────────

function TeamCell({ actual, target, kind, past20 }: { actual: number; target: number; kind: 'count' | 'money'; past20: boolean }) {
  const pct = achievementPct(actual, target);
  const color = pct >= 100 ? '#34d399' : pct >= 75 ? '#fbbf24' : past20 ? '#f87171' : 'var(--shell-text-dim)';
  return (
    <td className="px-3 py-2.5">
      <div className="text-sm font-semibold" style={{ color }}>{fmtVal(kind, actual)}<span className="font-normal" style={{ color: 'var(--shell-text-dim)' }}> / {target > 0 ? fmtVal(kind, target) : '—'}</span></div>
      <div className="w-full h-1 rounded-full overflow-hidden mt-1" style={{ backgroundColor: 'var(--shell-hover-hard)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </td>
  );
}

function TeamView({ period, isAdmin, setBy, onEdit }: {
  period: string; isAdmin: boolean; setBy: string; onEdit: (row: TeamTargetRow) => void;
}) {
  const { rows, loading } = useTeamTargets(period, true);
  const cur = currentPeriod();
  const past20 = period < cur || (period === cur && new Date().getDate() > 20);

  if (loading) return <div className="glass-panel p-8 flex justify-center"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--shell-text-dim)' }} /></div>;

  const totals: RmActuals = rows.reduce((a, r) => ({
    newLeads: a.newLeads + r.actuals.newLeads,
    leadsConverted: a.leadsConverted + r.actuals.leadsConverted,
    disbursalAmount: a.disbursalAmount + r.actuals.disbursalAmount,
    commissionGenerated: a.commissionGenerated + r.actuals.commissionGenerated,
  }), { newLeads: 0, leadsConverted: 0, disbursalAmount: 0, commissionGenerated: 0 });

  const totalTarget = rows.reduce((a, r) => ({
    newLeads: a.newLeads + (r.target?.targets.newLeads ?? 0),
    leadsConverted: a.leadsConverted + (r.target?.targets.leadsConverted ?? 0),
    disbursalAmount: a.disbursalAmount + (r.target?.targets.disbursalAmount ?? 0),
    commissionGenerated: a.commissionGenerated + (r.target?.targets.commissionGenerated ?? 0),
  }), { newLeads: 0, leadsConverted: 0, disbursalAmount: 0, commissionGenerated: 0 });

  const teamDisbursalPct = achievementPct(totals.disbursalAmount, totalTarget.disbursalAmount);

  const generateScorecard = async (uid: string) => {
    try { const d = await apiPost(`/api/admin/generate-scorecard/${uid}/${period}`); if (d.storageUrl) window.open(d.storageUrl, '_blank'); }
    catch (e) { alert(e instanceof Error ? e.message : 'Scorecard failed.'); }
  };

  return (
    <div className="glass-panel p-5">
      <p className="text-sm mb-4" style={{ color: 'var(--text-primary)' }}>
        Team is at <strong style={{ color: teamDisbursalPct >= 75 ? '#34d399' : '#C9A961' }}>{teamDisbursalPct}%</strong> of the monthly disbursal target.
      </p>
      <DataView headless
        graph={<ReBar
          data={rows.map((r) => ({ name: r.rmName, Disbursed: r.actuals.disbursalAmount, Target: r.target?.targets.disbursalAmount ?? 0 }))}
          xKey="name" money legend horizontal
          series={[{ key: 'Disbursed', name: 'Disbursed', color: '#C9A961' }, { key: 'Target', name: 'Target', color: '#5B9BD5' }]}
          height={Math.max(220, rows.length * 44 + 24)}
        />}
        table={
        <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--shell-border)' }}>
              {['RM', 'New Leads', 'Conversions', 'Disbursals', 'Commission', ''].map((h) => (
                <th key={h} className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--shell-text-dim)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rmId} style={{ borderBottom: '1px solid var(--shell-border)' }}>
                <td className="px-3 py-2.5 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{r.rmName}</td>
                <TeamCell actual={r.actuals.newLeads} target={r.target?.targets.newLeads ?? 0} kind="count" past20={past20} />
                <TeamCell actual={r.actuals.leadsConverted} target={r.target?.targets.leadsConverted ?? 0} kind="count" past20={past20} />
                <TeamCell actual={r.actuals.disbursalAmount} target={r.target?.targets.disbursalAmount ?? 0} kind="money" past20={past20} />
                <TeamCell actual={r.actuals.commissionGenerated} target={r.target?.targets.commissionGenerated ?? 0} kind="money" past20={past20} />
                <td className="px-3 py-2.5">
                  <div className="flex gap-2">
                    <button onClick={() => onEdit(r)} title="Set target" className="p-1.5 rounded-lg hover:bg-(--shell-hover-mid)" style={{ color: 'var(--shell-text-secondary)' }}><Pencil size={14} /></button>
                    {isAdmin && <button onClick={() => generateScorecard(r.rmId)} title="Generate scorecard" className="p-1.5 rounded-lg hover:bg-(--shell-hover-mid)" style={{ color: '#C9A961' }}><FileText size={14} /></button>}
                  </div>
                </td>
              </tr>
            ))}
            {/* Totals */}
            <tr style={{ borderTop: '2px solid var(--shell-border)' }}>
              <td className="px-3 py-2.5 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Team total</td>
              <TeamCell actual={totals.newLeads} target={totalTarget.newLeads} kind="count" past20={past20} />
              <TeamCell actual={totals.leadsConverted} target={totalTarget.leadsConverted} kind="count" past20={past20} />
              <TeamCell actual={totals.disbursalAmount} target={totalTarget.disbursalAmount} kind="money" past20={past20} />
              <TeamCell actual={totals.commissionGenerated} target={totalTarget.commissionGenerated} kind="money" past20={past20} />
              <td />
            </tr>
          </tbody>
        </table>
        </div>
        }
      />
      <span className="sr-only">{setBy}</span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function TargetsPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === 'admin';
  const isManager = profile?.crmRole === 'manager';
  const canManage = isAdmin || isManager;

  const [period, setPeriod] = useState(currentPeriod());
  const [view, setView] = useState<'mine' | 'team'>('mine');
  const [editing, setEditing] = useState<{ uid: string; rmName: string; current: RmTarget | null } | null>(null);

  const { target, actuals, loading } = useMyTargets(user?.uid, period);
  const daysLeft = daysLeftInMonth(period);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl mb-1 flex items-center gap-2" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            <Target size={24} style={{ color: '#C9A961' }} /> Targets
          </h2>
          <p className="text-sm" style={{ color: 'var(--shell-text-dim)' }}>Monthly performance against target.</p>
        </div>
        <div className="flex items-center gap-3">
          {canManage && (
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--shell-border)' }}>
              {(['mine', 'team'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className="px-3 py-1.5 text-xs font-semibold"
                  style={{ backgroundColor: view === v ? '#C9A961' : 'transparent', color: view === v ? '#0B1538' : 'var(--shell-text-secondary)' }}>
                  {v === 'mine' ? 'My Targets' : 'Team Targets'}
                </button>
              ))}
            </div>
          )}
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value || currentPeriod())} className="glass-inp text-sm" />
        </div>
      </div>

      {view === 'mine' ? (
        <>
          {canManage && (
            <div className="flex justify-end">
              <button onClick={() => setEditing({ uid: user!.uid, rmName: profile?.displayName ?? 'Me', current: target })}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border" style={{ borderColor: 'rgba(201,169,97,0.3)', color: '#C9A961' }}>
                <Pencil size={13} /> {target ? 'Edit my target' : 'Set my target'}
              </button>
            </div>
          )}
          {!target && !loading && (
            <div className="glass-panel p-4 text-sm" style={{ backgroundColor: 'rgba(251,191,36,0.08)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.20)' }}>
              No target set for {period}. {canManage ? 'Set one above.' : 'Ask your manager to set your monthly target.'}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {METRICS.map((m) => (
              <ProgressCard key={m.key} label={m.label} kind={m.kind}
                actual={actuals ? (actuals[m.key as MetricKey] as number) : 0}
                target={target ? (target.targets[m.key as MetricKey] as number) : 0}
                daysLeft={daysLeft} />
            ))}
          </div>
          {user?.uid && <PipelineMiniTable uid={user.uid} />}
        </>
      ) : (
        <TeamView period={period} isAdmin={isAdmin} setBy={user?.uid ?? ''}
          onEdit={(row) => setEditing({ uid: row.rmId, rmName: row.rmName, current: row.target })} />
      )}

      {editing && (
        <SetTargetModal uid={editing.uid} rmName={editing.rmName} period={period} current={editing.current}
          setBy={user?.uid ?? ''} onClose={() => setEditing(null)} />
      )}

      <button onClick={() => navigate('/crm/my-queue')} className="text-sm hover:underline" style={{ color: 'var(--shell-text-secondary)' }}>← Back to My Queue</button>
    </div>
  );
}
