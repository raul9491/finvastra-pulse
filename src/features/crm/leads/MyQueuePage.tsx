import { useAuth } from '../../auth/AuthContext';
import { useMyLeads } from '../hooks/useMyLeads';
import { MyQueueRow } from './MyQueueRow';

export function MyQueuePage() {
  const { user, profile } = useAuth();
  const isGenerator = profile?.crmRole === 'lead_generator';
  const isAdmin     = profile?.role === 'admin';

  // Always call the hook — skip logic handled by userId being empty
  const { leads, overdue, urgent, total, loading, error } = useMyLeads(
    isGenerator || isAdmin ? (user?.uid ?? '') : '',
  );

  // Access guard
  if (!isGenerator && !isAdmin) {
    return (
      <div className="max-w-lg mx-auto py-20 text-center space-y-3">
        <p className="text-base font-semibold" style={{ color: '#0A0A0A' }}>Access Denied</p>
        <p className="text-sm" style={{ color: '#8B8B85' }}>
          My Queue is only available to Lead Generators.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* ─── Header ───────────────────────────────────────────────────────── */}
      <div>
        <h1
          className="text-3xl"
          style={{
            fontFamily: '"Fraunces", Georgia, serif',
            fontStyle: 'italic',
            fontWeight: 300,
            color: '#0A0A0A',
          }}
        >
          My Queue
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8B8B85' }}>
          {loading
            ? 'Loading…'
            : `${total} lead${total !== 1 ? 's' : ''} · ${overdue} overdue`}
        </p>
      </div>

      {/* ─── Stat chips ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <span
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-1.5 rounded-full"
          style={{ backgroundColor: overdue > 0 ? '#FFF1F2' : '#F1F5F9', color: overdue > 0 ? '#9F1239' : '#475569' }}
        >
          Overdue
          <span className="font-bold">{overdue}</span>
        </span>

        <span
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-1.5 rounded-full"
          style={{ backgroundColor: urgent > 0 ? '#FFFBEB' : '#F1F5F9', color: urgent > 0 ? '#92400E' : '#475569' }}
        >
          Urgent
          <span className="font-bold">{urgent}</span>
        </span>

        <span
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-1.5 rounded-full"
          style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
        >
          Total
          <span className="font-bold">{total}</span>
        </span>
      </div>

      {/* ─── Table header (hidden on narrow) ──────────────────────────────── */}
      {!loading && leads.length > 0 && (
        <div className="hidden sm:flex items-center gap-4 px-5 py-2">
          <div className="w-32 shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Name</div>
          <div className="w-36 shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Product</div>
          <div className="w-20 shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Source</div>
          <div className="w-32 shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>SLA</div>
          <div className="flex-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Stage</div>
          <div className="shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8B8B85' }}>Actions</div>
        </div>
      )}

      {/* ─── Content ──────────────────────────────────────────────────────── */}
      {error ? (
        <div className="text-center py-12">
          <p className="text-sm" style={{ color: '#9F1239' }}>Failed to load queue: {error}</p>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <div className="py-20 text-center space-y-2">
          <p className="text-sm font-medium" style={{ color: '#0A0A0A' }}>Your queue is clear.</p>
          <p className="text-sm" style={{ color: '#8B8B85' }}>
            No leads in your queue. New assignments will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {leads.map((item) => (
            <MyQueueRow key={item.lead.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
