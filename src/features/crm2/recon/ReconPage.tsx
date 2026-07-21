/**
 * Pipeline → Recon — upload a connector's bank-MIS dump, auto-match against our
 * misRecords (loan a/c → app no → fuzzy), manually match/unmatch rows, and flag
 * entries missing from the dump to the dispute list. Viewing requires recon.read;
 * upload + match/unmatch need recon.write; dispute needs payout.write. Money
 * columns shown only with payout.amounts.read. Per-login model: matching + the
 * missing list are keyed per misRecord (== per disbursed LOGIN), and disputes on
 * multi-login cases pass the loginId so the right cycle is flagged.
 */
import { useState } from 'react';
import { inr } from '../../../lib/money';
import { useNavigate } from 'react-router-dom';
import { Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { apiCrm2, useCrm2Collection, hasCrm2Perm } from '../lib';
import { FLabel, inp } from '../masters/MastersPage';
import type { Aggregator } from '../../../types/crm2';

const thisMonth = () => new Date().toISOString().slice(0, 7);

interface MissingEntry { misId: string; caseId: string; loginId: string | null; loanAccountNo: string | null; }
interface ImportSummary { id: string; totalRows: number; matched: number; unmatched: number; missing: MissingEntry[]; }
interface ReconRow { id: string; rowIndex: number; loanAccountNo: string | null; bankApplicationNo: string | null; dsaCode: string | null; amount: number | null; dateIso: string | null; matched: boolean; matchType: string; matchedCaseId: string | null; amountVariance: number | null; }

/** Server returns missingEntries (per disbursed login); older imports only had
 *  missingCaseIds — fall back so they still render (dispute then omits loginId). */
const toMissing = (r: { missingEntries?: MissingEntry[]; missingCaseIds?: string[] }): MissingEntry[] =>
  r.missingEntries ?? (r.missingCaseIds ?? []).map((caseId) => ({ misId: caseId, caseId, loginId: null, loanAccountNo: null }));

export function ReconPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { rows: aggregators } = useCrm2Collection<Aggregator & { id: string }>('aggregators');
  const [connectorId, setConnectorId] = useState('');
  const [month, setMonth] = useState(thisMonth());
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [rows, setRows] = useState<ReconRow[]>([]);

  const canDispute = hasCrm2Perm(profile, 'payout.write');
  const canMoney = hasCrm2Perm(profile, 'payout.amounts.read');
  const canWrite = hasCrm2Perm(profile, 'recon.write');   // upload + match/unmatch

  const upload = async (file: File) => {
    if (!connectorId) { toast.error('Pick the connector first'); return; }
    setBusy(true);
    try {
      const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(file); });
      const r = await apiCrm2<{ ok: boolean; importId: string; totalRows: number; matched: number; unmatched: number; missingCaseIds: string[]; missingEntries?: MissingEntry[] }>(
        'POST', '/api/crm2/recon/imports', { connectorId, reportingMonth: month, fileBase64: b64, fileName: file.name });
      toast.success(`Imported ${r.totalRows} rows — ${r.matched} matched, ${r.unmatched} unmatched`);
      setSummary({ id: r.importId, totalRows: r.totalRows, matched: r.matched, unmatched: r.unmatched, missing: toMissing(r) });
      await loadImport(r.importId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally { setBusy(false); }
  };

  const loadImport = async (id: string) => {
    const r = await apiCrm2<{ ok: boolean; import: Record<string, unknown>; rows: ReconRow[] }>('GET', `/api/crm2/recon/imports/${id}`);
    setRows(r.rows);
  };

  const dispute = async (entry: MissingEntry) => {
    const label = entry.loginId ? `${entry.caseId} · ${entry.loginId}` : entry.caseId;
    if (!confirm(`Flag ${label} as missing from the dump? This sets its payout cycle to DISPUTED.`)) return;
    try {
      // loginId disambiguates multi-login cases — the server 409s a bare caseId
      // when the case has more than one payout cycle.
      await apiCrm2('POST', '/api/crm2/recon/dispute', { caseId: entry.caseId, ...(entry.loginId ? { loginId: entry.loginId } : {}) });
      toast.success(`${label} flagged DISPUTED`);
      setSummary((s) => s ? { ...s, missing: s.missing.filter((x) => x.misId !== entry.misId) } : s);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  const unmatch = async (rowId: string) => {
    try { await apiCrm2('PATCH', `/api/crm2/recon/imports/${summary!.id}/rows/${rowId}`, { action: 'unmatch' }); if (summary) await loadImport(summary.id); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>Reconciliation</h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Match a connector's bank-MIS dump against our disbursals; escalate the gaps</p>
      </div>

      <div className="glass-panel p-5 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <FLabel text="Connector" required />
          <SearchableSelect value={connectorId} onChange={setConnectorId} placeholder="Select connector…"
            options={aggregators.filter((a) => a.status === 'ACTIVE').map((a) => ({ value: a.id, label: a.name }))} />
        </div>
        <div>
          <FLabel text="Reporting Month" required />
          <input type="month" className={inp()} value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} />
        </div>
        {canWrite && (
          <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold cursor-pointer"
            style={{ backgroundColor: '#C9A961', color: '#0B1538', opacity: busy ? 0.5 : 1 }}>
            <Upload size={15} /> {busy ? 'Importing…' : 'Upload dump (xlsx/csv)'}
            <input type="file" accept=".xlsx,.csv" className="hidden" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
          </label>
        )}
      </div>

      {summary && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[['Rows', summary.totalRows], ['Matched', summary.matched], ['Unmatched', summary.unmatched]].map(([l, v]) => (
              <div key={l} className="glass-panel p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{l}</p>
                <p className="text-lg font-bold mt-0.5" style={{ color: l === 'Matched' ? '#34d399' : l === 'Unmatched' ? '#fbbf24' : 'var(--text-primary)' }}>{v}</p>
              </div>
            ))}
          </div>

          {/* Missing entries (per disbursed login) → dispute */}
          {summary.missing.length > 0 && (
            <div className="glass-panel p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={15} style={{ color: '#f87171' }} />
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  Our disbursals missing from this dump ({summary.missing.length})
                </h3>
              </div>
              <div className="space-y-1.5">
                {summary.missing.map((entry) => (
                  <div key={entry.misId} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ border: '1px solid rgba(248,113,113,0.3)' }}>
                    <button onClick={() => navigate(`/crm/pipeline/cases/${entry.caseId}`)} className="font-mono text-xs flex-1 text-left hover:underline" style={{ color: '#C9A961' }}>
                      {entry.caseId}{entry.loginId ? ` · ${entry.loginId}` : ''}{entry.loanAccountNo ? ` · ${entry.loanAccountNo}` : ''}
                    </button>
                    {canDispute && (
                      <button onClick={() => dispute(entry)} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg" style={{ backgroundColor: 'rgba(248,113,113,0.15)', color: '#f87171' }}>Flag dispute</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dump rows */}
          <div className="glass-panel p-0 overflow-hidden">
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--shell-border)' }}>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Dump rows ({rows.length})</h3>
            </div>
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0" style={{ backgroundColor: 'var(--ss-bg)' }}>
                  <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    <th className="text-left font-semibold px-3 py-2">#</th>
                    <th className="text-left font-semibold px-3 py-2">Loan A/C</th>
                    <th className="text-left font-semibold px-3 py-2">App No</th>
                    <th className="text-left font-semibold px-3 py-2">DSA</th>
                    {canMoney && <th className="text-right font-semibold px-3 py-2">Amount</th>}
                    <th className="text-left font-semibold px-3 py-2">Match</th>
                    <th className="text-left font-semibold px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--shell-border)' }}>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{r.rowIndex}</td>
                      <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{r.loanAccountNo ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{r.bankApplicationNo ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{r.dsaCode ?? '—'}</td>
                      {canMoney && <td className="px-3 py-2 text-right text-xs" style={{ color: 'var(--text-secondary)' }}>{inr(r.amount)}</td>}
                      <td className="px-3 py-2">
                        {r.matched ? (
                          <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#34d399' }}>
                            <CheckCircle2 size={12} /> {r.matchType}
                            <button onClick={() => navigate(`/crm/pipeline/cases/${r.matchedCaseId}`)} className="font-mono hover:underline ml-1" style={{ color: '#C9A961' }}>{r.matchedCaseId}</button>
                          </span>
                        ) : <span className="text-[11px]" style={{ color: '#fbbf24' }}>unmatched</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.matched && canWrite && <button onClick={() => unmatch(r.id)} className="text-[10px] hover:underline" style={{ color: 'var(--text-muted)' }}>unmatch</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
