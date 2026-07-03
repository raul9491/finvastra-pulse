/**
 * Admin seed / setup tools — moved verbatim from the retired CrmDashboardPage
 * (2026-07-03). Rendered at the bottom of the admin Business Pulse home inside
 * a collapsed <details> so they stay reachable without cluttering the page.
 * seedCrmConfig() is idempotent — safe to run multiple times.
 */
import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { seedCrmConfig } from '../config/seedCrmConfig';
import { migrateLeads } from '../config/migrate';
import { createSlab } from '../hooks/useCommissionSlabs';
import { seedDocumentTypes } from '../config/seedDocumentTypes';
import { auth as firebaseAuth } from '../../../lib/firebase';

export function SeedTools() {
  return (
    <details className="glass-panel px-5 py-4">
      <summary className="text-xs font-bold uppercase tracking-widest cursor-pointer select-none" style={{ color: 'var(--text-muted)' }}>
        Setup &amp; seed tools (admin)
      </summary>
      <div className="mt-4 space-y-4">
        <CrmSetupPanel />
        {import.meta.env.DEV && <DevAdminTools />}
      </div>
    </details>
  );
}

function CrmSetupPanel() {
  const [status, setStatus] = useState<string>('');
  const [running, setRunning] = useState(false);

  const handleSeed = async () => {
    if (!window.confirm('This will seed CRM product types, providers, and document types into Firestore. Safe to run multiple times. Continue?')) return;
    setRunning(true);
    setStatus('Seeding…');
    try {
      const r = await seedCrmConfig();
      if (r.typed === 0 && r.providers === 0 && r.documentTypes === 0) {
        setStatus('Already set up — no changes needed.');
      } else {
        setStatus(`Done! ${r.typed} product types · ${r.providers} providers · ${r.documentTypes} document types added.`);
      }
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
            CRM Setup
          </h3>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Seeds product types (Loan / Wealth / Insurance), bank providers, and document types.
            Run this once after first deployment. Safe to run again — no duplicates created.
          </p>
        </div>
        <button
          onClick={handleSeed}
          disabled={running}
          className="shrink-0 px-5 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
        >
          {running ? 'Running…' : 'Seed CRM Config'}
        </button>
      </div>
      {status && (
        <p className="text-sm" style={{ color: status.startsWith('Error') ? '#f87171' : '#34d399' }}>
          {status}
        </p>
      )}
    </div>
  );
}

const SAMPLE_SLABS = [
  { providerId: 'HDFC_PLACEHOLDER', product: 'Home Loan',     minTicket: 0,       maxTicket: 5000000,  percentage: 0.5,  basisOn: 'disbursed' as const, notes: 'SAMPLE' },
  { providerId: 'HDFC_PLACEHOLDER', product: 'Home Loan',     minTicket: 5000001, maxTicket: null,     percentage: 0.4,  basisOn: 'disbursed' as const, notes: 'SAMPLE' },
  { providerId: 'HDFC_PLACEHOLDER', product: 'Personal Loan', minTicket: 0,       maxTicket: 2500000,  percentage: 1.0,  basisOn: 'disbursed' as const, notes: 'SAMPLE' },
  { providerId: 'ICICI_PLACEHOLDER',product: 'Home Loan',     minTicket: 0,       maxTicket: 7500000,  percentage: 0.4,  basisOn: 'disbursed' as const, notes: 'SAMPLE' },
  { providerId: 'ICICI_PLACEHOLDER',product: 'Personal Loan', minTicket: 0,       maxTicket: null,     percentage: 0.75, basisOn: 'disbursed' as const, notes: 'SAMPLE' },
];

function DevAdminTools() {
  const { profile } = useAuth();
  const uid = profile?.userId ?? '';
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setStatuses((p) => ({ ...p, [k]: v }));

  return (
    <div className="space-y-5">
      <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Admin Setup (dev only)</h3>
      {[
        {
          key: 'seed', label: '1. Seed CRM Config',
          desc: 'Creates opportunity types + providers + document types.',
          btn: 'Seed Config Data',
          fn: async () => {
            set('seed', 'Seeding…');
            try {
              const r = await seedCrmConfig();
              set('seed', r.typed === 0 && r.providers === 0 ? 'Already seeded.' : `Done. ${r.typed} types + ${r.providers} providers.`);
            } catch (e) { set('seed', `Error: ${e instanceof Error ? e.message : String(e)}`); }
          },
        },
        {
          key: 'migrate', label: '2. Migrate Legacy Leads',
          desc: 'Converts Phase 2.1 leads to Lead-Opportunity model.',
          btn: 'Migrate Leads',
          fn: async () => {
            set('migrate', 'Migrating…');
            try {
              const r = await migrateLeads();
              set('migrate', r.migrated === 0 ? 'No leads to migrate.' : `Done. ${r.migrated} migrated.`);
            } catch (e) { set('migrate', `Error: ${e instanceof Error ? e.message : String(e)}`); }
          },
        },
        {
          key: 'slabs', label: '3. Seed Sample Slabs (testing only)',
          desc: 'Creates SAMPLE slabs with placeholder provider IDs.',
          btn: 'Seed Sample Slabs',
          fn: async () => {
            set('slabs', 'Seeding…');
            try {
              let n = 0;
              for (const s of SAMPLE_SLABS) { await createSlab({ ...s, active: true, effectiveFrom: '2026-01-01', effectiveTo: null }, uid); n++; }
              set('slabs', `Done. ${n} slabs. Edit provider IDs in Emulator UI.`);
            } catch (e) { set('slabs', `Error: ${e instanceof Error ? e.message : String(e)}`); }
          },
        },
        {
          key: 'doctypes', label: '4. Seed Document Types',
          desc: 'Seeds the /document_types collection.',
          btn: 'Seed Document Types',
          fn: async () => {
            set('doctypes', 'Seeding…');
            try {
              const n = await seedDocumentTypes();
              set('doctypes', n === 0 ? 'Already seeded.' : `Done. ${n} types.`);
            } catch (e) { set('doctypes', `Error: ${e instanceof Error ? e.message : String(e)}`); }
          },
        },
        {
          key: 'pan', label: '5. Migrate PAN Encryption',
          desc: 'Encrypts all plaintext panRaw fields. Requires PAN_ENCRYPTION_KEY.',
          btn: 'Run PAN Migration',
          fn: async () => {
            set('pan', 'Running…');
            try {
              const token = await firebaseAuth.currentUser?.getIdToken();
              const res = await fetch('/api/admin/migrate-pan-encryption', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              });
              const d = await res.json() as { migrated?: number; skipped?: number; failed?: number; error?: string };
              if (!res.ok) throw new Error(d.error ?? 'Failed');
              set('pan', `Done. Migrated: ${d.migrated ?? 0}, Skipped: ${d.skipped ?? 0}, Failed: ${d.failed ?? 0}`);
            } catch (e) { set('pan', `Error: ${e instanceof Error ? e.message : String(e)}`); }
          },
        },
      ].map(({ key, label, desc, btn, fn }) => (
        <div key={key}>
          <p className="text-sm font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>{label}</p>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{desc}</p>
          <button onClick={fn}
            className="px-5 py-2 rounded-lg text-sm font-semibold border hover:bg-(--shell-hover-soft) transition-colors"
            style={{ color: 'var(--text-muted)', borderColor: 'var(--shell-border-mid)' }}>
            {btn}
          </button>
          {statuses[key] && (
            <p className="mt-1.5 text-sm"
              style={{ color: statuses[key].startsWith('Error') ? '#f87171' : '#34d399' }}>
              {statuses[key]}
            </p>
          )}
          <hr className="mt-4" style={{ borderColor: 'var(--shell-border)' }} />
        </div>
      ))}
    </div>
  );
}
