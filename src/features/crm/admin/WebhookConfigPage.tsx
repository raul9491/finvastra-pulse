import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Copy, CheckCheck, Globe, Facebook, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { auth } from '../../../lib/firebase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WebhookLog {
  id:           string;
  source:       'website' | 'social_meta';
  result:       'success' | 'duplicate' | 'invalid' | 'error';
  leadId:       string | null;
  errorMessage: string | null;
  assignedTo:   string | null;
  receivedAt:   string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = 'https://pulse-api-787616231546.asia-south1.run.app';
const WEBSITE_WEBHOOK_URL = `${API_BASE}/api/leads/intake/website`;
const META_WEBHOOK_URL    = `${API_BASE}/api/leads/intake/meta`;

const RESULT_BADGE: Record<WebhookLog['result'], string> = {
  success:   'badge-glass-success',
  duplicate: 'badge-glass-warning',
  invalid:   'badge-glass-danger',
  error:     'badge-glass-danger',
};

const RESULT_LABELS: Record<WebhookLog['result'], string> = {
  success:   'Success',
  duplicate: 'Duplicate',
  invalid:   'Invalid',
  error:     'Error',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors font-medium shrink-0 hover:bg-(--shell-hover-soft)"
      style={{ color: copied ? '#34d399' : 'var(--text-primary)', borderColor: 'var(--shell-border-mid)' }}
      title={`Copy ${label}`}
    >
      {copied ? <CheckCheck size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function LogTable({ logs, source }: { logs: WebhookLog[]; source: 'website' | 'social_meta' }) {
  const filtered = logs.filter((l) => l.source === source).slice(0, 5);
  if (filtered.length === 0) {
    return (
      <p className="text-sm py-3" style={{ color: 'var(--text-muted)' }}>
        No webhook calls recorded yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-left">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--shell-border)' }}>
            {['Time', 'Result', 'Lead ID', 'Notes'].map((h) => (
              <th key={h} className="pb-2 font-bold uppercase tracking-widest whitespace-nowrap pr-4"
                style={{ color: 'var(--text-muted)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((log) => {
            const dt = log.receivedAt ? (() => {
              try { return format(new Date(log.receivedAt), 'dd MMM HH:mm'); } catch { return '—'; }
            })() : '—';
            return (
              <tr key={log.id} style={{ borderBottom: '1px solid var(--shell-border)' }}>
                <td className="py-2 pr-4 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{dt}</td>
                <td className="py-2 pr-4">
                  <span className={RESULT_BADGE[log.result]}>{RESULT_LABELS[log.result]}</span>
                </td>
                <td className="py-2 pr-4 font-mono" style={{ color: 'var(--text-muted)' }}>
                  {log.leadId ? log.leadId.slice(-8).toUpperCase() : '—'}
                </td>
                <td className="py-2" style={{ color: 'var(--text-muted)', maxWidth: '200px' }}>
                  <span className="truncate block">{log.errorMessage ?? '—'}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function WebhookConfigPage() {
  const { profile } = useAuth();

  const [logs,        setLogs]        = useState<WebhookLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError,   setLogsError]   = useState('');

  // Admin gate. The redirect is returned AFTER every hook (see below) — an early
  // return here would skip them and change the hook count between renders
  // (React #310). `denied` keeps a non-admin from calling the logs endpoint.
  const denied = profile !== null && profile.role !== 'admin';

  const fetchLogs = async () => {
    setLogsLoading(true);
    setLogsError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${API_BASE}/api/admin/webhook-logs`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { logs: WebhookLog[] };
      setLogs(data.logs);
    } catch (e) {
      setLogsError(e instanceof Error ? e.message : 'Failed to load logs');
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => { if (!denied) fetchLogs(); }, [denied]);

  // Masked secret helper — shows first 4 chars + ***
  const masked = (label: string) => `${label.slice(0, 4)}${'*'.repeat(label.length - 4 > 0 ? label.length - 4 : 8)}`;

  if (denied) return <Navigate to="/crm/dashboard" replace />;

  return (
    <div className="max-w-3xl mx-auto space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'Fraunces, Georgia, serif' }}>
          Webhook Configuration
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Configure external sources to push new leads directly into Finvastra Pulse.
          Leads are assigned automatically using workload-aware assignment.
        </p>
      </div>

      {/* ── Website Webhook ── */}
      <div className="glass-panel overflow-hidden">
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--shell-border)' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'rgba(96,165,250,0.15)' }}>
            <Globe size={16} style={{ color: '#60a5fa' }} />
          </div>
          <div>
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Website Form Webhook</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Receives leads from your website contact / loan enquiry form
            </p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Webhook URL */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Endpoint URL
            </p>
            <div className="flex items-center gap-2 p-3 rounded-xl"
              style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border-mid)' }}>
              <code className="flex-1 text-xs break-all" style={{ color: '#C9A961' }}>
                {WEBSITE_WEBHOOK_URL}
              </code>
              <CopyButton text={WEBSITE_WEBHOOK_URL} label="URL" />
            </div>
          </div>

          {/* Header */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Authentication Header
            </p>
            <div className="p-3 rounded-xl font-mono text-xs space-y-1"
              style={{ backgroundColor: '#0B1538', color: '#C9A961', border: '1px solid rgba(201,169,97,0.20)' }}>
              <div>
                <span style={{ color: 'rgba(201,169,97,0.50)' }}>Header: </span>
                X-Finvastra-Webhook-Secret
              </div>
              <div>
                <span style={{ color: 'rgba(201,169,97,0.50)' }}>Value: </span>
                {masked('WEBSITE_WEBHOOK_SECRET')}
                &nbsp;<span style={{ color: 'rgba(201,169,97,0.40)', fontFamily: 'sans-serif', fontSize: '10px' }}>
                  (set in Cloud Run env — WEBSITE_WEBHOOK_SECRET)
                </span>
              </div>
            </div>
          </div>

          {/* Payload schema */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Expected JSON Payload
            </p>
            <pre className="p-3 rounded-xl text-[11px] overflow-x-auto leading-relaxed"
              style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border-mid)', color: 'var(--text-primary)' }}>
{`{
  "name":        "string  (required, min 2 chars)",
  "phone":       "string  (required, 10-digit Indian mobile)",
  "email":       "string  (optional)",
  "loanProduct": "string  (optional, e.g. 'Home Loan')",
  "loanAmount":  "number  (optional, ₹)",
  "city":        "string  (optional)",
  "utmSource":   "string  (optional)",
  "utmCampaign": "string  (optional)",
  "formId":      "string  (optional)"
}`}
            </pre>
          </div>

          {/* Recent calls */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                Recent Calls (last 5)
              </p>
              <button onClick={fetchLogs}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:bg-(--shell-hover-soft) transition-colors"
                style={{ color: 'var(--text-muted)' }}>
                <RefreshCw size={11} className={logsLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
            {logsLoading ? (
              <div className="space-y-2">
                {[1,2,3].map((i) => (
                  <div key={i} className="h-6 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
                ))}
              </div>
            ) : logsError ? (
              <p className="text-xs" style={{ color: '#f87171' }}>{logsError}</p>
            ) : (
              <LogTable logs={logs} source="website" />
            )}
          </div>
        </div>
      </div>

      {/* ── Meta Lead Ads Webhook ── */}
      <div className="glass-panel overflow-hidden">
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--shell-border)' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'rgba(139,92,246,0.15)' }}>
            <Facebook size={16} style={{ color: '#a78bfa' }} />
          </div>
          <div>
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Meta Lead Ads Webhook</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Receives leads from Facebook / Instagram Lead Ads forms in real-time
            </p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Webhook URL */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Webhook URL
            </p>
            <div className="flex items-center gap-2 p-3 rounded-xl"
              style={{ backgroundColor: 'var(--shell-hover-soft)', border: '1px solid var(--shell-border-mid)' }}>
              <code className="flex-1 text-xs break-all" style={{ color: '#C9A961' }}>
                {META_WEBHOOK_URL}
              </code>
              <CopyButton text={META_WEBHOOK_URL} label="URL" />
            </div>
          </div>

          {/* Verify token */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Verify Token
            </p>
            <div className="p-3 rounded-xl font-mono text-xs"
              style={{ backgroundColor: '#0B1538', color: '#C9A961', border: '1px solid rgba(201,169,97,0.20)' }}>
              <span style={{ color: 'rgba(201,169,97,0.50)' }}>Value: </span>
              {masked('META_WEBHOOK_SECRET')}
              &nbsp;<span style={{ color: 'rgba(201,169,97,0.40)', fontFamily: 'sans-serif', fontSize: '10px' }}>
                (set in Cloud Run env — META_WEBHOOK_SECRET)
              </span>
            </div>
          </div>

          {/* Setup instructions */}
          <div className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(201,169,97,0.08)', border: '1px solid rgba(201,169,97,0.25)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#C9A961' }}>
              Setup Instructions — Meta Business Suite
            </p>
            <ol className="text-xs space-y-1.5 list-decimal list-inside" style={{ color: 'rgba(201,169,97,0.80)' }}>
              <li>Go to <strong>Meta Business Suite → All Tools → Leads Centre</strong></li>
              <li>Select your Facebook page and click <strong>Instant Forms</strong></li>
              <li>Click <strong>Set up CRM integration</strong></li>
              <li>Choose <strong>Custom integration (webhook)</strong></li>
              <li>Paste the Webhook URL and Verify Token from above</li>
              <li>Click <strong>Verify and Save</strong> — Meta sends a test GET request</li>
              <li>
                Map form fields to these field names in your Instant Form:
                <span className="font-mono ml-1" style={{ color: '#C9A961' }}>
                  full_name, phone_number, email, loan_type, loan_amount
                </span>
              </li>
            </ol>
          </div>

          {/* Recent calls */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                Recent Calls (last 5)
              </p>
              <button onClick={fetchLogs}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:bg-(--shell-hover-soft) transition-colors"
                style={{ color: 'var(--text-muted)' }}>
                <RefreshCw size={11} className={logsLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
            {logsLoading ? (
              <div className="space-y-2">
                {[1,2,3].map((i) => (
                  <div key={i} className="h-6 rounded animate-pulse" style={{ backgroundColor: 'var(--shell-hover-hard)' }} />
                ))}
              </div>
            ) : logsError ? (
              <p className="text-xs" style={{ color: '#f87171' }}>{logsError}</p>
            ) : (
              <LogTable logs={logs} source="social_meta" />
            )}
          </div>
        </div>
      </div>

      {/* ── Cloud Run deployment note ── */}
      <div className="p-5 rounded-2xl glass-panel">
        <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
          Production Setup — Cloud Run
        </p>
        <pre className="text-[11px] overflow-x-auto" style={{ color: 'var(--text-primary)' }}>
{`gcloud run services update pulse-api \\
  --set-env-vars \\
  "WEBSITE_WEBHOOK_SECRET=<strong-random-secret>,META_WEBHOOK_SECRET=<meta-verify-token>" \\
  --region asia-south1`}
        </pre>
        <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
          Use a long random string for WEBSITE_WEBHOOK_SECRET (≥32 chars). The META_WEBHOOK_SECRET
          is the same token you enter in Meta Business Suite as the "verify token".
        </p>
      </div>

    </div>
  );
}
