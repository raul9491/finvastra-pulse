import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { db } from '../../../lib/firebase';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';

interface DocTypeRow {
  id: string;
  label: string;
  expiryDays: number | null;
}

interface RowState {
  draft: string;      // string representation of the input (number or "")
  neverExpires: boolean;
  saving: boolean;
  saved: boolean;
  error: string;
}

export function DocumentTypesPage() {
  const { profile } = useAuth();
  const [docTypes, setDocTypes] = useState<DocTypeRow[]>([]);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(true);

  // Admin guard
  if (profile && profile.role !== 'admin') {
    return <Navigate to="/crm/dashboard" replace />;
  }

  useEffect(() => {
    return onSnapshot(collection(db, 'document_types'), (snap) => {
      const rows: DocTypeRow[] = snap.docs
        .map(d => {
          const data = d.data();
          return {
            id: d.id,
            label: (data.label as string) ?? d.id,
            expiryDays: typeof data.expiryDays === 'number' ? data.expiryDays : null,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label));

      setDocTypes(rows);

      // Initialise row states for new rows only (avoid overwriting in-flight edits)
      setRowStates(prev => {
        const next = { ...prev };
        for (const row of rows) {
          if (!next[row.id]) {
            next[row.id] = {
              draft: row.expiryDays !== null ? String(row.expiryDays) : '',
              neverExpires: row.expiryDays === null,
              saving: false,
              saved: false,
              error: '',
            };
          }
        }
        return next;
      });

      setLoading(false);
    });
  }, []);

  function setField<K extends keyof RowState>(id: string, key: K, value: RowState[K]) {
    setRowStates(prev => ({
      ...prev,
      [id]: { ...prev[id], [key]: value },
    }));
  }

  async function handleSave(row: DocTypeRow) {
    const state = rowStates[row.id];
    if (!state) return;

    let newValue: number | null;
    if (state.neverExpires) {
      newValue = null;
    } else {
      const parsed = parseInt(state.draft, 10);
      if (isNaN(parsed) || parsed < 1) {
        setField(row.id, 'error', 'Enter a positive number of days, or toggle Never Expires.');
        return;
      }
      newValue = parsed;
    }

    setField(row.id, 'saving', true);
    setField(row.id, 'error', '');

    try {
      await updateDoc(doc(db, 'document_types', row.id), { expiryDays: newValue });
      setRowStates(prev => ({
        ...prev,
        [row.id]: { ...prev[row.id], saving: false, saved: true, error: '' },
      }));
      // Clear the "Saved" confirmation after 2 s
      setTimeout(() => setField(row.id, 'saved', false), 2000);
    } catch (e) {
      setRowStates(prev => ({
        ...prev,
        [row.id]: {
          ...prev[row.id],
          saving: false,
          error: e instanceof Error ? e.message : 'Save failed',
        },
      }));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading document types…</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2
          className="text-3xl mb-1"
          style={{
            fontFamily: '"Fraunces", Georgia, serif',
            fontStyle: 'italic',
            fontWeight: 300,
            color: 'var(--text-primary)',
          }}
        >
          Document Types
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Configure expiry windows for each document type. Expired documents are automatically flagged on submissions.
        </p>
      </div>

      <div className="glass-panel overflow-hidden">
        {/* Table header */}
        <div
          className="grid grid-cols-[1fr_160px_140px_120px] gap-4 px-6 py-3"
          style={{ backgroundColor: 'var(--shell-hover-soft)', borderBottom: '1px solid var(--shell-border)' }}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Document Type
          </p>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Expiry (Days)
          </p>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Never Expires
          </p>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Action
          </p>
        </div>

        {/* Table rows */}
        {docTypes.map((row) => {
          const state = rowStates[row.id];
          if (!state) return null;

          return (
            <div
              key={row.id}
              className="grid grid-cols-[1fr_160px_140px_120px] gap-4 items-center px-6 py-4 hover:bg-(--shell-hover-soft) transition-colors"
              style={{ borderBottom: '1px solid var(--shell-border)' }}
            >
              {/* Label */}
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {row.label}
                </p>
                <p className="text-[10px] mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>
                  {row.id}
                </p>
              </div>

              {/* Expiry days input */}
              <div>
                <input
                  type="number"
                  min={1}
                  disabled={state.neverExpires || state.saving}
                  value={state.neverExpires ? '' : state.draft}
                  placeholder={state.neverExpires ? '—' : 'e.g. 90'}
                  onChange={e => {
                    setField(row.id, 'draft', e.target.value);
                    setField(row.id, 'saved', false);
                  }}
                  className="glass-inp w-full text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                />
              </div>

              {/* Never expires toggle */}
              <div className="flex items-center">
                <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--text-primary)' }}>
                  <input
                    type="checkbox"
                    checked={state.neverExpires}
                    disabled={state.saving}
                    onChange={e => {
                      setField(row.id, 'neverExpires', e.target.checked);
                      setField(row.id, 'saved', false);
                      if (e.target.checked) setField(row.id, 'error', '');
                    }}
                    className="w-4 h-4 rounded"
                  />
                  Never
                </label>
              </div>

              {/* Save button + feedback */}
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => handleSave(row)}
                  disabled={state.saving}
                  className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-40"
                  style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
                >
                  {state.saving ? 'Saving…' : state.saved ? 'Saved ✓' : 'Save'}
                </button>
                {state.error && (
                  <p className="text-[10px]" style={{ color: '#f87171' }}>
                    {state.error}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
        {docTypes.length} document types · Expiry is calculated from the date a document was marked as
        <em> collected</em>. The daily server job flags documents past their window.
      </p>
    </div>
  );
}
