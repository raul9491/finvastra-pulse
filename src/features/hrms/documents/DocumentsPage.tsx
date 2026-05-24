import { useState } from 'react';
import { FileText, Download, BookOpen, Book, Bell, Loader2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useCompanyDocuments, useMyEmployeeDocuments } from '../hooks/useDocuments';
import type { CompanyDocument, EmployeeDocument, CompanyDocumentCategory, EmployeeDocumentType } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<CompanyDocumentCategory, { label: string; icon: typeof FileText; color: string }> = {
  policy:   { label: 'Policy',   icon: BookOpen, color: '#0B1538' },
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

function CompanyDocCard({ doc: d }: { doc: CompanyDocument }) {
  const meta = CATEGORY_META[d.category];
  const Icon = meta.icon;
  const uploadedDate = toTs(d.uploadedAt);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: meta.color + '15', color: meta.color }}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">{d.title}</p>
          {d.description && <p className="text-xs text-mute mt-0.5 line-clamp-2">{d.description}</p>}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded"
            style={{ backgroundColor: meta.color + '15', color: meta.color }}>
            {meta.label}
          </span>
          {d.financialYear && (
            <span className="text-[10px] text-mute">FY {d.financialYear}</span>
          )}
          {uploadedDate && (
            <span className="text-[10px] text-mute">
              {uploadedDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>
        <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-slate-100"
          style={{ color: '#0B1538' }}>
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
    <div className="flex items-center gap-4 py-3.5 border-b border-slate-50 last:border-0">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: '#0B153815', color: '#0B1538' }}>
        <FileText size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink">{d.title}</p>
        <p className="text-xs text-mute">
          {DOC_TYPE_LABELS[d.documentType]}
          {d.financialYear ? ` · FY ${d.financialYear}` : ''}
          {uploadedDate ? ` · ${uploadedDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
        </p>
      </div>
      <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-slate-100 shrink-0"
        style={{ color: '#0B1538' }}>
        <Download size={13} />
        Download
      </a>
    </div>
  );
}

// ─── DocumentsPage ────────────────────────────────────────────────────────────

export function DocumentsPage() {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const [categoryFilter, setCategoryFilter] = useState<CompanyDocumentCategory | ''>('');

  const { docs: companyDocs, loading: compLoading } = useCompanyDocuments(categoryFilter || undefined);
  const { docs: myDocs, loading: myLoading } = useMyEmployeeDocuments(uid);

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h2 className="text-3xl mb-1"
          style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
          Documents
        </h2>
        <p className="text-sm text-mute">Company policies and your personal documents.</p>
      </div>

      {/* Company Documents */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#475569' }}>Company Documents</h3>
          <div className="flex gap-2">
            {(['', 'policy', 'handbook', 'circular'] as const).map((cat) => (
              <button key={cat}
                onClick={() => setCategoryFilter(cat)}
                className="px-3 py-1 rounded-full text-xs font-semibold transition-colors"
                style={categoryFilter === cat
                  ? { backgroundColor: '#0B1538', color: '#FFFFFF' }
                  : { backgroundColor: '#F2EFE7', color: '#2A2A2A' }}>
                {cat ? CATEGORY_META[cat].label : 'All'}
              </button>
            ))}
          </div>
        </div>

        {compLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-mute" />
          </div>
        ) : companyDocs.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl py-12 text-center">
            <FileText size={36} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm text-mute">No company documents yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {companyDocs.map((d) => <CompanyDocCard key={d.id} doc={d} />)}
          </div>
        )}
      </section>

      {/* My Documents */}
      <section>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: '#475569' }}>My Documents</h3>
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          {myLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-mute" />
            </div>
          ) : myDocs.length === 0 ? (
            <div className="text-center py-8">
              <FileText size={36} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm text-mute">Your documents will appear here once HR uploads them.</p>
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
