import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useCommissionRecords } from '../hooks/useCommissionRecords';

export function CommissionDashboardCard() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { records, loading } = useCommissionRecords(user?.uid ?? null, isAdmin);

  // Current calendar month
  const { expected, received, pendingCount } = useMemo(() => {
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthRecords = records.filter((r) => {
      const recDate = r.createdAt?.toDate ? r.createdAt.toDate() : null;
      if (!recDate) return false;
      const key = `${recDate.getFullYear()}-${String(recDate.getMonth() + 1).padStart(2, '0')}`;
      return key === monthStr;
    });
    return {
      expected:     monthRecords.reduce((s, r) => s + r.calculatedCommission, 0),
      received:     monthRecords.filter(r => r.status === 'paid').reduce((s, r) => s + (r.actualAmount ?? r.calculatedCommission), 0),
      pendingCount: monthRecords.filter(r => r.status === 'pending').length,
    };
  }, [records]);

  const label = isAdmin ? 'Total expected this month' : 'Your expected commission this month';

  if (loading) {
    return <div className="h-28 glass-panel animate-pulse" />;
  }

  return (
    <button
      onClick={() => navigate('/crm/commissions')}
      className="group w-full text-left glass-panel glass-card p-6 hover:bg-(--shell-hover-soft) transition-all"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
            Commissions
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</p>
        </div>
        <ChevronRight size={16} style={{ color: 'var(--text-dim)' }} className="group-hover:opacity-100 transition-opacity mt-1" />
      </div>

      <div className="flex items-end gap-6">
        <div>
          <p className="text-2xl font-bold" style={{ color: '#C9A961' }}>
            ₹{expected.toLocaleString('en-IN')}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>expected ({pendingCount} pending)</p>
        </div>
        {received > 0 && (
          <div>
            <p className="text-lg font-semibold" style={{ color: '#34d399' }}>
              ₹{received.toLocaleString('en-IN')}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>received</p>
          </div>
        )}
      </div>
    </button>
  );
}
