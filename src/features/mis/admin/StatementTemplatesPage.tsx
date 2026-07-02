import { useEffect, useState } from 'react';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { Loader2, Plus, Pencil, Trash2, CheckCircle2, XCircle, FlaskConical } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useProviders } from '../../crm/hooks/useOpportunities';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useToast } from '../../../components/ui/Toast';
import { userFacingError } from '../../../lib/errors';
import type { StatementTemplate } from '../../../types';

// Standard column names common Indian banks use in commission/transaction statements.
const DEFAULT_TEMPLATES: Array<{ match: string; bankName: string; m: StatementTemplate['columnMappings']; dateFormat: string }> = [
  { match: 'hdfc',  bankName: 'HDFC Bank', dateFormat: 'DD/MM/YYYY', m: { date: 'Transaction Date', description: 'Narration', amount: 'Amount', referenceNumber: 'Reference No' } },
  { match: 'sbi',   bankName: 'SBI',       dateFormat: 'DD/MM/YYYY', m: { date: 'Txn Date', description: 'Description', amount: 'Credit', referenceNumber: 'Ref No' } },
  { match: 'icici', bankName: 'ICICI',     dateFormat: 'DD/MM/YYYY', m: { date: 'Value Date', description: 'Transaction Remarks', amount: 'Deposit Amount', referenceNumber: 'Cheque Number' } },
  { match: 'axis',  bankName: 'Axis',      dateFormat: 'DD/MM/YYYY', m: { date: 'Tran Date', description: 'Particulars', amount: 'CR', referenceNumber: 'Chq No' } },
  { match: 'kotak', bankName: 'Kotak',     dateFormat: 'DD/MM/YYYY', m: { date: 'Transaction Date', description: 'Description', amount: 'Amount', referenceNumber: 'Reference Number' } },
];

const blankForm = (): StatementTemplate => ({
  bankId: '', bankName: '',
  columnMappings: { date: '', description: '', amount: '', referenceNumber: '' },
  dateFormat: 'DD/MM/YYYY', skipRows: 0, amountMultiplier: 1, createdAt: null, updatedAt: null,
});

export function StatementTemplatesPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const providers = useProviders();
  const toast = useToast();

  const [templates, setTemplates] = useState<StatementTemplate[] | null>(null);
  const [editing, setEditing] = useState<StatementTemplate | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [testResult, setTestResult] = useState<{ field: string; col: string; ok: boolean }[] | null>(null);

  useEffect(() => {
    return onSnapshot(collection(db, 'commission_statement_templates'), (snap) => {
      setTemplates(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    }, () => setTemplates([]));
  }, []);

  const providerOptions = providers.map((p) => ({ value: p.id, label: p.name, description: p.type }));

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      const provSnap = await getDocs(collection(db, 'providers'));
      const provs = provSnap.docs.map((d) => ({ id: d.id, name: ((d.data() as any).name ?? '') as string }));
      for (const t of DEFAULT_TEMPLATES) {
        const prov = provs.find((p) => p.name.toLowerCase().includes(t.match));
        const id = prov?.id ?? t.match;            // fall back to slug if no provider matched
        await setDoc(doc(db, 'commission_statement_templates', id), {
          bankId: id, bankName: prov?.name ?? t.bankName,
          columnMappings: t.m, dateFormat: t.dateFormat, skipRows: 0, amountMultiplier: 1,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      toast.success('Common bank templates seeded.', 'Templates seeded');
    } catch (e) {
      toast.error(userFacingError(e, 'Could not seed the default templates.'), 'Seeding failed');
    } finally { setSeeding(false); }
  };

  const save = async (t: StatementTemplate) => {
    if (!t.bankId) return;
    try {
      await setDoc(doc(db, 'commission_statement_templates', t.bankId), {
        bankId: t.bankId, bankName: t.bankName,
        columnMappings: t.columnMappings, dateFormat: t.dateFormat,
        skipRows: Number(t.skipRows) || 0, amountMultiplier: t.amountMultiplier === -1 ? -1 : 1,
        createdAt: t.createdAt ?? serverTimestamp(), updatedAt: serverTimestamp(),
      }, { merge: true });
      setEditing(null);
      toast.success(`Template for ${t.bankName || t.bankId} saved.`, 'Template saved');
    } catch (e) {
      toast.error(userFacingError(e, 'Could not save the template.'), 'Save failed');
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    try {
      await deleteDoc(doc(db, 'commission_statement_templates', id));
      toast.success('Template deleted.');
    } catch (e) {
      toast.error(userFacingError(e, 'Could not delete the template.'), 'Delete failed');
    }
  };

  const testTemplate = (t: StatementTemplate, file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? '');
      const firstLine = text.split(/\r?\n/).slice(t.skipRows).find((l) => l.trim().length > 0) ?? '';
      const headers = firstLine.split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
      const check = (col: string) => !!col && headers.some((h) => h === col.toLowerCase() || h.includes(col.toLowerCase()));
      setTestResult([
        { field: 'Date', col: t.columnMappings.date, ok: check(t.columnMappings.date) },
        { field: 'Description', col: t.columnMappings.description, ok: check(t.columnMappings.description) },
        { field: 'Amount', col: t.columnMappings.amount, ok: check(t.columnMappings.amount) },
      ]);
    };
    reader.readAsText(file);
  };

  if (!isAdmin) return <div className="glass-panel p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Admin access only.</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: 'var(--text-primary)' }}>Statement Templates</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Per-bank column maps so common statements auto-detect on upload.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={seedDefaults} disabled={seeding} className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border disabled:opacity-50" style={{ borderColor: 'var(--shell-border)', color: 'var(--text-primary)' }}>
            {seeding ? <Loader2 size={14} className="animate-spin" /> : null} Seed common banks
          </button>
          <button onClick={() => setEditing(blankForm())} className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg" style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
            <Plus size={14} /> New template
          </button>
        </div>
      </div>

      {templates === null ? (
        <div className="glass-panel p-8 flex justify-center"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
      ) : templates.length === 0 ? (
        <div className="glass-panel p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No templates yet. Seed common banks or create one.</div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="glass-panel p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t.bankName}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  date=<b>{t.columnMappings.date || '?'}</b> · desc=<b>{t.columnMappings.description || '?'}</b> · amt=<b>{t.columnMappings.amount || '?'}</b> · {t.dateFormat} · skip {t.skipRows} · ×{t.amountMultiplier}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <label className="p-1.5 rounded-lg hover:bg-(--shell-hover-mid) cursor-pointer" title="Test with a sample CSV" style={{ color: '#C9A961' }}>
                  <FlaskConical size={14} />
                  <input type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) testTemplate(t, f); }} />
                </label>
                <button onClick={() => setEditing(t)} className="p-1.5 rounded-lg hover:bg-(--shell-hover-mid)" style={{ color: 'var(--shell-text-secondary)' }}><Pencil size={14} /></button>
                <button onClick={() => remove(t.id!)} className="p-1.5 rounded-lg hover:bg-(--shell-hover-mid)" style={{ color: '#f87171' }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {testResult && (
        <div className="glass-panel p-4">
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Template test</p>
          {testResult.map((r) => (
            <p key={r.field} className="text-sm flex items-center gap-2" style={{ color: r.ok ? '#34d399' : '#f87171' }}>
              {r.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {r.field}: "{r.col}" {r.ok ? 'found' : 'NOT found in CSV headers'}
            </p>
          ))}
          <button onClick={() => setTestResult(null)} className="text-xs mt-2 hover:underline" style={{ color: 'var(--text-muted)' }}>Dismiss</button>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setEditing(null)}>
          <div className="glass-modal-panel p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>{editing.createdAt ? 'Edit' : 'New'} template</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Provider (bank)</label>
                <SearchableSelect options={providerOptions} value={editing.bankId}
                  onChange={(v) => { const p = providers.find((x) => x.id === v); setEditing({ ...editing, bankId: v, bankName: p?.name ?? editing.bankName }); }}
                  placeholder="Select provider…" />
              </div>
              {(['date', 'description', 'amount', 'referenceNumber'] as const).map((k) => (
                <div key={k}>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>{k} column name</label>
                  <input className="glass-inp w-full text-sm" value={editing.columnMappings[k] ?? ''}
                    onChange={(e) => setEditing({ ...editing, columnMappings: { ...editing.columnMappings, [k]: e.target.value || (k === 'referenceNumber' ? null : '') } })} />
                </div>
              ))}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Date format</label>
                  <input className="glass-inp w-full text-sm" value={editing.dateFormat} onChange={(e) => setEditing({ ...editing, dateFormat: e.target.value })} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Skip rows</label>
                  <input type="number" min={0} className="glass-inp w-full text-sm" value={editing.skipRows} onChange={(e) => setEditing({ ...editing, skipRows: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Amount ×</label>
                  <select className="glass-inp w-full text-sm" value={editing.amountMultiplier} onChange={(e) => setEditing({ ...editing, amountMultiplier: Number(e.target.value) === -1 ? -1 : 1 })}>
                    <option value={1}>+1</option><option value={-1}>-1</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--shell-border)', color: 'var(--text-primary)' }}>Cancel</button>
              <button onClick={() => save(editing)} disabled={!editing.bankId} className="px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>Save template</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
