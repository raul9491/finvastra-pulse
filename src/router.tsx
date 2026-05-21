import { createBrowserRouter, Navigate } from 'react-router-dom';

import { CustomerTrackerPage }    from './features/public/CustomerTrackerPage';
import { LoginPage }              from './features/auth/LoginPage';
import { ResetPasswordPage }      from './features/auth/ResetPasswordPage';
import { RequestAccessPage }      from './features/auth/RequestAccessPage';
import { LauncherPage }           from './features/home/LauncherPage';

import { HrmsShell }              from './components/layout/HrmsShell';
import { HrmsDashboardPage }      from './features/hrms/dashboard/HrmsDashboardPage';
import { EmployeesPage }          from './features/hrms/employees/EmployeesPage';
import { ImportEmployeesPage }    from './features/hrms/employees/ImportEmployeesPage';
import { EmployeeProfilePage }    from './features/hrms/employees/EmployeeProfilePage';
import { AccessRequestsPage }     from './features/hrms/employees/AccessRequestsPage';
import { AttendancePage }         from './features/hrms/attendance/AttendancePage';
import { AdminAttendancePage }    from './features/hrms/attendance/AdminAttendancePage';
import { LeavePage }              from './features/hrms/leave/LeavePage';
import { ApplyLeavePage }         from './features/hrms/leave/ApplyLeavePage';
import { AdminLeavePage }         from './features/hrms/leave/AdminLeavePage';
import { PayslipsPage }           from './features/hrms/payslips/PayslipsPage';
import { GeneratePayslipPage }    from './features/hrms/payslips/GeneratePayslipPage';
import { HolidaysPage }           from './features/hrms/holidays/HolidaysPage';
import { HrmsSettingsPage }        from './features/hrms/settings/SettingsPage';
import { AccessManagementPage }   from './features/hrms/admin/AccessManagementPage';

import { CrmShell }               from './components/layout/CrmShell';
import { CrmDashboardPage }       from './features/crm/dashboard/CrmDashboardPage';
import { LeadsPage }              from './features/crm/leads/LeadsPage';
import { NewLeadPage }            from './features/crm/leads/NewLeadPage';
import { LeadDetailPage }         from './features/crm/leads/LeadDetailPage';
import { AddOpportunityPage }         from './features/crm/opportunities/AddOpportunityPage';
import { OpportunityDetailPage }      from './features/crm/opportunities/OpportunityDetailPage';
import { BankSubmissionDetailPage }   from './features/crm/opportunities/loans/BankSubmissionDetailPage';
import { PipelinePage }              from './features/crm/pipeline/PipelinePage';
import { CommissionRecordsPage }    from './features/crm/commissions/CommissionRecordsPage';
import { CommissionSlabsPage }           from './features/crm/admin/CommissionSlabsPage';
import { AccessLogsPage }               from './features/crm/admin/AccessLogsPage';
import { RightToBeForgottenPage }       from './features/crm/admin/RightToBeForgottenPage';
import { DocumentTypesPage }            from './features/crm/admin/DocumentTypesPage';
import { CommissionLeakagePage }        from './features/crm/admin/CommissionLeakagePage';
import { ProvidersPage }                from './features/crm/admin/ProvidersPage';
import { CompetitorIntelligencePage }   from './features/crm/admin/CompetitorIntelligencePage';
import { ReferralIntelligencePage }     from './features/crm/admin/ReferralIntelligencePage';
import { RateNegotiationMemoryPage }    from './features/crm/admin/RateNegotiationMemoryPage';
import { EligibilityRulesPage }         from './features/crm/admin/EligibilityRulesPage';
import { MyQueuePage }                  from './features/crm/leads/MyQueuePage';
import { ImportPage }                   from './features/crm/import/ImportPage';
import { ImportHistoryPage }            from './features/crm/import/ImportHistoryPage';

import { MisShell }                 from './components/layout/MisShell';
import { MisOverviewPage }          from './features/mis/overview/MisOverviewPage';
import { StatementsPage }           from './features/mis/statements/StatementsPage';
import { UploadStatementPage }      from './features/mis/statements/UploadStatementPage';
import { StatementDetailPage }      from './features/mis/statements/StatementDetailPage';
import { ReconciliationPage }       from './features/mis/reconciliation/ReconciliationPage';
import { PayoutsPage }              from './features/mis/payouts/PayoutsPage';
import { GeneratePayoutsPage }      from './features/mis/payouts/GeneratePayoutsPage';
import { PayoutDetailPage }         from './features/mis/payouts/PayoutDetailPage';
import { PayoutSlabsPage }          from './features/mis/payouts/PayoutSlabsPage';

export const router = createBrowserRouter([
  {
    path: '/track/:token',
    element: <CustomerTrackerPage />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/reset-password',
    element: <ResetPasswordPage />,
  },
  {
    path: '/request-access',
    element: <RequestAccessPage />,
  },
  {
    path: '/',
    element: <LauncherPage />,
  },
  {
    path: '/hrms',
    element: <HrmsShell />,
    children: [
      { index: true,        element: <Navigate to="/hrms/dashboard" replace /> },
      { path: 'dashboard',  element: <HrmsDashboardPage /> },
      { path: 'employees',                element: <EmployeesPage /> },
      { path: 'employees/:userId',        element: <EmployeeProfilePage /> },
      { path: 'admin/access-requests',     element: <AccessRequestsPage /> },
      { path: 'admin/import-employees',   element: <ImportEmployeesPage /> },
      { path: 'attendance', element: <AttendancePage /> },
      { path: 'leave',         element: <LeavePage /> },
      { path: 'leave/apply',  element: <ApplyLeavePage /> },
      { path: 'leave/admin',         element: <AdminLeavePage /> },
      { path: 'payslips',            element: <PayslipsPage /> },
      { path: 'holidays',            element: <HolidaysPage /> },
      { path: 'admin/access',         element: <AccessManagementPage /> },
      { path: 'admin/attendance',    element: <AdminAttendancePage /> },
      { path: 'admin/payslips',      element: <GeneratePayslipPage /> },
      { path: 'admin/holidays',      element: <HolidaysPage /> },
      { path: 'settings',            element: <HrmsSettingsPage /> },
    ],
  },
  {
    path: '/crm',
    element: <CrmShell />,
    children: [
      { index: true,       element: <Navigate to="/crm/dashboard" replace /> },
      { path: 'dashboard',   element: <CrmDashboardPage /> },
      { path: 'my-queue',    element: <MyQueuePage /> },
      // leads/new before leads/:leadId so 'new' isn't treated as a leadId param
      { path: 'leads',                                     element: <LeadsPage /> },
      { path: 'leads/new',                                 element: <NewLeadPage /> },
      { path: 'leads/:leadId',                             element: <LeadDetailPage /> },
      { path: 'leads/:leadId/opportunities/new',           element: <AddOpportunityPage /> },
      { path: 'leads/:leadId/opportunities/:oppId',                    element: <OpportunityDetailPage /> },
      { path: 'leads/:leadId/opportunities/:oppId/submissions/:subId', element: <BankSubmissionDetailPage /> },
      { path: 'pipeline',                 element: <PipelinePage /> },
      { path: 'commissions',              element: <CommissionRecordsPage /> },
      { path: 'admin/commission-slabs',      element: <CommissionSlabsPage /> },
      { path: 'admin/access-logs',           element: <AccessLogsPage /> },
      { path: 'admin/right-to-be-forgotten', element: <RightToBeForgottenPage /> },
      { path: 'admin/document-types',        element: <DocumentTypesPage /> },
      { path: 'admin/commission-leakage',    element: <CommissionLeakagePage /> },
      { path: 'admin/providers',             element: <ProvidersPage /> },
      { path: 'admin/competitor-intelligence',element: <CompetitorIntelligencePage /> },
      { path: 'admin/referrers',             element: <ReferralIntelligencePage /> },
      { path: 'admin/rate-memory',           element: <RateNegotiationMemoryPage /> },
      { path: 'admin/eligibility-rules',     element: <EligibilityRulesPage /> },
      { path: 'import',                      element: <ImportPage /> },
      { path: 'import/history',          element: <ImportHistoryPage /> },
    ],
  },
  {
    path: '/mis',
    element: <MisShell />,
    children: [
      { index: true,                  element: <Navigate to="/mis/overview" replace /> },
      { path: 'overview',             element: <MisOverviewPage /> },
      { path: 'statements',           element: <StatementsPage /> },
      { path: 'statements/upload',    element: <UploadStatementPage /> },
      { path: 'statements/:statementId', element: <StatementDetailPage /> },
      { path: 'reconciliation',       element: <ReconciliationPage /> },
      { path: 'payouts',              element: <PayoutsPage /> },
      { path: 'payouts/generate',     element: <GeneratePayoutsPage /> },
      { path: 'payouts/:payoutId',    element: <PayoutDetailPage /> },
      { path: 'admin/payout-slabs',   element: <PayoutSlabsPage /> },
    ],
  },
]);
