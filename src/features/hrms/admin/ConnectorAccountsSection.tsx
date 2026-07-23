/**
 * Partner (connector) login accounts — super-admin only.
 *
 * Turning a Pulse account into a channel-partner login is a rare, deliberate,
 * security-sensitive action, so it lives in its own section rather than as another
 * toggle in the dense permissions table. Grouping it also gives an audit view that
 * did not exist before: WHO are the partner logins, and which CON- record is each
 * one tied to.
 *
 * All the dangerous flag-setting happens SERVER-side in
 * POST /api/admin/users/:uid/connector — this component never writes the user doc
 * directly. That endpoint forces hrmsAccess:false + crmAccess:false and reduces
 * perms to the single crm.leads.write a partner needs, because getting those wrong
 * is exactly what would leak (both the create path and the rules fallback default
 * hrmsAccess to TRUE, so merely omitting it would hand over the staff module).
 *
 * See the "Connector isolation" section of CLAUDE.md and
 * .qa/connector-isolation-gate.mjs, which proves a partner can reach only their own
 * lead / case / payout / connector record.
 */
import { useMemo, useState } from 'react';
import { Handshake, Link2, Unlink, AlertTriangle } from 'lucide-react';
import { getIdToken } from 'firebase/auth';
import { auth } from '../../../lib/firebase';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useToast } from '../../../components/ui/Toast';
import { useConnectors } from '../../hrms/hooks/useConnectors';
import type { UserProfile } from '../../../types';

async function callConnectorApi(uid: string, connectorId: string | null): Promise<void> {
  const token = auth.currentUser ? await getIdToken(auth.currentUser) : null;
  const res = await fetch(`/api/admin/users/${uid}/connector`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify({ connectorId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status})`);
}

export function ConnectorAccountsSection({ employees }: { employees: UserProfile[] }) {
  const { connectors } = useConnectors();
  const toast = useToast();

  const [linkUid, setLinkUid] = useState('');
  const [linkConnectorId, setLinkConnectorId] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<UserProfile | null>(null);

  // Accounts already acting as a partner login.
  const partnerAccounts = useMemo(
    () => employees.filter((e) => !!e.connectorId),
    [employees],
  );

  // Candidates: active staff accounts not already linked. (A partner needs a real
  // @finvastra.com login, so the account must exist before it can be linked.)
  const candidateOptions = useMemo(
    () => employees
      .filter((e) => !e.connectorId && e.employeeStatus !== 'inactive')
      .map((e) => ({ value: e.userId, label: `${e.displayName ?? e.email} · ${e.email}` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [employees],
  );

  const connectorOptions = useMemo(
    () => connectors
      .filter((c) => !c.deleted)
      .map((c) => ({ value: c.id, label: `${c.connectorCode ?? c.id} · ${c.displayName ?? '—'}` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [connectors],
  );

  const connectorLabel = (id?: string | null) => {
    const c = connectors.find((x) => x.id === id);
    return c ? `${c.connectorCode ?? c.id} · ${c.displayName ?? '—'}` : (id ?? '—');
  };

  const doLink = async () => {
    if (!linkUid || !linkConnectorId) return;
    setBusy(true);
    try {
      await callConnectorApi(linkUid, linkConnectorId);
      toast.success('Partner login created — they land on /partner when they sign in.');
      setLinkUid('');
      setLinkConnectorId('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not link the account');
    } finally {
      setBusy(false);
    }
  };

  const doUnlink = async (emp: UserProfile) => {
    setBusy(true);
    try {
      await callConnectorApi(emp.userId, null);
      toast.success(`${emp.displayName ?? emp.email} is no longer a partner login.`);
      setConfirmUnlink(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not unlink the account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-panel p-5 mt-6">
      <div className="flex items-center gap-2 mb-1">
        <Handshake size={16} style={{ color: '#C9A961' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Partner (connector) logins</h3>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Gives a channel partner their own area at <strong>/partner</strong> — they submit the leads they
        source and track their own cases and payouts. A partner login sees <strong>only its own data</strong>:
        no HRMS, no CRM, no other partner's cases or contact details.
      </p>

      {/* Existing partner logins — the audit view */}
      {partnerAccounts.length === 0 ? (
        <p className="text-xs mb-4 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--shell-hover-soft)', color: 'var(--text-muted)' }}>
          No partner logins yet.
        </p>
      ) : (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-sm glass-table">
            <thead><tr>
              <th className="text-left px-3 py-2">Account</th>
              <th className="text-left px-3 py-2">Partner record</th>
              <th className="text-right px-3 py-2 w-28" />
            </tr></thead>
            <tbody>
              {partnerAccounts.map((e) => (
                <tr key={e.userId}>
                  <td className="px-3 py-2">
                    <span style={{ color: 'var(--text-primary)' }}>{e.displayName ?? '—'}</span>
                    <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>{e.email}</span>
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{connectorLabel(e.connectorId)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setConfirmUnlink(e)} disabled={busy}
                      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg disabled:opacity-50"
                      style={{ border: '1px solid rgba(220,38,38,0.4)', color: '#DC2626' }}>
                      <Unlink size={12} /> Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Link a new one */}
      <div className="grid sm:grid-cols-2 gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
            Pulse account
          </label>
          <SearchableSelect
            value={linkUid}
            onChange={setLinkUid}
            options={candidateOptions}
            placeholder="Select the partner's @finvastra.com account…"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
            Partner record (Masters → Connectors)
          </label>
          <SearchableSelect
            value={linkConnectorId}
            onChange={setLinkConnectorId}
            options={connectorOptions}
            placeholder="Select the CON- record…"
          />
        </div>
      </div>
      <button onClick={doLink} disabled={busy || !linkUid || !linkConnectorId}
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
        style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
        <Link2 size={14} /> {busy ? 'Working…' : 'Make this a partner login'}
      </button>
      <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
        This switches HRMS and CRM access off for that account and restricts it to submitting leads.
        Their existing data is untouched — revoking simply returns the account to normal.
      </p>

      {/* Revoke confirmation — losing partner access mid-flight is disruptive, so confirm. */}
      {confirmUnlink && (
        <div className="glass-modal-overlay" onClick={() => !busy && setConfirmUnlink(null)}>
          <div className="glass-modal-panel max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={16} style={{ color: '#DC2626' }} />
              <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Revoke partner access?</h4>
            </div>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{confirmUnlink.displayName ?? confirmUnlink.email}</strong> will
              lose the /partner area immediately. The account itself stays active and their leads, cases and payout
              history are untouched — you can link it again at any time.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmUnlink(null)} disabled={busy}
                className="text-sm px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--shell-border)', color: 'var(--text-secondary)' }}>
                Cancel
              </button>
              <button onClick={() => doUnlink(confirmUnlink)} disabled={busy}
                className="text-sm font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
                style={{ backgroundColor: '#DC2626' }}>
                {busy ? 'Revoking…' : 'Revoke access'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
