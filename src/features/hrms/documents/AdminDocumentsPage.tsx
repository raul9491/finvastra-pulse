import { useState, useRef } from 'react';
import { format } from 'date-fns';
import { Upload, Trash2, FileText, PlusCircle, X, ShieldCheck, Users, CheckCircle2, ToggleLeft, ToggleRight, ChevronRight } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import {
  useAllCompanyDocuments, useEmployeeDocuments,
  addCompanyDocument, deactivateCompanyDocument,
  addEmployeeDocument, deactivateEmployeeDocument,
  uploadFileToStorage,
} from '../hooks/useDocuments';
import { useDocumentAcknowledgements, useAcknowledgementCountMap } from '../hooks/useDocumentAcknowledgements';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import type { CompanyDocumentCategory, EmployeeDocumentType, CompanyDocument } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COMPANY_CATEGORIES: { value: CompanyDocumentCategory; label: string }[] = [
  { value: 'policy',   label: 'Policy' },
  { value: 'handbook', label: 'Handbook' },
  { value: 'circular', label: 'Circular' },
];

const EMP_DOC_TYPES: { value: EmployeeDocumentType; label: string }[] = [
  { value: 'offer_letter',       label: 'Offer Letter' },
  { value: 'appointment_letter', label: 'Appointment Letter' },
  { value: 'increment_letter',   label: 'Increment Letter' },
  { value: 'promotion_letter',   label: 'Promotion Letter' },
  { value: 'experience_letter',  label: 'Experience Letter' },
  { value: 'relieving_letter',   label: 'Relieving Letter' },
  { value: 'form_16',            label: 'Form 16' },
];

function toTs(ts: any): Date | null {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  return null;
}

const inp = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-navy/10 focus:border-navy';

// ─── Upload Company Doc Modal ──────────────────────────────────────────────────

function UploadCompanyDocModal({ uploadedBy, onClose }: { uploadedBy: string; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<CompanyDocumentCategory>('policy');
  const [description, setDescription] = useState('');
  const [fy, setFy] = useState('');
  const [requiresAck, setRequiresAck] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !file) { setError('Title and file are required.'); return; }
    setUploading(true); setError('');
    try {
      const path = `company-docs/${category}/${Date.now()}-${file.name}`;
      const fileUrl = await uploadFileToStorage(file, path, setProgress);
      await addCompanyDocument({
        title: title.trim(),
        category,
        description: description.trim(),
        fileUrl,
        uploadedBy,
        financialYear: fy.trim() || null,
        requiresAcknowledgement: requiresAck || undefined,
      });
      onClose();
    } catch {
      setError('Upload failed. Please try again.');
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">Upload Company Document</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={18} style={{ color: '#8B8B85' }} /></button>
        </div>
        <form onSubmit={handleUpload} className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Title *</label>
            <input className={inp} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Document title" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Category</label>
            <select className={inp} value={category} onChange={(e) => setCategory(e.target.value as CompanyDocumentCategory)}>
              {COMPANY_CATEGORIES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Description</label>
            <textarea className={`${inp} resize-none`} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Financial Year</label>
            <input className={inp} value={fy} onChange={(e) => setFy(e.target.value)} placeholder="2025-26" />
          </div>
          {/* Requires Acknowledgement toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200">
            <div>
              <p className="text-sm font-medium text-ink">Requires Acknowledgement</p>
              <p className="text-xs text-mute mt-0.5">Employees must digitally confirm they've read this</p>
            </div>
            <button type="button" onClick={() => setRequiresAck((v) => !v)}
              className="shrink-0 transition-colors"
              style={{ color: requiresAck ? '#059669' : '#94A3B8' }}>
              {requiresAck ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
            </button>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>File * (PDF / DOCX)</label>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-200 rounded-xl py-4 text-sm text-mute hover:border-slate-300 transition-colors flex items-center justify-center gap-2">
              <Upload size={16} />
              {file ? file.name : 'Choose file'}
            </button>
            {uploading && (
              <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: '#C9A961' }} />
              </div>
            )}
          </div>
          {error && <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={uploading}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              {uploading ? `Uploading ${progress}%…` : 'Upload'}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm border border-slate-200 hover:bg-slate-50">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Upload Employee Doc Modal ─────────────────────────────────────────────────

function UploadEmployeeDocModal({ uploadedBy, employeeId, onClose }: { uploadedBy: string; employeeId: string; onClose: () => void }) {
  const [docType, setDocType] = useState<EmployeeDocumentType>('offer_letter');
  const [title, setTitle] = useState('');
  const [fy, setFy] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !file) { setError('Title and file are required.'); return; }
    setUploading(true); setError('');
    try {
      const path = `employee-docs/${employeeId}/${docType}/${Date.now()}-${file.name}`;
      const fileUrl = await uploadFileToStorage(file, path, setProgress);
      await addEmployeeDocument({
        employeeId,
        documentType: docType,
        title: title.trim(),
        fileUrl,
        uploadedBy,
        financialYear: fy.trim() || null,
      });
      onClose();
    } catch {
      setError('Upload failed. Please try again.');
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">Upload Employee Document</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={18} style={{ color: '#8B8B85' }} /></button>
        </div>
        <form onSubmit={handleUpload} className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Document Type</label>
            <select className={inp} value={docType} onChange={(e) => setDocType(e.target.value as EmployeeDocumentType)}>
              {EMP_DOC_TYPES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Title *</label>
            <input className={inp} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Increment Letter — May 2026" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Financial Year</label>
            <input className={inp} value={fy} onChange={(e) => setFy(e.target.value)} placeholder="2025-26" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>File * (PDF / DOCX)</label>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-200 rounded-xl py-4 text-sm text-mute hover:border-slate-300 transition-colors flex items-center justify-center gap-2">
              <Upload size={16} />
              {file ? file.name : 'Choose file'}
            </button>
            {uploading && (
              <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: '#C9A961' }} />
              </div>
            )}
          </div>
          {error && <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={uploading}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              {uploading ? `Uploading ${progress}%…` : 'Upload'}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm border border-slate-200 hover:bg-slate-50">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Acknowledgement Detail Modal ─────────────────────────────────────────────

function AcknowledgementDetailModal({
  doc: d,
  employees,
  onClose,
}: {
  doc: CompanyDocument;
  employees: { userId: string; displayName: string; department?: string }[];
  onClose: () => void;
}) {
  const { acks, loading } = useDocumentAcknowledgements(d.id);
  const ackedSet = new Set(acks.map((a) => a.employeeId));
  const notAcked = employees.filter((e) => !ackedSet.has(e.userId));
  const ackedList = employees.filter((e) => ackedSet.has(e.userId));

  function toTs(ts: any): Date | null {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate();
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="text-base font-semibold text-ink">{d.title}</h3>
            <p className="text-xs text-mute mt-0.5">Acknowledgement Status</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={18} style={{ color: '#8B8B85' }} /></button>
        </div>

        {/* Summary strip */}
        <div className="flex gap-4 px-5 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} style={{ color: '#059669' }} />
            <span className="text-sm font-semibold" style={{ color: '#059669' }}>{ackedList.length} Acknowledged</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} style={{ color: '#D97706' }} />
            <span className="text-sm font-semibold" style={{ color: '#D97706' }}>{notAcked.length} Pending</span>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-5 h-5 border-2 border-slate-200 border-t-navy rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {notAcked.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#D97706' }}>
                  Pending ({notAcked.length})
                </p>
                <div className="space-y-2">
                  {notAcked.map((e) => (
                    <div key={e.userId} className="flex items-center gap-3 p-2.5 rounded-xl bg-amber-50">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
                        {e.displayName[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink truncate">{e.displayName}</p>
                        {e.department && <p className="text-xs text-mute">{e.department}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {ackedList.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#059669' }}>
                  Acknowledged ({ackedList.length})
                </p>
                <div className="space-y-2">
                  {ackedList.map((e) => {
                    const ack = acks.find((a) => a.employeeId === e.userId);
                    const ackedAt = ack ? toTs(ack.acknowledgedAt) : null;
                    return (
                      <div key={e.userId} className="flex items-center gap-3 p-2.5 rounded-xl bg-green-50">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                          style={{ backgroundColor: '#D1FAE5', color: '#059669' }}>
                          {e.displayName[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ink truncate">{e.displayName}</p>
                          {ackedAt && <p className="text-xs text-mute">{format(ackedAt, 'd MMM yyyy, HH:mm')}</p>}
                        </div>
                        <CheckCircle2 size={14} style={{ color: '#059669' }} className="shrink-0" />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {notAcked.length === 0 && ackedList.length === 0 && (
              <p className="text-sm text-mute text-center py-6">No active employees found.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AdminDocumentsPage ───────────────────────────────────────────────────────

export function AdminDocumentsPage() {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const [tab, setTab] = useState<'company' | 'employee'>('company');
  const [selectedEmp, setSelectedEmp] = useState('');
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [showEmpModal, setShowEmpModal] = useState(false);
  const [ackDetailDoc, setAckDetailDoc] = useState<CompanyDocument | null>(null);

  const { docs: companyDocs, loading: compLoading } = useAllCompanyDocuments();
  const { docs: empDocs, loading: empLoading } = useEmployeeDocuments(selectedEmp);
  const { employees } = useAllEmployees();
  const ackCountMap = useAcknowledgementCountMap(true);
  const activeEmployees = employees.filter((e) => e.employeeStatus === 'active' || !e.employeeStatus);

  const employeeOptions = employees.map((e) => ({ value: e.userId, label: e.displayName }));

  const handleDeleteCompany = async (id: string) => {
    if (!confirm('Deactivate this document? Employees will no longer see it.')) return;
    await deactivateCompanyDocument(id);
  };
  const handleDeleteEmp = async (id: string) => {
    if (!confirm('Deactivate this document? The employee will no longer see it.')) return;
    await deactivateEmployeeDocument(id);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl mb-1"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
            Documents — Admin
          </h2>
          <p className="text-sm text-mute">Manage company policies and employee documents.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(['company', 'employee'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            style={tab === t ? { backgroundColor: '#0B1538', color: '#FFFFFF' } : { backgroundColor: '#F2EFE7', color: '#2A2A2A' }}>
            {t === 'company' ? 'Company Documents' : 'Employee Documents'}
          </button>
        ))}
      </div>

      {tab === 'company' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowCompanyModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
              <PlusCircle size={16} /> Upload Document
            </button>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {compLoading ? (
              <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />)}</div>
            ) : companyDocs.length === 0 ? (
              <div className="py-12 text-center"><p className="text-sm text-mute">No company documents yet.</p></div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-mute">Title</th>
                    <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-mute">Category</th>
                    <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-mute">Uploaded</th>
                    <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-mute">Acknowledgements</th>
                    <th className="text-center p-4 text-[10px] font-bold uppercase tracking-widest text-mute">Active</th>
                    <th className="p-4" />
                  </tr>
                </thead>
                <tbody>
                  {companyDocs.map((d) => {
                    const uploadedDate = toTs(d.uploadedAt);
                    const ackedCount = ackCountMap[d.id] ?? 0;
                    const totalActive = activeEmployees.length;
                    return (
                      <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                        <td className="p-4 font-medium text-ink">{d.title}</td>
                        <td className="p-4 text-mute capitalize">{d.category}</td>
                        <td className="p-4 text-mute">{uploadedDate ? format(uploadedDate, 'dd MMM yyyy') : '—'}</td>
                        <td className="p-4">
                          {d.requiresAcknowledgement ? (
                            <button
                              onClick={() => setAckDetailDoc(d)}
                              className="flex items-center gap-1.5 group"
                            >
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ackedCount >= totalActive ? 'text-green-700 bg-green-50' : 'text-amber-700 bg-amber-50'}`}>
                                {ackedCount}/{totalActive}
                              </span>
                              <ChevronRight size={12} style={{ color: '#94A3B8' }} className="group-hover:text-ink transition-colors" />
                            </button>
                          ) : (
                            <span className="text-xs text-mute">—</span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${d.isActive ? 'text-green-700 bg-green-50' : 'text-mute bg-slate-100'}`}>
                            {d.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="p-4">
                          {d.isActive && (
                            <button onClick={() => handleDeleteCompany(d.id)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                              <Trash2 size={14} style={{ color: '#DC2626' }} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'employee' && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-64">
              <SearchableSelect
                options={employeeOptions}
                value={selectedEmp}
                onChange={setSelectedEmp}
                placeholder="Select employee…"
              />
            </div>
            {selectedEmp && (
              <button onClick={() => setShowEmpModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                <PlusCircle size={16} /> Upload Document
              </button>
            )}
          </div>

          {!selectedEmp ? (
            <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
              <FileText size={36} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm text-mute">Select an employee to view their documents.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              {empLoading ? (
                <div className="p-6 space-y-3">{[1,2].map(i => <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />)}</div>
              ) : empDocs.length === 0 ? (
                <div className="py-12 text-center"><p className="text-sm text-mute">No documents uploaded for this employee.</p></div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-mute">Title</th>
                      <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-mute">Type</th>
                      <th className="text-left p-4 text-[10px] font-bold uppercase tracking-widest text-mute">Uploaded</th>
                      <th className="p-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {empDocs.map((d) => {
                      const uploadedDate = toTs(d.uploadedAt);
                      const typeLabel = EMP_DOC_TYPES.find(t => t.value === d.documentType)?.label ?? d.documentType;
                      return (
                        <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                          <td className="p-4 font-medium text-ink">{d.title}</td>
                          <td className="p-4 text-mute">{typeLabel}</td>
                          <td className="p-4 text-mute">{uploadedDate ? format(uploadedDate, 'dd MMM yyyy') : '—'}</td>
                          <td className="p-4">
                            {d.isActive && (
                              <button onClick={() => handleDeleteEmp(d.id)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                                <Trash2 size={14} style={{ color: '#DC2626' }} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {showCompanyModal && uid && (
        <UploadCompanyDocModal uploadedBy={uid} onClose={() => setShowCompanyModal(false)} />
      )}
      {showEmpModal && uid && selectedEmp && (
        <UploadEmployeeDocModal uploadedBy={uid} employeeId={selectedEmp} onClose={() => setShowEmpModal(false)} />
      )}
      {ackDetailDoc && (
        <AcknowledgementDetailModal
          doc={ackDetailDoc}
          employees={activeEmployees}
          onClose={() => setAckDetailDoc(null)}
        />
      )}
    </div>
  );
}
