import { useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';

const CATEGORIES = [
  'Bug — something is broken',
  'Access issue',
  'Feature request',
  'Data correction needed',
  'Other',
] as const;

export function HrmsSettingsPage() {
  const { user, profile } = useAuth();
  const [category,    setCategory]    = useState('');
  const [subject,     setSubject]     = useState('');
  const [description, setDescription] = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitted,   setSubmitted]   = useState(false);
  const [error,       setError]       = useState('');

  const canSubmit = !!category && subject.trim().length > 3 && description.trim().length > 10;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !user || !profile) return;
    setSubmitting(true);
    setError('');
    try {
      await addDoc(collection(db, 'support_requests'), {
        submittedBy:      user.uid,
        submittedByName:  profile.displayName,
        submittedByEmail: profile.email,
        employeeId:       profile.employeeId ?? null,
        category,
        subject:          subject.trim(),
        description:      description.trim(),
        status:           'open',
        submittedAt:      serverTimestamp(),
      });

      // Fire-and-forget email — works once Cloud Run server is deployed
      user.getIdToken().then((token) => {
        fetch('/api/support/raise', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ category, subject: subject.trim(), description: description.trim() }),
        }).catch(() => {});
      });

      setSubmitted(true);
    } catch {
      setError('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmitted(false); setCategory(''); setSubject(''); setDescription(''); setError('');
  };

  const inp = 'w-full text-sm px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-navy/10 focus:border-navy transition-colors';

  return (
    <div>
      <h2 className="text-3xl mb-1"
        style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
        Settings
      </h2>
      <p className="mb-8 text-sm" style={{ color: '#8B8B85' }}>
        Raise a support ticket or report an issue to the admin.
      </p>

      <div className="max-w-xl">
        {submitted ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ backgroundColor: '#D1FAE5' }}>
              <CheckCircle2 size={32} style={{ color: '#065F46' }} />
            </div>
            <div>
              <p className="text-lg font-semibold" style={{ color: '#0A0A0A' }}>Ticket submitted</p>
              <p className="text-sm mt-1" style={{ color: '#8B8B85' }}>
                Rahul has been notified and will get back to you.
              </p>
            </div>
            <button onClick={handleReset} className="text-sm underline hover:opacity-70 transition-opacity"
              style={{ color: '#8B8B85' }}>
              Submit another ticket
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h3 className="text-xs font-bold uppercase tracking-widest mb-5"
              style={{ color: '#475569' }}>
              Raise a support ticket
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5"
                  style={{ color: '#8B8B85' }}>
                  Category <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <select className={inp} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">— Select a category —</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5"
                  style={{ color: '#8B8B85' }}>
                  Subject <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  className={inp}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Brief one-line description"
                  maxLength={120}
                  style={{ color: '#0A0A0A' }}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5"
                  style={{ color: '#8B8B85' }}>
                  Details <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <textarea
                  className={`${inp} resize-none`}
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what happened, what you expected, and steps to reproduce if it's a bug…"
                  maxLength={2000}
                  style={{ color: '#0A0A0A' }}
                />
                <p className="text-xs mt-1 text-right" style={{ color: '#8B8B85' }}>
                  {description.length} / 2000
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm" style={{ color: '#DC2626' }}>
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit || submitting}
                className="w-full py-3 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
              >
                {submitting ? 'Submitting…' : 'Submit ticket'}
              </button>
            </form>
          </div>
        )}

        <p className="mt-4 text-xs text-center" style={{ color: '#8B8B85' }}>
          Tickets go directly to Rahul (rahulv@finvastra.com).
        </p>
      </div>
    </div>
  );
}
