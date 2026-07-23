/**
 * The lead detail drawer, plus the release-to-queue control and the
 * move-to-partner-funnel row.
 * 
 * PromotePartnerRow renders ONLY for category PARTNER_DSA — the server enforces
 * the same rule (400 otherwise), so a mis-categorised lead must be recategorised
 * first via the drawer's Category picker.
 * 
 * Extracted verbatim from Crm2LeadsPage.tsx (2026-07-23).
 */
import type { Crm2LeadStatus, Client } from '../../../types/crm2';
import {
  type Opt, type ProductOpt, type RefData, type LeadRow,
  CATEGORY_OPTS, PRIORITY_OPTS, PRIORITY_META, buildReferral, buildChannelPartner,
} from './leadOptions';
import { ArrowRight, Copy } from 'lucide-react';
import { ContactActions } from '../../crm/components/ContactActions';
import { useQueueActions } from '../queue/useQueue';
import { sourceLabel } from '../labels';
import { STATUS_META, fmtTsFull } from './Crm2LeadsPage';
import { ConvertModal } from './ConvertModal';
import { useState } from 'react';
import { X } from 'lucide-react';
import { apiCrm2 } from '../lib';
import { FLabel, inp } from '../formPrimitives';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useToast } from '../../../components/ui/Toast';

// ─── Detail drawer (activity log + actions + convert) ───────────────────────
/** Release a claimed lead back to the FIFO queue (preserves its place; bumps releaseCount). */
export function ReleaseControl({ leadId, onReleased }: { leadId: string; onReleased: () => void }) {
  const { release } = useQueueActions();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try {
      const r = await release(leadId, reason.trim());
      onReleased();
      if (r.flagged) toast.error(`Released ${r.releaseCount}× — flagged for a manager`);
      setOpen(false); setReason('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Release failed');
    } finally { setBusy(false); }
  };
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        title="Return this lead to the shared queue so another agent can pick it up"
        className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border"
        style={{ borderColor: 'rgba(248,113,113,0.5)', color: '#f87171' }}>
        ↩ Release to queue
      </button>
    );
  }
  return (
    <div className="mt-1.5 space-y-1.5">
      <input className="glass-inp text-xs w-full" placeholder="Reason (optional)…"
        value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy}
          className="text-xs font-semibold px-3 py-1 rounded disabled:opacity-50" style={{ backgroundColor: '#f87171', color: '#fff' }}>
          {busy ? '…' : 'Release'}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs" style={{ color: 'var(--text-muted)' }}>Cancel</button>
      </div>
    </div>
  );
}

// One-click push of a PARTNER_DSA lead into the partner funnel (details
// auto-picked). Shown ONLY for leads categorised Partner Sign-up (the website
// partner form) — business/loan/wealth leads never see this. If a genuine
// partner request arrived mis-categorised, change its Category to "Partner
// Sign-up" in the drawer first (the server enforces the same rule).
export function PromotePartnerRow({ lead }: { lead: LeadRow }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!window.confirm(`Move ${lead.name} into the partner funnel? They'll be logged as an Inquiry candidate for screening; this lead closes as Converted.`)) return;
    setBusy(true);
    try {
      const r = await apiCrm2<{ ok: boolean; connectorCode: string }>('POST', `/api/crm2/leads/${lead.id}/promote-partner`, {});
      toast.success(`${r.connectorCode} created — a super admin screens & onboards them in Masters → Connectors`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not move to partner funnel'); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg"
      style={{ backgroundColor: 'rgba(201,169,97,0.10)', border: '1px solid rgba(201,169,97,0.35)' }}>
      <p className="text-xs" style={{ color: '#C9A961' }}>
        PARTNER request — call them first. They REFER files & we do the legwork → this button (Connector). They will work cases THEMSELVES on the code → use Convert to Sub DSA instead.
      </p>
      <button onClick={go} disabled={busy}
        className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
        style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
        {busy ? 'Moving…' : 'Move to Partner funnel'}
      </button>
    </div>
  );
}

export function LeadDrawer({ lead, canWrite, canAssign, canConvert, faplOptions, productOptions, clients, clientOptions, subDsaOptions, partnerOptions, refData, onClose }: {
  lead: LeadRow;
  canWrite: boolean; canAssign: boolean; canConvert: boolean;
  faplOptions: Opt[]; productOptions: ProductOpt[];
  clients: Array<Client & { id: string }>;
  clientOptions: Opt[]; subDsaOptions: Opt[]; partnerOptions: Opt[]; refData: RefData;
  onClose: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [scorePrompt, setScorePrompt] = useState(false);
  const [scoreVal, setScoreVal] = useState('');
  const [neReason, setNeReason] = useState('');
  const [followUpNote, setFollowUpNote] = useState(lead.nextFollowUpNote ?? '');
  const [busy, setBusy] = useState(false);
  const [showConvert, setShowConvert] = useState(false);

  const patch = async (body: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await apiCrm2('PATCH', `/api/crm2/leads/${lead.id}`, body);
      toast.success(okMsg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally { setBusy(false); }
  };

  const sm = STATUS_META[lead.status] ?? STATUS_META.NEW;
  const log = [...(lead.activityLog ?? [])].reverse();

  return (
    <div className="glass-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-modal-panel w-full max-w-xl rounded-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header flex items-start justify-between px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{lead.name}</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${sm.color}1f`, color: sm.color }}>{sm.label}</span>
            </div>
            {lead.customerName && lead.customerName !== lead.name && (
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Contact: <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{lead.customerName}</span></p>
            )}
            <p className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {lead.leadCode ?? lead.id} · {lead.mobile}{lead.email ? ` · ${lead.email}` : ''} · {sourceLabel(lead.source)}
            </p>
            {(lead.referredByName || lead.linkedExistingClientId || lead.channelPartnerName) && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {lead.channelPartnerName && <>Connector <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{lead.channelPartnerName}{lead.channelPartnerCode ? ` (${lead.channelPartnerCode})` : ''}</span></>}
                {lead.referredByName && <>{lead.channelPartnerName ? ' · ' : ''}Referred by <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{lead.referredByName}{lead.referredByCode ? ` (${lead.referredByCode})` : ''}</span></>}
                {lead.linkedExistingClientId && <> · Linked client <span className="font-mono" style={{ color: '#C9A961' }}>{lead.linkedExistingClientId}</span></>}
              </p>
            )}
            <div className="mt-2"><ContactActions phone={lead.mobile} email={lead.email} name={lead.name} size="sm" /></div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard)" aria-label="Close">
            <X size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {lead.duplicateOfLeadId && (
            <div className="px-3.5 py-2.5 rounded-lg text-sm flex items-center gap-2"
              style={{ backgroundColor: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24' }}>
              <Copy size={14} /> Possible duplicate of <span className="font-mono">{lead.duplicateOfLeadId}</span> — review before working it.
            </div>
          )}
          {lead.converted && (
            <div className="px-3.5 py-2.5 rounded-lg text-sm"
              style={{ backgroundColor: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399' }}>
              Converted → {lead.linkedConnectorId
                ? <span>partner funnel <span className="font-mono">{lead.linkedConnectorId.slice(0, 8)}…</span> (screening continues in Masters → Connectors)</span>
                : lead.linkedSubDsaId
                  ? <span className="font-mono">{lead.linkedSubDsaId} (sub-DSA)</span>
                  : <span className="font-mono">{lead.linkedClientId} / {lead.linkedCaseId}</span>}
            </div>
          )}

          {canWrite && !lead.converted && lead.category === 'PARTNER_DSA' && (
            <PromotePartnerRow lead={lead} />
          )}
          {canWrite && !lead.converted && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FLabel text="Category" />
                <SearchableSelect value={lead.category ?? 'GENERAL'} disabled={busy}
                  options={CATEGORY_OPTS}
                  onChange={(v) => void patch({ category: v }, 'Category updated')} />
              </div>
              <div>
                <FLabel text="Status" />
                <SearchableSelect value={lead.status} disabled={busy}
                  onChange={(v) => { if (v === 'NOT_ELIGIBLE') { setScorePrompt(true); return; } patch({ status: v }, `Status → ${v}`); }}
                  options={(Object.keys(STATUS_META) as Crm2LeadStatus[])
                    .filter((s) => s !== 'CONVERTED')
                    .map((s) => ({ value: s, label: STATUS_META[s].label }))} />
                {!scorePrompt && (lead.creditScore != null || lead.notEligibleReason) && (
                  <p className="text-[11px] mt-1 font-semibold" style={{ color: '#fb7185' }}>
                    {lead.creditScore != null ? `CIBIL score on record: ${lead.creditScore}` : ''}
                    {lead.creditScore != null && lead.notEligibleReason ? ' · ' : ''}
                    {lead.notEligibleReason ? `Reason: ${lead.notEligibleReason}` : ''}
                  </p>
                )}
                {scorePrompt && (
                  <div className="mt-2 p-3 rounded-lg space-y-2" style={{ backgroundColor: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.35)' }}>
                    <p className="text-[11px] font-semibold" style={{ color: '#fb7185' }}>Confirm — enter the failed CIBIL score, the reason, or both:</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input type="number" min={300} max={900} value={scoreVal} autoFocus
                        onChange={(e) => setScoreVal(e.target.value)} placeholder="CIBIL e.g. 580"
                        className="w-32 text-sm px-3 py-2 rounded-lg outline-none"
                        style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)', color: 'var(--text-primary)' }} />
                      <input value={neReason} onChange={(e) => setNeReason(e.target.value)}
                        placeholder="Reason — e.g. low income / FOIR / profile"
                        className="flex-1 min-w-40 text-sm px-3 py-2 rounded-lg outline-none"
                        style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)', color: 'var(--text-primary)' }} />
                    </div>
                    <div className="flex items-center gap-2">
                      <button disabled={busy || !((Number(scoreVal) >= 300 && Number(scoreVal) <= 900) || neReason.trim() !== '')}
                        onClick={() => {
                          const score = Number(scoreVal) >= 300 && Number(scoreVal) <= 900 ? Number(scoreVal) : null;
                          void patch({ status: 'NOT_ELIGIBLE', creditScore: score, notEligibleReason: neReason.trim() || null }, 'Marked Not eligible');
                          setScorePrompt(false); setScoreVal(''); setNeReason('');
                        }}
                        className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-40"
                        style={{ backgroundColor: '#fb7185', color: '#fff' }}>
                        Mark Not eligible
                      </button>
                      <button onClick={() => { setScorePrompt(false); setScoreVal(''); setNeReason(''); }}
                        className="text-xs px-2.5 py-2" style={{ color: 'var(--text-muted)' }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
              <div>
                {/* Reassignment is a MANAGER action (server enforces too) — non-managers
                    see the RM read-only; they claim work via the queue's Get-next-lead. */}
                <FLabel text="Assigned RM" />
                {canAssign ? (
                  <SearchableSelect value={lead.assignedRm ?? ''} disabled={busy}
                    onChange={(v) => patch({ assignedRm: v || null }, 'RM updated')}
                    options={[{ value: '', label: 'Unassigned' }, ...faplOptions]} placeholder="Unassigned" />
                ) : (
                  <p className="text-sm px-1 py-2" style={{ color: 'var(--text-secondary)' }}>
                    {lead.assignedRm ? (faplOptions.find((o) => o.value === lead.assignedRm)?.label ?? lead.assignedRm) : 'Unassigned'}
                  </p>
                )}
                {canWrite && lead.assignedRm && (
                  <ReleaseControl leadId={lead.id} onReleased={() => toast.success('Released back to the queue')} />
                )}
              </div>
              <div>
                <FLabel text="Priority" />
                <SearchableSelect value={lead.priority} disabled={busy}
                  onChange={(v) => patch({ priority: v }, `Priority → ${PRIORITY_META[v as 'HOT'].label}`)}
                  options={PRIORITY_OPTS} />
              </div>
              <div>
                <FLabel text="Next Follow-up" />
                <input type="datetime-local" className={inp()} disabled={busy}
                  defaultValue={lead.nextFollowUpAt?.toDate ? new Date(lead.nextFollowUpAt.toDate().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
                  onBlur={(e) => e.target.value && patch({ nextFollowUpAt: new Date(e.target.value).toISOString(), nextFollowUpNote: followUpNote || null }, 'Follow-up set — reminder will email you')} />
              </div>
              <div className="col-span-2">
                <FLabel text="Follow-up remark (emailed with the reminder)" />
                <input className={inp()} value={followUpNote} disabled={busy}
                  onChange={(e) => setFollowUpNote(e.target.value)}
                  onBlur={() => { if ((followUpNote ?? '') !== (lead.nextFollowUpNote ?? '')) patch({ nextFollowUpNote: followUpNote || null }, 'Remark saved'); }}
                  placeholder="e.g. Confirm income docs, discuss 9.2% offer" />
              </div>
              <div>
                <FLabel text="Sourced by Connector" />
                <SearchableSelect value={lead.channelPartnerId ?? ''} disabled={busy}
                  onChange={(v) => patch(v ? buildChannelPartner(v, refData.connectors) : { channelPartnerId: null, channelPartnerCode: null, channelPartnerName: null }, 'Connector updated')}
                  options={[{ value: '', label: '— none —' }, ...partnerOptions]} placeholder="— none —" />
              </div>
              <div>
                <FLabel text="Link existing client" />
                <SearchableSelect value={lead.linkedExistingClientId ?? ''} disabled={busy}
                  onChange={(v) => patch({ linkedExistingClientId: v || null }, v ? 'Client linked' : 'Client unlinked')}
                  options={[{ value: '', label: '— none —' }, ...clientOptions]} placeholder="— none —" />
              </div>
              {lead.source === 'REFERRAL_SUBDSA' && (
                <div className="col-span-2">
                  <FLabel text="Referred by (Sub DSA)" />
                  <SearchableSelect value={lead.referredById ?? ''} disabled={busy}
                    onChange={(v) => patch(buildReferral('REFERRAL_SUBDSA', v, '', refData), 'Referral updated')}
                    options={[{ value: '', label: '— none —' }, ...subDsaOptions]} placeholder="— none —" />
                </div>
              )}
              {lead.source === 'REFERRAL_CLIENT' && (
                <div className="col-span-2">
                  <FLabel text="Referred by (Client)" />
                  <SearchableSelect value={lead.referredById ?? ''} disabled={busy}
                    onChange={(v) => patch(buildReferral('REFERRAL_CLIENT', '', v, refData), 'Referral updated')}
                    options={[{ value: '', label: '— none —' }, ...clientOptions]} placeholder="— none —" />
                </div>
              )}
            </div>
          )}

          {canConvert && !lead.converted && lead.status === 'QUALIFIED' && (
            <button onClick={() => setShowConvert(true)}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
              Convert {lead.category === 'PARTNER_DSA' ? 'to Connector' : 'to Client + Case'} <ArrowRight size={15} />
            </button>
          )}
          {canConvert && !lead.converted && lead.status !== 'QUALIFIED' && (
            <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>
              Mark the lead QUALIFIED to enable conversion.
            </p>
          )}

          {/* Activity log */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
              Activity ({log.length})
            </p>
            {canWrite && (
              <div className="flex gap-2 mb-3">
                <input className={inp()} value={note} placeholder="Log a call / note…"
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && note.trim().length >= 3) { patch({ activity: { note, action: 'note' }, incrementAttempts: true }, 'Logged'); setNote(''); } }} />
                <button disabled={busy || note.trim().length < 3}
                  onClick={() => { patch({ activity: { note, action: 'note' }, incrementAttempts: true }, 'Logged'); setNote(''); }}
                  className="shrink-0 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
                  style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
                  Log
                </button>
              </div>
            )}
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {log.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No activity yet.</p>
              ) : log.map((a, i) => (
                <div key={i} className="px-3 py-2 rounded-lg" style={{ border: '1px solid var(--shell-border)' }}>
                  <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{a.note}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {a.by} · {a.action} · {fmtTsFull(a.at)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {showConvert && (
          <ConvertModal lead={lead} faplOptions={faplOptions} productOptions={productOptions} clients={clients}
            onClose={() => setShowConvert(false)} onDone={onClose} />
        )}
      </div>
    </div>
  );
}
