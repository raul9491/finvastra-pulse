import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader } from '../../../components/ui/primitives';
import { PendingTab, AllTab } from './leaveApprovalTabs';
import { BalancesTab } from './leaveBalancesTab';
import { EncashmentTab } from './leaveEncashmentTab';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useAllEncashmentRequests } from '../hooks/useLeaveEncashment';

type TabId = 'pending' | 'all' | 'balances' | 'encashment';

export function AdminLeavePage() {
  const { user, profile } = useAuth();
  const { employees }     = useAllEmployees();
  const [activeTab, setActiveTab] = useState<TabId>('pending');

  // Must be called unconditionally — before any early returns (Rules of Hooks)
  const { requests: encashPending } = useAllEncashmentRequests();
  const pendingEncashCount = encashPending.filter((r) => r.status === 'pending').length;

  // Guard: admin or HRMS manager only
  if (profile?.role !== 'admin' && !profile?.isHrmsManager) {
    return <Navigate to="/hrms/dashboard" replace />;
  }

  const employeeNameById = (id: string): string =>
    employees.find((e) => e.userId === id)?.displayName ?? id.slice(0, 8);

  const tabStyle = (t: TabId): React.CSSProperties =>
    activeTab === t
      ? { borderBottom: '2px solid #C9A961', color: 'var(--text-primary)', fontWeight: 600 }
      : { borderBottom: '2px solid transparent', color: 'var(--text-muted)' };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ── Header ── */}
      <PageHeader
        title="Leave Management"
        subtitle="Review and act on leave applications"
        pinKey="hrms.leave-admin"
      />

      {/* ── Card with tabs ── */}
      <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-(--shell-border)">
          {([
            ['pending',    'Pending Approvals'],
            ['all',        'All Applications'],
            ['balances',   'Balances'],
            ['encashment', 'Encashment'],
          ] as [TabId, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className="relative px-6 py-4 text-sm transition-colors"
              style={tabStyle(t)}
            >
              {label}
              {t === 'encashment' && pendingEncashCount > 0 && (
                <span className="absolute top-2 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none"
                  style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}>
                  {pendingEncashCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'pending' && (
          <PendingTab
            approverId={user?.uid ?? ''}
            employeeNameById={employeeNameById}
          />
        )}
        {activeTab === 'all' && (
          <AllTab
            employeeNameById={employeeNameById}
            employees={employees.map((e) => ({ userId: e.userId, displayName: e.displayName }))}
          />
        )}
        {activeTab === 'balances' && (
          <BalancesTab
            employees={employees.map((e) => ({ userId: e.userId, displayName: e.displayName, employeeId: e.employeeId }))}
            actorUid={user?.uid ?? ''}
            actorName={profile?.displayName ?? 'Admin'}
            isAdmin={profile?.role === 'admin'}
            isHrmsManager={!!profile?.isHrmsManager}
          />
        )}
        {activeTab === 'encashment' && (
          <EncashmentTab actorUid={user?.uid ?? ''} />
        )}
      </div>
    </div>
  );
}
