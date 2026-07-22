/**
 * The Connectors (CON-###) master list tab - search, tier/funnel filters, the
 * follow-up column, and the row actions (activate/deactivate, return-to-lead,
 * graduate-to-Sub-DSA). Opens ConnectorFormModal for create/edit.
 * 
 * Extracted verbatim from MastersPage.tsx (2026-07-22) - no behaviour change.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { apiCrm2 } from '../lib';
import { useConnectors, nextConnectorCode, setConnectorStatus } from '../../hrms/hooks/useConnectors';
import { ConnectorFormModal } from './ConnectorFormModal';
import { TierBadge, TIER_STYLE, funnelColor, PARTNER_FUNNEL_OPTS } from './partnerOptions';
import type { Connector } from '../../../types';

export function ConnectorsMasterTab() {
  const { connectors, loading } = useConnectors();
  const toast = useToast();
  const [filter, setFilter] = useState<'active' | 'inactive' | 'all'>('all');
  const [tierFilter, setTierFilter] = useState<'all' | 'Hot' | 'Warm' | 'Cold'>('all');
  const [funnelFilter, setFunnelFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ initial: Connector | null } | null>(null);

  const autoCode = nextConnectorCode(connectors);
  const activeN = connectors.filter((c) => c.status === 'active').length;
  const inactiveN = connectors.filter((c) => c.status === 'inactive').length;
  const filtered = connectors.filter((c) =>
    (filter === 'all' || c.status === filter) &&
    (tierFilter === 'all' || c.partnerScoring?.tier === tierFilter) &&
    (!funnelFilter || c.funnelStatus === funnelFilter) &&
    (!search || c.displayName.toLowerCase().includes(search.toLowerCase()) || c.connectorCode.toLowerCase().includes(search.toLowerCase())));

  const toggleStatus = async (c: Connector) => {
    const next = c.status === 'active' ? 'inactive' : 'active';
    try { await setConnectorStatus(c.id, next); toast.success(next === 'active' ? 'Activated' : 'Deactivated'); }
    catch { toast.error('Could not update status'); }
  };

  // Undo a premature move: the candidate goes back to the Leads page for normal
  // screening and this CON- code is freed for the next qualified partner.
  const [returning, setReturning] = useState<string | null>(null);
  // Connector → Sub DSA graduation: they've proven they can work cases alone.
  // Mints the SDSA record (details/KYC/bank/TDS carried), retires this one.
  const [graduating, setGraduating] = useState<string | null>(null);
  const graduate = async (c: Connector) => {
    if (!window.confirm(`Graduate ${c.displayName} to Sub DSA? They'll get an SDSA- record (higher share tier — set their payout slabs on the DSA Codes / disburse side) with details, KYC, bank and TDS carried over. This Connector record is retired; past connector payouts stay on the ledger.`)) return;
    setGraduating(c.id);
    try {
      const r = await apiCrm2<{ ok: boolean; subDsaId: string }>('POST', `/api/crm2/connectors/${c.id}/graduate-to-subdsa`, {});
      toast.success(`${c.displayName} graduated → ${r.subDsaId} (see the Sub DSAs tab)`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not graduate'); }
    finally { setGraduating(null); }
  };

  const returnToLeads = async (c: Connector) => {
    if (!window.confirm(`Return ${c.displayName} to the Leads page? Their record here is removed and code ${c.connectorCode} is freed. Their screening answers on this card are discarded; the lead keeps its own history.`)) return;
    setReturning(c.id);
    try {
      const r = await apiCrm2<{ ok: boolean; leadId: string; freedCode: string }>('POST', `/api/crm2/connectors/${c.id}/return-to-lead`, {});
      toast.success(`${c.displayName} is back in Leads (${r.leadId}) — code ${r.freedCode} freed`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not return to Leads'); }
    finally { setReturning(null); }
  };

  // Legacy codes were FAC-/CONN-### — offer a one-time rename to CON-###.
  const [migBusy, setMigBusy] = useState(false);
  const legacyCount = connectors.filter((c) => /^(?:FAC|CONN)-/.test(c.connectorCode ?? '')).length;
  const renameCodes = async () => {
    setMigBusy(true);
    try {
      const r = await apiCrm2<{ ok: boolean; migrated: unknown[] }>('POST', '/api/crm2/admin/migrate-connector-codes', {});
      toast.success(`Renamed ${r.migrated.length} connector code(s) to CON-`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Rename failed'); }
    finally { setMigBusy(false); }
  };

  const FILTERS: Array<{ key: typeof filter; label: string }> = [
    { key: 'active', label: `Active (${activeN})` },
    { key: 'inactive', label: `Inactive (${inactiveN})` },
    { key: 'all', label: `All (${connectors.length})` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={filter === f.key
                ? { backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' }
                : { color: 'var(--text-muted)', border: '1px solid var(--shell-border)' }}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <input className="glass-inp text-sm w-56" placeholder="Search connectors…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <button onClick={() => setModal({ initial: null })}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            <Plus size={15} /> Add Partner
          </button>
        </div>
      </div>

      {/* Tier + funnel-stage filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'Hot', 'Warm', 'Cold'] as const).map((t) => (
          <button key={t} onClick={() => setTierFilter(t)}
            className="px-3 py-1 rounded-lg text-xs font-semibold transition-colors"
            style={tierFilter === t
              ? (t === 'all' ? { backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' } : { backgroundColor: (TIER_STYLE[t]?.bg), color: TIER_STYLE[t]?.color, border: `1px solid ${TIER_STYLE[t]?.color}55` })
              : { color: 'var(--text-muted)', border: '1px solid var(--shell-border)' }}>
            {t === 'all' ? 'All tiers' : t}
          </button>
        ))}
        <span className="w-48"><SearchableSelect options={[{ value: '', label: 'All stages' }, ...PARTNER_FUNNEL_OPTS]} value={funnelFilter} onChange={setFunnelFilter} placeholder="All stages" /></span>
      </div>

      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        The flow: partner inquiries land on the <strong>Leads</strong> page (category “Partner Sign-up”) and are screened there like any contact.
        Only a QUALIFIED one is moved here — that mints the next code (<span className="font-mono font-semibold" style={{ color: '#C9A961' }}>{autoCode}</span>) and starts assessment + onboarding.
        A candidate becomes pickable by RMs only once its stage is <strong>Active</strong>. Moved someone too early? “↩ Return to Leads” frees the code.
      </p>

      {legacyCount > 0 && (
        <div className="rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3"
          style={{ backgroundColor: 'rgba(201,169,97,0.10)', border: '1px solid rgba(201,169,97,0.3)' }}>
          <span className="text-sm" style={{ color: '#C9A961' }}>
            {legacyCount} connector{legacyCount > 1 ? 's' : ''} still use an old <strong>FAC-/CONN-</strong> code. Rename to <strong>CON-</strong>?
          </span>
          <button onClick={renameCodes} disabled={migBusy}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
            style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            {migBusy ? 'Renaming…' : 'Rename to CON-'}
          </button>
        </div>
      )}

      <div className="glass-panel p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                <th className="text-left font-semibold px-4 py-2.5">Code</th>
                <th className="text-left font-semibold px-3 py-2.5">Name</th>
                <th className="text-left font-semibold px-3 py-2.5">Tier</th>
                <th className="text-left font-semibold px-3 py-2.5">Stage</th>
                <th className="text-left font-semibold px-3 py-2.5">Mobile</th>
                <th className="text-left font-semibold px-3 py-2.5">Follow-up</th>
                <th className="text-left font-semibold px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                  No connectors {filter !== 'all' ? `(${filter})` : ''} yet — add the first one.
                </td></tr>
              ) : filtered.map((c) => (
                <tr key={c.id} onClick={() => setModal({ initial: c })}
                  className="cursor-pointer hover:bg-(--shell-hover-soft) transition-colors"
                  style={{ borderTop: '1px solid var(--shell-border)', opacity: c.status === 'active' ? 1 : 0.55 }}>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold" style={{ color: '#C9A961' }}>{c.connectorCode}</td>
                  <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>
                    {c.displayName}{c.firmName ? <span className="text-xs" style={{ color: 'var(--text-muted)' }}> · {c.firmName}</span> : null}
                  </td>
                  <td className="px-3 py-2.5"><TierBadge tier={c.partnerScoring?.tier} /></td>
                  <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: c.graduatedToSubDsaId ? '#8B5CF6' : funnelColor(c.funnelStatus) }}>
                    {c.graduatedToSubDsaId ? `Graduated → ${c.graduatedToSubDsaId}` : (c.funnelStatus ?? '—')}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{c.mobile}{c.mobiles && c.mobiles.length > 1 ? <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}> +{c.mobiles.length - 1}</span> : null}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {(() => {
                      const d = c.nextFollowUpAt?.toDate?.();
                      if (!d) return <span style={{ color: 'var(--text-dim)' }}>—</span>;
                      const over = d.getTime() <= Date.now();
                      return <span className="font-semibold" style={{ color: over ? '#f87171' : '#C9A961' }}
                        title={c.nextFollowUpNote ?? undefined}>
                        {over ? 'DUE · ' : ''}{d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}
                      </span>;
                    })()}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={c.status === 'active' ? 'badge-glass-success' : 'badge-glass-muted'}>{c.status === 'active' ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {!c.graduatedToSubDsaId && c.status === 'active' && (
                      <button onClick={(e) => { e.stopPropagation(); graduate(c); }}
                        disabled={graduating === c.id}
                        className="text-xs font-semibold mr-3 transition-opacity hover:opacity-80 disabled:opacity-50"
                        style={{ color: '#8B5CF6' }}
                        title="They now work cases independently — promote to the Sub DSA tier (higher share).">
                        {graduating === c.id ? 'Graduating…' : '↗ Graduate to Sub DSA'}
                      </button>
                    )}
                    {c.funnelStatus && c.funnelStatus !== 'Active' && !c.graduatedToSubDsaId && (
                      <button onClick={(e) => { e.stopPropagation(); returnToLeads(c); }}
                        disabled={returning === c.id}
                        className="text-xs font-semibold mr-3 transition-opacity hover:opacity-80 disabled:opacity-50"
                        style={{ color: 'var(--text-muted)' }}
                        title="Not ready for the funnel? Send them back to the Leads page and free this CON- code.">
                        {returning === c.id ? 'Returning…' : '↩ Return to Leads'}
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); toggleStatus(c); }}
                      className="text-xs font-semibold transition-opacity hover:opacity-80"
                      style={{ color: c.status === 'active' ? '#f87171' : '#34d399' }}>
                      {c.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <ConnectorFormModal
          initial={modal.initial}
          autoCode={autoCode}
          onClose={() => setModal(null)}
          onSaved={(msg) => toast.success(msg)}
        />
      )}
    </div>
  );
}
