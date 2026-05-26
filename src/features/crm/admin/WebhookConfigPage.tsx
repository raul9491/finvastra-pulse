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

const RESULT_COLORS: Record<WebhookLog['result'], { bg: string; text: string; label: string }> = {
  success:   { bg: '#D1FAE5', text: '#065F46', label: 'Success'   },
  duplicate: { bg: '#FEF3C7', text: '#92400E', label: 'Duplicate' },
  invalid:   { bg: '#FEE2E2', text: '#991B1B', label: 'Invalid'   },
  error:     { bg: '#FEE2E2', text: '#991B1B', label: 'Error'     },
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
      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors font-medium shrink-0"
      style={{ color: copied ? '#059669' : '#2A2A2A' }}
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
      <p className="text-sm py-3" style={{ color: '#8B8B85' }}>
        No webhook calls recorded yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-left">
        <thead>
          <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
            {['Time', 'Result', 'Lead ID', 'Notes'].map((h) => (
              <th key={h} className="pb-2 font-bold uppercase tracking-widest whitespace-nowrap pr-4"
                style={{ color: '#8B8B85' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((log) => {
            const rc = RESULT_COLORS[log.result];
            const dt = log.receivedAt ? (() => {
              try { return format(new Date(log.receivedAt), 'dd MMM HH:mm'); } catch { return '—'; }
            })() : '—';
            return (
              <tr key={log.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                <td className="py-2 pr-4 whitespace-nowrap" style={{ color: '#2A2A2A' }}>{dt}</td>
                <td className="py-2 pr-4">
                  <span className="px-2 py-0.5 rounded-full font-semibold text-[10px]"
                    style={{ backgroundColor: rc.bg, color: rc.text }}>
                    {rc.label}
                  </span>
                </td>
                <td className="py-2 pr-4 font-mono" style={{ color: '#8B8B85' }}>
                  {log.leadId ? log.leadId.slice(-8).toUpperCase() : '—'}
                </td>
                <td className="py-2" style={{ color: '#8B8B85', maxWidth: '200px' }}>
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

  if (profile !== null && profile.role !== 'admin') {
    return <Navigate to="/crm/dashboard" replace />;
  }

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

  useEffect(() => { fetchLogs(); }, []);

  // Masked secret helper — shows first 4 chars + ***
  const masked = (label: string) => `${label.slice(0, 4)}${'*'.repeat(label.length - 4 > 0 ? label.length - 4 : 8)}`;

  return (
    <div className="max-w-3xl mx-auto space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#0A0A0A', fontFamily: 'Fraunces, Georgia, serif' }}>
          Webhook Configuration
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8B8B85' }}>
          Configure external sources to push new leads directly into Finvastra Pulse.
          Leads are assigned automatically using workload-aware assignment.
        </p>
      </div>

      {/* ── Website Webhook ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid #F1F5F9' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: '#DBEAFE' }}>
            <Globe size={16} style={{ color: '#1D4ED8' }} />
          </div>
          <div>
            <h2 className="text-sm font-bold" style={{ color: '#0A0A0A' }}>Website Form Webhook</h2>
            <p className="text-xs" style={{ color: '#8B8B85' }}>
              Receives leads from your website contact / loan enquiry form
            </p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Webhook URL */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
              Endpoint URL
            </p>
            <div className="flex items-center gap-2 p-3 rounded-xl"
              style={{ backgroundColor: '#FAFAF7', border: '1px solid #E2E8F0' }}>
              <code className="flex-1 text-xs break-all" style={{ color: '#0B1538' }}>
                {WEBSITE_WEBHOOK_URL}
              </code>
              <CopyButton text={WEBSITE_WEBHOOK_URL} label="URL" />
            </div>
          </div>

          {/* Header */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
              Authentication Header
            </p>
            <div className="p-3 rounded-xl font-mono text-xs space-y-1"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              <div>
                <span style={{ color: '#94A3B8' }}>Header: </span>
                X-Finvastra-Webhook-Secret
              </div>
              <div>
                <span style={{ color: '#94A3B8' }}>Value: </span>
                {masked('WEBSITE_WEBHOOK_SECRET')}
                &nbsp;<span style={{ color: '#475569', fontFamily: 'sans-serif', fontSize: '10px' }}>
                  (set in Cloud Run env — WEBSITE_WEBHOOK_SECRET)
                </span>
              </div>
            </div>
          </div>

          {/* Payload schema */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
              Expected JSON Payload
            </p>
            <pre className="p-3 rounded-xl text-[11px] overflow-x-auto leading-relaxed"
              style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', color: '#334155' }}>
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
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>
                Recent Calls (last 5)
              </p>
              <button onClick={fetchLogs}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                style={{ color: '#8B8B85' }}>
                <RefreshCw size={11} className={logsLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
            {logsLoading ? (
              <div className="space-y-2">
                {[1,2,3].map((i) => (
                  <div key={i} className="h-6 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : logsError ? (
              <p className="text-xs" style={{ color: '#DC2626' }}>{logsError}</p>
            ) : (
              <LogTable logs={logs} source="website" />
            )}
          </div>
        </div>
      </div>

      {/* ── Meta Lead Ads Webhook ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid #F1F5F9' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: '#EDE9FE' }}>
            <Facebook size={16} style={{ color: '#7C3AED' }} />
          </div>
          <div>
            <h2 className="text-sm font-bold" style={{ color: '#0A0A0A' }}>Meta Lead Ads Webhook</h2>
            <p className="text-xs" style={{ color: '#8B8B85' }}>
              Receives leads from Facebook / Instagram Lead Ads forms in real-time
            </p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Webhook URL */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
              Webhook URL
            </p>
            <div className="flex items-center gap-2 p-3 rounded-xl"
              style={{ backgroundColor: '#FAFAF7', border: '1px solid #E2E8F0' }}>
              <code className="flex-1 text-xs break-all" style={{ color: '#0B1538' }}>
                {META_WEBHOOK_URL}
              </code>
              <CopyButton text={META_WEBHOOK_URL} label="URL" />
            </div>
          </div>

          {/* Verify token */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
              Verify Token
            </p>
            <div className="p-3 rounded-xl font-mono text-xs"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              <span style={{ color: '#94A3B8' }}>Value: </span>
              {masked('META_WEBHOOK_SECRET')}
              &nbsp;<span style={{ color: '#475569', fontFamily: 'sans-serif', fontSize: '10px' }}>
                (set in Cloud Run env — META_WEBHOOK_SECRET)
              </span>
            </div>
          </div>

          {/* Setup instructions */}
          <div className="p-4 rounded-xl" style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#92400E' }}>
              Setup Instructions — Meta Business Suite
            </p>
            <ol className="text-xs space-y-1.5 list-decimal list-inside" style={{ color: '#78350F' }}>
              <li>Go to <strong>Meta Business Suite → All Tools → Leads Centre</strong></li>
              <li>Select your Facebook page and click <strong>Instant Forms</strong></li>
              <li>Click <strong>Set up CRM integration</strong></li>
              <li>Choose <strong>Custom integration (webhook)</strong></li>
              <li>Paste the Webhook URL and Verify Token from above</li>
              <li>Click <strong>Verify and Save</strong> — Meta sends a test GET request</li>
              <li>
                Map form fields to these field names in your Instant Form:
                <span className="font-mono ml-1" style={{ color: '#92400E' }}>
                  full_name, phone_number, email, loan_type, loan_amount
                </span>
              </li>
            </ol>
          </div>

          {/* Recent calls */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>
                Recent Calls (last 5)
              </p>
              <button onClick={fetchLogs}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                style={{ color: '#8B8B85' }}>
                <RefreshCw size={11} className={logsLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
            {logsLoading ? (
              <div className="space-y-2">
                {[1,2,3].map((i) => (
                  <div key={i} className="h-6 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : logsError ? (
              <p className="text-xs" style={{ color: '#DC2626' }}>{logsError}</p>
            ) : (
              <LogTable logs={logs} source="social_meta" />
            )}
          </div>
        </div>
      </div>

      {/* ── Cloud Run deployment note ── */}
      <div className="p-5 rounded-2xl" style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
        <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#475569' }}>
          Production Setup — Cloud Run
        </p>
        <pre className="text-[11px] overflow-x-auto" style={{ color: '#334155' }}>
{`gcloud run services update pulse-api \\
  --set-env-vars \\
  "WEBSITE_WEBHOOK_SECRET=<strong-random-secret>,META_WEBHOOK_SECRET=<meta-verify-token>" \\
  --region asia-south1`}
        </pre>
        <p className="text-xs mt-2" style={{ color: '#8B8B85' }}>
          Use a long random string for WEBSITE_WEBHOOK_SECRET (≥32 chars). The META_WEBHOOK_SECRET
          is the same token you enter in Meta Business Suite as the "verify token".
        </p>
      </div>

    </div>
  );
}
