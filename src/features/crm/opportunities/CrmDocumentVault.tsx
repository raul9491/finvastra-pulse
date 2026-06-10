/**
 * CrmDocumentVault — Documents tab on OpportunityDetailPage.
 *
 * Any RM with CRM access can upload documents (bank statements, identity proof,
 * ITR scans, sanction letters, etc.) to a loan/wealth/insurance opportunity.
 * Admin and the original uploader can delete.
 *
 * Files land at:  Firebase Storage → crm-documents/{opportunityId}/{uuid}_{name}
 * Audit trail at: Firestore       → /crm_documents/{docId}
 */

import { useState, useRef } from 'react';
import { format } from 'date-fns';
import {
  Paperclip, Upload, Trash2, Download, FileText, FileImage,
  File, ChevronDown, ChevronUp, Loader2, AlertCircle,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import {
  useCrmDocuments, useDocumentTypes,
  uploadCrmDocument, deleteCrmDocument,
} from '../hooks/useCrmDocuments';
import type { CrmDocument } from '../../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fileIcon(contentType: string) {
  if (contentType.startsWith('image/'))      return <FileImage size={16} style={{ color: '#60a5fa' }} />;
  if (contentType === 'application/pdf')     return <FileText  size={16} style={{ color: '#f87171' }} />;
  return <File size={16} style={{ color: 'var(--text-muted)' }} />;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024)         return `${bytes} B`;
  if (bytes < 1024 * 1024)  return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate();
  }
  return null;
}

// ─── Delete confirmation ──────────────────────────────────────────────────────

function DeleteConfirm({ doc: d, onConfirm, onCancel, loading }: {
  doc: CrmDocument;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center glass-modal-overlay">
      <div className="glass-modal-panel p-6 max-w-sm mx-4">
        <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
          Delete document?
        </h3>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          "<strong>{d.originalName}</strong>" will be removed from this opportunity.
          This action cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border hover:bg-(--shell-hover-soft) transition-colors"
            style={{ color: 'var(--text-muted)', borderColor: 'var(--shell-border-mid)' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg disabled:opacity-60 transition-colors btn-glass-danger">
            {loading && <Loader2 size={14} className="animate-spin" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CrmDocumentVault ─────────────────────────────────────────────────────────

interface Props {
  opportunityId: string;
  leadId:        string;
  canWrite:      boolean;
}

export function CrmDocumentVault({ opportunityId, leadId, canWrite }: Props) {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const { documents, loading } = useCrmDocuments(opportunityId);
  const docTypes = useDocumentTypes();

  const [expanded,      setExpanded]      = useState(true);
  const [uploading,     setUploading]     = useState(false);
  const [uploadError,   setUploadError]   = useState('');
  const [selectedType,  setSelectedType]  = useState('');
  const [deleteTarget,  setDeleteTarget]  = useState<CrmDocument | null>(null);
  const [deleting,      setDeleting]      = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadError('');

    // 10 MB hard limit
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File is too large. Maximum size is 10 MB.');
      return;
    }

    setUploading(true);
    try {
      await uploadCrmDocument({
        opportunityId,
        leadId,
        file,
        docTypeId:    selectedType || null,
        uploaderName: profile?.displayName ?? user.uid,
      });
      setSelectedType('');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      // Reset the file input so the same file can be re-uploaded if needed
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !user) return;
    setDeleting(true);
    try {
      await deleteCrmDocument(deleteTarget.id, user.uid);
      setDeleteTarget(null);
    } catch {
      /* soft-delete should not fail */
    } finally {
      setDeleting(false);
    }
  };

  const canDelete = (d: CrmDocument) => isAdmin || d.uploadedBy === user?.uid;

  return (
    <div className="glass-panel">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between p-6 text-left"
      >
        <div className="flex items-center gap-3">
          <Paperclip size={17} style={{ color: '#C9A961' }} />
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Documents
          </span>
          {documents.length > 0 && (
            <span className="badge-glass-info">
              {documents.length}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={16} style={{ color: 'var(--text-muted)' }} />
                  : <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />}
      </button>

      {expanded && (
        <div className="px-6 pb-6 space-y-4 pt-4" style={{ borderTop: '1px solid var(--shell-border)' }}>

          {/* Upload row */}
          {canWrite && (
            <div className="flex items-center gap-3 flex-wrap">
              {/* Doc type selector */}
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="glass-inp text-sm min-w-[180px]"
              >
                <option value="">Select doc type (optional)</option>
                {docTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip"
                className="hidden"
                onChange={handleFileSelect}
                disabled={uploading}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all disabled:opacity-60"
                style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
              >
                {uploading
                  ? <><Loader2 size={14} className="animate-spin" /> Uploading…</>
                  : <><Upload size={14} /> Upload File</>
                }
              </button>
            </div>
          )}

          {/* Error banner */}
          {uploadError && (
            <div className="flex items-center gap-2 p-3 rounded-lg text-sm"
              style={{ backgroundColor: 'rgba(248,113,113,0.10)', color: '#f87171', border: '1px solid rgba(248,113,113,0.20)' }}>
              <AlertCircle size={14} />
              {uploadError}
            </div>
          )}

          {/* Document list */}
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              <Loader2 size={14} className="animate-spin" /> Loading documents…
            </div>
          ) : documents.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
              No documents attached yet.
              {canWrite && ' Use the upload button above to add files.'}
            </p>
          ) : (
            <div className="space-y-2">
              {documents.map((d) => {
                const uploadedDate = toDate(d.uploadedAt);
                const typeName     = d.docTypeId
                  ? docTypes.find((t) => t.id === d.docTypeId)?.label
                  : null;
                return (
                  <div
                    key={d.id}
                    className="flex items-center gap-3 p-3 rounded-xl transition-colors hover:bg-(--shell-hover-soft)"
                    style={{ border: '1px solid var(--shell-border)' }}
                  >
                    {/* File icon */}
                    <div className="shrink-0">
                      {fileIcon(d.contentType)}
                    </div>

                    {/* Name + meta */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {d.originalName}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                        {typeName && (
                          <span className="badge-glass-info text-[11px]">
                            {typeName}
                          </span>
                        )}
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {fmtSize(d.fileSize)}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {d.uploadedByName}
                        </span>
                        {uploadedDate && (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {format(uploadedDate, 'dd MMM yyyy')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <a
                        href={d.storageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg hover:bg-(--shell-hover-soft) transition-colors"
                        title="Download / View"
                      >
                        <Download size={15} style={{ color: 'var(--text-muted)' }} />
                      </a>
                      {canDelete(d) && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(d)}
                          className="p-1.5 rounded-lg hover:bg-(--shell-hover-soft) transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={15} style={{ color: '#f87171' }} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* File format note */}
          {canWrite && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Accepted: PDF, Word, Excel, PNG/JPG, ZIP · Max 10 MB per file
            </p>
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <DeleteConfirm
          doc={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          loading={deleting}
        />
      )}
    </div>
  );
}
