/**
 * Pipeline → Masters — CRUD screens for the CRM 2.0 master collections:
 * Lenders · Products · Aggregators (the `aggregators` collection — PLAN.md
 * decision 1; UI relabelled "Aggregators" 2026-06-15) · Connectors (the
 * `subDsas` collection — relabelled "Connectors") · Documents · DSA Code
 * Mappings (slab timeline). NOTE: collection keys/field names (`aggregators`,
 * `subDsas`, `connectorId`) are unchanged — only the user-facing labels moved.
 *
 * Reads are live Firestore subscriptions; every mutation goes through
 * /api/crm2/* (clients can never write these collections — rules deny).
 * Generic schema-driven forms keep the five simple masters compact; the
 * mapping editor (slab timeline, end-and-add flow) is purpose-built.
 */
import { useMemo, useState } from 'react';
import { Landmark, Package, Network, FileText, GitBranch, Handshake, Layers, Gauge, Users2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../../components/ui/Toast';
import { apiCrm2, useCrm2Collection } from '../lib';
import { isSuperAdmin } from '../../../config/hrmsConfig';
import { MappingsTab } from './MappingsTab';
import type { Lender, Product, Aggregator, DocumentDef, SubProduct, SubDsa } from '../../../types/crm2';
import { MasterTab, type WithId } from './masterForm';
import { ConnectorsMasterTab } from './ConnectorsMasterTab';
import { PartnerScoringTab } from './PartnerScoringTab';

const STATUS_AI = [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }];


// One-time helper: aggregators historically minted as CONN-### are renamed to
// AGG-### (reference-safe, server-side). Button shows only while a CONN- exists.
function AggregatorMigrationBanner() {
  const { rows } = useCrm2Collection<{ id: string }>('aggregators');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const legacy = rows.filter((r) => /^CONN-/.test(r.id));
  if (legacy.length === 0) return null;
  const run = async () => {
    setBusy(true);
    try {
      const r = await apiCrm2<{ ok: boolean; migrated: unknown[] }>('POST', '/api/crm2/admin/migrate-aggregator-ids', {});
      toast.success(`Renamed ${r.migrated.length} aggregator id(s) to AGG-`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Rename failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3"
      style={{ backgroundColor: 'rgba(201,169,97,0.10)', border: '1px solid rgba(201,169,97,0.3)' }}>
      <span className="text-sm" style={{ color: '#C9A961' }}>
        {legacy.length} aggregator{legacy.length > 1 ? 's' : ''} still use the old <strong>CONN-</strong> code. Rename to <strong>AGG-</strong>?
      </span>
      <button onClick={run} disabled={busy}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
        style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
        {busy ? 'Renaming…' : 'Rename to AGG-'}
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'connectors',     label: 'Connectors', Icon: Handshake },
  { key: 'subDsas',        label: 'Sub DSAs',   Icon: Users2 },
  { key: 'lenders',        label: 'Lenders',    Icon: Landmark },
  { key: 'products',       label: 'Products',   Icon: Package },
  { key: 'subProducts',    label: 'Sub Products', Icon: Layers },
  { key: 'aggregators',    label: 'Aggregators', Icon: Network },
  { key: 'mappings',       label: 'DSA Codes',  Icon: GitBranch },
  { key: 'documentMaster', label: 'Documents',  Icon: FileText },
  { key: 'partnerScoring', label: 'Partner Scoring', Icon: Gauge },
] as const;

export function Crm2MastersPage() {
  const { profile, user } = useAuth();
  const [tab, setTab] = useState<typeof TABS[number]['key']>('connectors');

  const { rows: products } = useCrm2Collection<WithId<Product>>('products');
  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: `${p.name} (${p.shortCode})` })), [products]);
  const { rows: docDefs } = useCrm2Collection<WithId<DocumentDef>>('documentMaster');
  const docOptions = useMemo(
    () => docDefs.map((d) => ({ value: d.id, label: d.name })), [docDefs]);

  // Masters add + view is super-admin only. Lender contacts/login-email etc. are
  // surfaced read-only to RMs/managers inside the case (see LoginsSection).
  const canWrite = isSuperAdmin(user?.uid ?? '', profile);

  if (!canWrite) {
    // NOTHING LOCKED rule: this page is only reachable via direct URL without access.
    return (
      <div className="glass-panel p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        Masters is restricted to <strong>super admins</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          Pipeline Masters
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Connectors, lenders, products, aggregators, DSA code mappings and the document checklist
        </p>
        <div className="mt-2 text-[11px] px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(201,169,97,0.08)', color: 'var(--text-muted)' }}>
          <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>How it fits together:</span>{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>Aggregator</strong> (the company that sends us cases) →{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>Lender</strong> →{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>Product</strong> →{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>Sub-Product</strong> →{' '}
          a <strong style={{ color: 'var(--text-secondary)' }}>DSA code + payout %</strong> (set in “DSA Codes”).{' '}
          A <strong style={{ color: 'var(--text-secondary)' }}>Connector</strong> gives us the file and <em>we</em> do the legwork (small share, paid from our payout).{' '}
          A <strong style={{ color: 'var(--text-secondary)' }}>Sub DSA</strong> works the case <em>themselves</em> and only uses the code (high share).{' '}
          Finvastra itself is a Sub DSA of the Aggregators whose codes we use.
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={tab === key
              ? { backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' }
              : { color: 'var(--text-muted)', border: '1px solid var(--shell-border)' }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'connectors' && <ConnectorsMasterTab />}
      {tab === 'subDsas' && (
        <>
          <MasterTab<WithId<SubDsa>>
            type="subDsas" label="Sub DSAs" noun="Sub DSAs" singular="Sub DSA"
            intro={<>A <strong style={{ color: 'var(--text-secondary)' }}>Sub DSA</strong> works cases <strong style={{ color: 'var(--text-secondary)' }}>on their own</strong> and only uses the code — they get the HIGH payout share (deducted from Finvastra's gross at disbursement). Someone who just refers files while we do the legwork is a <strong style={{ color: 'var(--text-secondary)' }}>Connector</strong>, not a Sub DSA.</>}
            columns={[
              { header: 'Type', render: (r) => r.type.replace(/_/g, ' ') },
              { header: 'Mobile', render: (r) => r.mobile },
              { header: 'Owner', render: (r) => r.relationshipOwner },
              { header: 'TDS %', render: (r) => (r.tdsPct != null ? `${r.tdsPct}%` : '—') },
            ]}
            fields={[
              { key: 'name', label: 'Name', kind: 'text', required: true },
              { key: 'type', label: 'Type', kind: 'select', required: true,
                options: [{ value: 'INDIVIDUAL', label: 'Individual' }, { value: 'CORPORATE', label: 'Corporate' }, { value: 'REFERRAL_CLIENT', label: 'Referral Client' }, { value: 'WALKIN_REFERRER', label: 'Walk-in Referrer' }] },
              { key: 'mobile', label: 'Mobile', kind: 'text', required: true, placeholder: '9876543210' },
              { key: 'email', label: 'Email', kind: 'text' },
              { key: 'city', label: 'City', kind: 'text' },
              { key: 'state', label: 'State', kind: 'text' },
              { key: 'relationshipOwner', label: 'Relationship Owner (FAPL)', kind: 'text', required: true, placeholder: 'FAPL-022',
                hint: 'The Finvastra person who owns this Sub DSA relationship.' },
              { key: 'gstin', label: 'GSTIN', kind: 'text' },
              { key: 'tdsPct', label: 'TDS %', kind: 'number', hint: 'Deducted on their payouts.' },
              { key: 'status', label: 'Status', kind: 'select',
                options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }, { value: 'BLACKLISTED', label: 'Blacklisted' }] },
            ]}
          />
        </>
      )}

      {tab === 'lenders' && (
        <MasterTab<WithId<Lender>>
          type="lenders" label="Lenders"
          columns={[
            { header: 'Type', render: (r) => r.type?.replace('_', ' ') },
            { header: 'Login Email', render: (r) => r.loginEmail || '—' },
            { header: 'Contacts', render: (r) => r.contacts?.length ? `${r.contacts.length} contact${r.contacts.length > 1 ? 's' : ''}` : '—' },
            { header: 'TAT (days)', render: (r) => r.tatBenchmarkDays ?? '—' },
          ]}
          fields={[
            { key: 'name', label: 'Lender Name', kind: 'text', required: true, placeholder: 'Fedbank Financial Services' },
            { key: 'type', label: 'Type', kind: 'select', required: true,
              options: [{ value: 'PSU_BANK', label: 'PSU Bank' }, { value: 'PRIVATE_BANK', label: 'Private Bank' }, { value: 'NBFC', label: 'NBFC' }, { value: 'HFC', label: 'HFC' }] },
            { key: 'productsOffered', label: 'Products Offered', kind: 'multiselect', options: productOptions },
            { key: 'loginEmail', label: 'Login Email', kind: 'text', hint: 'File-submission inbox, e.g. iob0432@iob.in' },
            { key: 'tatBenchmarkDays', label: 'TAT Benchmark (days)', kind: 'number', hint: 'Login → sanction SLA' },
            { key: 'contacts', label: 'Bank SM / ASM Contacts', kind: 'rows',
              rowFields: [
                { key: 'name', label: 'Name' },
                { key: 'role', label: 'Role', kind: 'select', options: [{ value: 'SM', label: 'SM' }, { value: 'ASM', label: 'ASM' }, { value: 'RM', label: 'RM' }, { value: 'OTHER', label: 'Other' }] },
                { key: 'mobile', label: 'Mobile' }, { key: 'email', label: 'Email' }, { key: 'branch', label: 'Branch' },
              ],
              hint: 'Auto-grows from Stage-4 login SM/ASM entries; add manually here too.' },
            { key: 'status', label: 'Status', kind: 'select', options: STATUS_AI },
          ]}
        />
      )}

      {tab === 'products' && (
        <MasterTab<WithId<Product>>
          type="products" label="Products"
          columns={[
            { header: 'Code', render: (r) => r.shortCode },
            { header: 'Vertical', render: (r) => r.vertical },
            { header: 'Category', render: (r) => r.category ?? '—' },
          ]}
          fields={[
            { key: 'name', label: 'Product Name', kind: 'text', required: true, placeholder: 'Loan Against Property' },
            { key: 'shortCode', label: 'Short Code', kind: 'text', required: true, placeholder: 'LAP' },
            { key: 'vertical', label: 'Vertical', kind: 'select', required: true,
              options: [{ value: 'LOANS', label: 'Loans' }, { value: 'WEALTH', label: 'Wealth' }, { value: 'INSURANCE', label: 'Insurance' }, { value: 'CHANNEL_PARTNER', label: 'Channel Partner' }, { value: 'VAS', label: 'VAS' }] },
            { key: 'category', label: 'Lead Category', kind: 'select',
              options: [{ value: '', label: '— none —' }, { value: 'LOAN', label: 'Loan' }, { value: 'WEALTH', label: 'Wealth' }, { value: 'INSURANCE', label: 'Insurance' }, { value: 'CIBIL_CHECK', label: 'CIBIL Check' }, { value: 'PARTNER_DSA', label: 'Partner DSA' }, { value: 'GENERAL', label: 'General' }],
              hint: 'Filters the product list when an agent adds a lead of this category.' },
            { key: 'defaultDocChecklist', label: 'Default Documents', kind: 'multiselect', options: docOptions, hint: 'Auto-attached to the doc tracker for cases on this product' },
            { key: 'defaultRoiRange', label: 'Default ROI Range', kind: 'text', placeholder: '9.5%–12% (display only)' },
            { key: 'status', label: 'Status', kind: 'select', options: STATUS_AI },
          ]}
        />
      )}

      {tab === 'subProducts' && (
        <MasterTab<WithId<SubProduct>>
          type="subProducts" label="Sub Products"
          columns={[
            { header: 'Product', render: (r) => productOptions.find((p) => p.value === r.productId)?.label ?? r.productId },
          ]}
          fields={[
            { key: 'name', label: 'Sub-product Name', kind: 'text', required: true, placeholder: 'Pragati Ashiyana HL' },
            { key: 'productId', label: 'Product', kind: 'select', required: true, options: productOptions,
              hint: 'The product this sub-product belongs to (SubProduct → Product → Lender → DSA code).' },
            { key: 'status', label: 'Status', kind: 'select', options: STATUS_AI },
          ]}
        />
      )}

      {tab === 'aggregators' && <AggregatorMigrationBanner />}
      {tab === 'aggregators' && (
        <MasterTab<WithId<Aggregator>>
          type="aggregators" label="Aggregators"
          columns={[
            { header: 'Type', render: (r) => r.type === 'MASTER_AGGREGATOR' ? 'Master' : 'Sub' },
            { header: 'TDS %', render: (r) => r.standardTdsPct ?? '—' },
            { header: 'Payout', render: (r) => r.payoutFrequency },
          ]}
          fields={[
            { key: 'name', label: 'Aggregator Name', kind: 'text', required: true, placeholder: 'Ruloans' },
            { key: 'type', label: 'Type', kind: 'select', required: true,
              options: [{ value: 'MASTER_AGGREGATOR', label: 'Master Aggregator' }, { value: 'SUB_AGGREGATOR', label: 'Sub Aggregator' }] },
            { key: 'empanelmentDate', label: 'Empanelment Date', kind: 'date' },
            { key: 'contacts', label: 'Phone Contacts', kind: 'rows',
              rowFields: [{ key: 'name', label: 'Name' }, { key: 'dept', label: 'Dept' }, { key: 'mobile', label: 'Mobile' }],
              hint: 'Multiple ops / claims / accounts contacts' },
            { key: 'emails', label: 'Email Contacts', kind: 'rows',
              rowFields: [{ key: 'name', label: 'Name' }, { key: 'dept', label: 'Dept' }, { key: 'email', label: 'Email' }] },
            { key: 'claimsEmail', label: 'Claims Email (primary)', kind: 'text', placeholder: 'needconfirmation@ruloans.vip' },
            { key: 'accountsEmail', label: 'Accounts Email', kind: 'text' },
            { key: 'billingEntityName', label: 'Billing Entity', kind: 'text', hint: 'Entity Finvastra invoices' },
            { key: 'billingGstin', label: 'Billing GSTIN', kind: 'text' },
            { key: 'payoutFrequency', label: 'Payout Frequency', kind: 'select', required: true,
              options: [{ value: 'MONTHLY', label: 'Monthly' }, { value: 'PER_CASE', label: 'Per Case' }] },
            { key: 'standardTdsPct', label: 'Standard TDS %', kind: 'number', required: true },
            { key: 'status', label: 'Status', kind: 'select', options: STATUS_AI },
          ]}
        />
      )}

      {tab === 'mappings' && <MappingsTab productOptions={productOptions} />}
      {tab === 'partnerScoring' && <PartnerScoringTab />}

      {tab === 'documentMaster' && (
        <MasterTab<WithId<DocumentDef>>
          type="documentMaster" label="Documents"
          columns={[
            { header: 'Category', render: (r) => r.category.replace(/_/g, ' ') },
            { header: 'Applies To', render: (r) => r.applicableTo.replace(/_/g, ' ') },
            { header: 'Stage', render: (r) => r.requiredByStage },
            { header: 'Validity', render: (r) => r.validityDays ? `${r.validityDays}d` : '—' },
          ]}
          fields={[
            { key: 'name', label: 'Document Name', kind: 'text', required: true, placeholder: 'GST Certificate' },
            { key: 'category', label: 'Category', kind: 'select', required: true,
              options: [{ value: 'ENTITY_KYC', label: 'Entity KYC' }, { value: 'INDIVIDUAL_KYC', label: 'Individual KYC' }, { value: 'FINANCIALS', label: 'Financials' }, { value: 'PROPERTY', label: 'Property' }, { value: 'POST_SANCTION_PDD', label: 'Post-Sanction / PDD' }] },
            { key: 'applicableTo', label: 'Applies To', kind: 'select', required: true,
              options: [{ value: 'ENTITY', label: 'Entity' }, { value: 'EACH_APPLICANT', label: 'Each Applicant' }, { value: 'GUARANTOR', label: 'Guarantor' }, { value: 'PROPERTY', label: 'Property' }] },
            { key: 'mandatoryForProducts', label: 'Mandatory For Products', kind: 'multiselect', options: productOptions },
            { key: 'validityDays', label: 'Validity (days)', kind: 'number', hint: 'e.g. 30 for bank statements' },
            { key: 'requiredByStage', label: 'Required By Stage', kind: 'select', required: true,
              options: [{ value: 'LOGIN', label: 'Login' }, { value: 'SANCTION', label: 'Sanction' }, { value: 'DISBURSEMENT', label: 'Disbursement' }, { value: 'PDD', label: 'PDD' }] },
            { key: 'status', label: 'Status', kind: 'select', options: STATUS_AI },
          ]}
        />
      )}
    </div>
  );
}
