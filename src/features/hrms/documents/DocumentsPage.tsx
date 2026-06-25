import { useState } from 'react';
import { format } from 'date-fns';
import { FileText, Download, BookOpen, Book, Bell, Loader2, ShieldCheck, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useCompanyDocuments, useMyEmployeeDocuments } from '../hooks/useDocuments';
import { useMyAcknowledgements, usePendingAcknowledgements, acknowledgeDocument } from '../hooks/useDocumentAcknowledgements';
import type { CompanyDocument, EmployeeDocument, CompanyDocumentCategory, EmployeeDocumentType } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<CompanyDocumentCategory, { label: string; icon: typeof FileText; color: string }> = {
  policy:   { label: 'Policy',   icon: BookOpen, color: 'var(--text-primary)' },
  handbook: { label: 'Handbook', icon: Book,     color: '#C9A961' },
  circular: { label: 'Circular', icon: Bell,     color: '#3B82F6' },
};

const DOC_TYPE_LABELS: Record<EmployeeDocumentType, string> = {
  offer_letter:       'Offer Letter',
  appointment_letter: 'Appointment Letter',
  increment_letter:   'Increment Letter',
  promotion_letter:   'Promotion Letter',
  experience_letter:  'Experience Letter',
  relieving_letter:   'Relieving Letter',
  form_16:            'Form 16',
};

function toTs(ts: any): Date | null {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  return null;
}

// ─── Company Doc Card ─────────────────────────────────────────────────────────

function CompanyDocCard({ doc: d, ackedAt }: { doc: CompanyDocument; ackedAt?: Date | null }) {
  const meta = CATEGORY_META[d.category];
  const Icon = meta.icon;
  const uploadedDate = toTs(d.uploadedAt);

  return (
    <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: meta.color + '15', color: meta.color }}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-(--text-primary)">{d.title}</p>
          {d.description && <p className="text-xs text-(--text-muted) mt-0.5 line-clamp-2">{d.description}</p>}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded"
            style={{ backgroundColor: meta.color + '15', color: meta.color }}>
            {meta.label}
          </span>
          {d.financialYear && (
            <span className="text-[10px] text-(--text-muted)">FY {d.financialYear}</span>
          )}
          {uploadedDate && (
            <span className="text-[10px] text-(--text-muted)">
              {uploadedDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          )}
          {d.requiresAcknowledgement && ackedAt && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ color: '#059669', backgroundColor: '#D1FAE5' }}>
              <CheckCircle2 size={9} />Acknowledged {format(ackedAt, 'd MMM yyyy')}
            </span>
          )}
        </div>
        <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-(--glass-panel-bg)"
          style={{ color: 'var(--text-primary)' }}>
          <Download size={13} />
          Download
        </a>
      </div>
    </div>
  );
}

// ─── Employee Doc Row ─────────────────────────────────────────────────────────

function EmployeeDocRow({ doc: d }: { doc: EmployeeDocument }) {
  const uploadedDate = toTs(d.uploadedAt);

  return (
    <div className="flex items-center gap-4 py-3.5 border-b border-(--shell-border) last:border-0">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: '#0B153815', color: 'var(--text-primary)' }}>
        <FileText size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-(--text-primary)">{d.title}</p>
        <p className="text-xs text-(--text-muted)">
          {DOC_TYPE_LABELS[d.documentType]}
          {d.financialYear ? ` · FY ${d.financialYear}` : ''}
          {uploadedDate ? ` · ${uploadedDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
        </p>
      </div>
      <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-(--glass-panel-bg) shrink-0"
        style={{ color: 'var(--text-primary)' }}>
        <Download size={13} />
        Download
      </a>
    </div>
  );
}

// ─── Acknowledgement Banner ───────────────────────────────────────────────────

function AcknowledgementBanner({
  doc: d,
  employeeId,
  employeeName,
  onAcknowledged,
}: {
  doc: CompanyDocument;
  employeeId: string;
  employeeName: string;
  onAcknowledged: () => void;
}) {
  const [checked,  setChecked]  = useState(false);
  const [saving,   setSaving]   = useState(false);

  const handleAck = async () => {
    if (!checked) return;
    setSaving(true);
    try {
      await acknowledgeDocument({
        documentId:    d.id,
        documentTitle: d.title,
        employeeId,
        employeeName,
      });
      onAcknowledged();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="border-l-4 rounded-xl p-4 space-y-3"
      style={{ borderColor: '#C9A961', backgroundColor: '#FFFBEB' }}>
      <div className="flex items-start gap-3">
        <AlertTriangle size={16} style={{ color: '#D97706' }} className="mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{d.title}</p>
          {d.description && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{d.description}</p>}
          <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1 text-xs font-medium hover:opacity-70"
            style={{ color: 'var(--text-primary)' }}>
            <Download size={11} />Read document
          </a>
        </div>
      </div>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 shrink-0" />
        <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
          I confirm that I have read, understood, and agree to comply with the policies described in this document.
        </span>
      </label>
      <button
        onClick={handleAck}
        disabled={!checked || saving}
        className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg text-white disabled:opacity-40 transition-opacity"
        style={{ backgroundColor: '#059669' }}>
        <ShieldCheck size={13} />
        {saving ? 'Recording…' : 'Submit Acknowledgement'}
      </button>
    </div>
  );
}

// ─── DocumentsPage ────────────────────────────────────────────────────────────

export function DocumentsPage() {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? '';
  const [categoryFilter, setCategoryFilter] = useState<CompanyDocumentCategory | ''>('');
  const [justAcked, setJustAcked] = useState<Set<string>>(new Set());

  const { docs: companyDocs, loading: compLoading } = useCompanyDocuments(categoryFilter || undefined);
  const { docs: myDocs, loading: myLoading } = useMyEmployeeDocuments(uid);
  // Load ALL active company docs (no filter) to cross-reference with acks
  const { docs: allDocs } = useCompanyDocuments(undefined);
  const { pending: pendingAcks, loading: acksLoading } = usePendingAcknowledgements(uid, allDocs);
  const { acks } = useMyAcknowledgements(uid);

  // Pending after filtering out ones just acknowledged this session
  const visiblePending = pendingAcks.filter((d) => !justAcked.has(d.id));

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h2 className="text-3xl mb-1"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          Documents
        </h2>
        <p className="text-sm text-(--text-muted)">Company policies and your personal documents.</p>
      </div>

      {/* ── Pending Acknowledgements ── */}
      {!acksLoading && visiblePending.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} style={{ color: '#D97706' }} />
            <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#D97706' }}>
              Action Required — {visiblePending.length} document{visiblePending.length !== 1 ? 's' : ''} to acknowledge
            </h3>
          </div>
          <div className="space-y-3">
            {visiblePending.map((d) => (
              <AcknowledgementBanner
                key={d.id}
                doc={d}
                employeeId={uid}
                employeeName={profile?.displayName ?? 'Employee'}
                onAcknowledged={() => setJustAcked((s) => new Set([...s, d.id]))}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Recently Acknowledged (confirmation strip) ── */}
      {justAcked.size > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: '#F0FDF4' }}>
          <CheckCircle2 size={15} style={{ color: '#059669' }} />
          <p className="text-xs font-medium" style={{ color: '#065F46' }}>
            {justAcked.size} acknowledgement{justAcked.size !== 1 ? 's' : ''} recorded. Thank you.
          </p>
        </div>
      )}

      {/* Company Documents */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Company Documents</h3>
          <div className="flex gap-2">
            {(['', 'policy', 'handbook', 'circular'] as const).map((cat) => (
              <button key={cat}
                onClick={() => setCategoryFilter(cat)}
                className="px-3 py-1 rounded-full text-xs font-semibold transition-colors"
                style={categoryFilter === cat
                  ? { backgroundColor: '#0B1538', color: '#FFFFFF' }
                  : { backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-secondary)' }}>
                {cat ? CATEGORY_META[cat].label : 'All'}
              </button>
            ))}
          </div>
        </div>

        {compLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-(--text-muted)" />
          </div>
        ) : companyDocs.length === 0 ? (
          <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl py-12 text-center">
            <FileText size={36} className="mx-auto mb-3 text-(--text-muted)" />
            <p className="text-sm text-(--text-muted)">No company documents yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {companyDocs.map((d) => {
              const myAck = acks.find((a) => a.documentId === d.id);
              const ackedAt = myAck?.acknowledgedAt ? toTs(myAck.acknowledgedAt) : null;
              return <CompanyDocCard key={d.id} doc={d} ackedAt={ackedAt} />;
            })}
          </div>
        )}
      </section>

      {/* My Documents */}
      <section>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>My Documents</h3>
        <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl p-6">
          {myLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-(--text-muted)" />
            </div>
          ) : myDocs.length === 0 ? (
            <div className="text-center py-8">
              <FileText size={36} className="mx-auto mb-3 text-(--text-muted)" />
              <p className="text-sm text-(--text-muted)">Your documents will appear here once HR uploads them.</p>
            </div>
          ) : (
            <div>
              {myDocs.map((d) => <EmployeeDocRow key={d.id} doc={d} />)}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
