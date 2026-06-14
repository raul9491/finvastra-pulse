import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, Suspense, type ComponentType, type ReactElement } from 'react';

// ── Load immediately (lightweight, must be instant) ──────────────────────────
// Auth + public + launcher are never lazy — they are the first thing a user hits.
import { CustomerTrackerPage }    from './features/public/CustomerTrackerPage';
import { LoginPage }              from './features/auth/LoginPage';
import { ResetPasswordPage }      from './features/auth/ResetPasswordPage';
import { AuthActionPage }         from './features/auth/AuthActionPage';
import { RequestAccessPage }      from './features/auth/RequestAccessPage';
import { LauncherPage }           from './features/home/LauncherPage';
import { RouteErrorBoundary }     from './components/ui/RouteErrorBoundary';
import { CHUNK_RELOAD_GUARD_KEY, scheduleGuardRearm } from './lib/chunkReloadGuard';

// ── Lazy-loading helpers ─────────────────────────────────────────────────────
// Pages are named exports, so we map the chosen export onto `default` for React.lazy.
// Stale-deploy recovery: when a hashed chunk 404s (the tab predates a deploy),
// hard-refresh ONCE to pull the new index.html — guarded so it can never loop.
// If the refresh doesn't fix it, the error propagates to RouteErrorBoundary.
function lazyPage<M extends Record<string, unknown>, K extends keyof M>(
  loader: () => Promise<M>,
  key: K,
) {
  return lazy(() =>
    loader()
      .then((m) => {
        // Chunk loaded fine — re-arm the one-shot reload AFTER 15s of stable
        // running (clearing immediately here caused a reload loop when one
        // chunk kept failing while others loaded from the SW cache).
        scheduleGuardRearm();
        return { default: m[key] as ComponentType<unknown> };
      })
      .catch((err: unknown) => {
        if (!sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY)) {
          sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, '1');
          window.location.reload();
          // Never resolves — the page is reloading; avoids an error flash.
          return new Promise<{ default: ComponentType<unknown> }>(() => {});
        }
        throw err;
      }),
  );
}

/** Spinner shown while a route chunk downloads — gold ring on a transparent bg. */
function RouteLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div
        style={{
          width: 40,
          height: 40,
          border: '2px solid rgba(201,169,97,0.3)',
          borderTop: '2px solid #C9A961',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
    </div>
  );
}

/** Wrap a lazy element in its own Suspense boundary so module chrome (the shell
 *  nav) stays mounted while the inner page chunk loads. */
const s = (el: ReactElement) => <Suspense fallback={<RouteLoader />}>{el}</Suspense>;

// ── HRMS (lazy group) ────────────────────────────────────────────────────────
const HrmsShell                = lazyPage(() => import('./components/layout/HrmsShell'), 'HrmsShell');
const HrmsDashboardPage        = lazyPage(() => import('./features/hrms/dashboard/HrmsDashboardPage'), 'HrmsDashboardPage');
const EmployeesPage            = lazyPage(() => import('./features/hrms/employees/EmployeesPage'), 'EmployeesPage');
const ImportEmployeesPage      = lazyPage(() => import('./features/hrms/employees/ImportEmployeesPage'), 'ImportEmployeesPage');
const EmployeeProfilePage      = lazyPage(() => import('./features/hrms/employees/EmployeeProfilePage'), 'EmployeeProfilePage');
const AccessRequestsPage       = lazyPage(() => import('./features/hrms/employees/AccessRequestsPage'), 'AccessRequestsPage');
const AttendancePage           = lazyPage(() => import('./features/hrms/attendance/AttendancePage'), 'AttendancePage');
const AdminAttendancePage      = lazyPage(() => import('./features/hrms/attendance/AdminAttendancePage'), 'AdminAttendancePage');
const LeavePage                = lazyPage(() => import('./features/hrms/leave/LeavePage'), 'LeavePage');
const ApplyLeavePage           = lazyPage(() => import('./features/hrms/leave/ApplyLeavePage'), 'ApplyLeavePage');
const AdminLeavePage           = lazyPage(() => import('./features/hrms/leave/AdminLeavePage'), 'AdminLeavePage');
const TeamCalendarPage         = lazyPage(() => import('./features/hrms/leave/TeamCalendarPage'), 'TeamCalendarPage');
const AdminCompOffPage         = lazyPage(() => import('./features/hrms/leave/AdminCompOffPage'), 'AdminCompOffPage');
const EmployeeDirectoryPage    = lazyPage(() => import('./features/hrms/directory/EmployeeDirectoryPage'), 'EmployeeDirectoryPage');
const PayslipsPage             = lazyPage(() => import('./features/hrms/payslips/PayslipsPage'), 'PayslipsPage');
const GeneratePayslipPage      = lazyPage(() => import('./features/hrms/payslips/GeneratePayslipPage'), 'GeneratePayslipPage');
const HolidaysPage             = lazyPage(() => import('./features/hrms/holidays/HolidaysPage'), 'HolidaysPage');
const HrmsSettingsPage         = lazyPage(() => import('./features/hrms/settings/SettingsPage'), 'HrmsSettingsPage');
const SuperAdminPermissionsPage= lazyPage(() => import('./features/hrms/admin/SuperAdminPermissionsPage'), 'SuperAdminPermissionsPage');
const ClaimsPage               = lazyPage(() => import('./features/hrms/claims/ClaimsPage'), 'ClaimsPage');
const AdminClaimsPage          = lazyPage(() => import('./features/hrms/claims/AdminClaimsPage'), 'AdminClaimsPage');
const ClaimsAnalyticsPage      = lazyPage(() => import('./features/hrms/claims/ClaimsAnalyticsPage'), 'ClaimsAnalyticsPage');
const DocumentsPage            = lazyPage(() => import('./features/hrms/documents/DocumentsPage'), 'DocumentsPage');
const AdminDocumentsPage       = lazyPage(() => import('./features/hrms/documents/AdminDocumentsPage'), 'AdminDocumentsPage');
const AnnouncementsPage        = lazyPage(() => import('./features/hrms/announcements/AnnouncementsPage'), 'AnnouncementsPage');
const AdminAnnouncementsPage   = lazyPage(() => import('./features/hrms/announcements/AdminAnnouncementsPage'), 'AdminAnnouncementsPage');
const ComplianceCalendarPage   = lazyPage(() => import('./features/hrms/compliance/ComplianceCalendarPage'), 'ComplianceCalendarPage');
const PfTrackerPage            = lazyPage(() => import('./features/hrms/compliance/PfTrackerPage'), 'PfTrackerPage');
const AssetsPage               = lazyPage(() => import('./features/hrms/assets/AssetsPage'), 'AssetsPage');
const ConnectorsPage           = lazyPage(() => import('./features/hrms/connectors/ConnectorsPage'), 'ConnectorsPage');
const ManageSharesPage         = lazyPage(() => import('./features/admin/ManageSharesPage'), 'ManageSharesPage');
const OnboardingPage           = lazyPage(() => import('./features/hrms/onboarding/OnboardingPage'), 'OnboardingPage');
const OffboardingPage          = lazyPage(() => import('./features/hrms/offboarding/OffboardingPage'), 'OffboardingPage');
const ItDeclarationPage        = lazyPage(() => import('./features/hrms/itdeclaration/ItDeclarationPage'), 'ItDeclarationPage');
const AdminItDeclarationsPage  = lazyPage(() => import('./features/hrms/itdeclaration/AdminItDeclarationsPage'), 'AdminItDeclarationsPage');
const ProbationPage            = lazyPage(() => import('./features/hrms/probation/ProbationPage'), 'ProbationPage');
const PerformancePage          = lazyPage(() => import('./features/hrms/performance/PerformancePage'), 'PerformancePage');
const AdminPerformancePage     = lazyPage(() => import('./features/hrms/performance/AdminPerformancePage'), 'AdminPerformancePage');
const RecruitmentPage          = lazyPage(() => import('./features/hrms/recruitment/RecruitmentPage'), 'RecruitmentPage');
const TrainingPage             = lazyPage(() => import('./features/hrms/training/TrainingPage'), 'TrainingPage');
const AdminTrainingPage        = lazyPage(() => import('./features/hrms/training/AdminTrainingPage'), 'AdminTrainingPage');
const HrHelpdeskPage           = lazyPage(() => import('./features/hrms/helpdesk/HrHelpdeskPage'), 'HrHelpdeskPage');
const AdminHelpdeskPage        = lazyPage(() => import('./features/hrms/helpdesk/AdminHelpdeskPage'), 'AdminHelpdeskPage');
const AdminSalaryHistoryPage   = lazyPage(() => import('./features/hrms/salary/AdminSalaryHistoryPage'), 'AdminSalaryHistoryPage');
const LeaveYearEndPage         = lazyPage(() => import('./features/hrms/leave/LeaveYearEndPage'), 'LeaveYearEndPage');
const HrLetterGeneratorPage    = lazyPage(() => import('./features/hrms/letters/HrLetterGeneratorPage'), 'HrLetterGeneratorPage');
const OrgChartPage             = lazyPage(() => import('./features/hrms/orgchart/OrgChartPage'), 'OrgChartPage');
const DataImportPage           = lazyPage(() => import('./features/hrms/dataimport/DataImportPage'), 'DataImportPage');
const PulseGuidePage           = lazyPage(() => import('./features/hrms/guide/PulseGuidePage'), 'PulseGuidePage');

// ── CRM (lazy group) ─────────────────────────────────────────────────────────
const CrmShell                 = lazyPage(() => import('./components/layout/CrmShell'), 'CrmShell');
const CrmDashboardPage         = lazyPage(() => import('./features/crm/dashboard/CrmDashboardPage'), 'CrmDashboardPage');
const LeadsPage                = lazyPage(() => import('./features/crm/leads/LeadsPage'), 'LeadsPage');
const NewLeadPage              = lazyPage(() => import('./features/crm/leads/NewLeadPage'), 'NewLeadPage');
const LeadDetailPage           = lazyPage(() => import('./features/crm/leads/LeadDetailPage'), 'LeadDetailPage');
const AddOpportunityPage       = lazyPage(() => import('./features/crm/opportunities/AddOpportunityPage'), 'AddOpportunityPage');
const OpportunityDetailPage    = lazyPage(() => import('./features/crm/opportunities/OpportunityDetailPage'), 'OpportunityDetailPage');
const BankSubmissionDetailPage = lazyPage(() => import('./features/crm/opportunities/loans/BankSubmissionDetailPage'), 'BankSubmissionDetailPage');
const PipelinePage             = lazyPage(() => import('./features/crm/pipeline/PipelinePage'), 'PipelinePage');
const CommissionRecordsPage    = lazyPage(() => import('./features/crm/commissions/CommissionRecordsPage'), 'CommissionRecordsPage');
const CommissionSlabsPage      = lazyPage(() => import('./features/crm/admin/CommissionSlabsPage'), 'CommissionSlabsPage');
const AccessLogsPage           = lazyPage(() => import('./features/crm/admin/AccessLogsPage'), 'AccessLogsPage');
const RightToBeForgottenPage   = lazyPage(() => import('./features/crm/admin/RightToBeForgottenPage'), 'RightToBeForgottenPage');
const WebhookConfigPage        = lazyPage(() => import('./features/crm/admin/WebhookConfigPage'), 'WebhookConfigPage');
const DocumentTypesPage        = lazyPage(() => import('./features/crm/admin/DocumentTypesPage'), 'DocumentTypesPage');
const CommissionLeakagePage    = lazyPage(() => import('./features/crm/admin/CommissionLeakagePage'), 'CommissionLeakagePage');
const ProvidersPage            = lazyPage(() => import('./features/crm/admin/ProvidersPage'), 'ProvidersPage');
const CompetitorIntelligencePage = lazyPage(() => import('./features/crm/admin/CompetitorIntelligencePage'), 'CompetitorIntelligencePage');
const ReferralIntelligencePage = lazyPage(() => import('./features/crm/admin/ReferralIntelligencePage'), 'ReferralIntelligencePage');
const RateNegotiationMemoryPage= lazyPage(() => import('./features/crm/admin/RateNegotiationMemoryPage'), 'RateNegotiationMemoryPage');
const EligibilityRulesPage     = lazyPage(() => import('./features/crm/admin/EligibilityRulesPage'), 'EligibilityRulesPage');
const MyQueuePage              = lazyPage(() => import('./features/crm/leads/MyQueuePage'), 'MyQueuePage');
const ImportPage               = lazyPage(() => import('./features/crm/import/ImportPage'), 'ImportPage');
const ImportQueuePage          = lazyPage(() => import('./features/crm/import/ImportQueuePage'), 'ImportQueuePage');
const ImportHistoryPage        = lazyPage(() => import('./features/crm/import/ImportHistoryPage'), 'ImportHistoryPage');
const MyReferralsPage          = lazyPage(() => import('./features/crm/referrals/MyReferralsPage'), 'MyReferralsPage');
const SubmitReferralPage       = lazyPage(() => import('./features/crm/referrals/SubmitReferralPage'), 'SubmitReferralPage');
const ImportReferralsPage      = lazyPage(() => import('./features/crm/referrals/ImportReferralsPage'), 'ImportReferralsPage');
const TargetsPage              = lazyPage(() => import('./features/crm/targets/TargetsPage'), 'TargetsPage');
const LeadAgingPage            = lazyPage(() => import('./features/crm/reports/LeadAgingPage'), 'LeadAgingPage');
const CommandCentrePage        = lazyPage(() => import('./features/crm/dashboard/CommandCentrePage'), 'CommandCentrePage');
const TeamPerformancePage      = lazyPage(() => import('./features/crm/team/TeamPerformancePage'), 'TeamPerformancePage');
const MyMeetingsPage           = lazyPage(() => import('./features/crm/meetings/MyMeetingsPage'), 'MyMeetingsPage');
const CrmLearnPage             = lazyPage(() => import('./features/crm/learn/CrmLearnPage'), 'CrmLearnPage');
const Crm2MastersPage          = lazyPage(() => import('./features/crm2/masters/MastersPage'), 'Crm2MastersPage');
const Crm2LeadsPage            = lazyPage(() => import('./features/crm2/leads/Crm2LeadsPage'), 'Crm2LeadsPage');
const Crm2CasesPage            = lazyPage(() => import('./features/crm2/cases/Crm2CasesPage'), 'Crm2CasesPage');
const CaseWorkspacePage        = lazyPage(() => import('./features/crm2/cases/CaseWorkspacePage'), 'CaseWorkspacePage');
const PayoutBoardPage          = lazyPage(() => import('./features/crm2/payouts/PayoutBoardPage'), 'PayoutBoardPage');
const MisGridPage              = lazyPage(() => import('./features/crm2/mis/MisGridPage'), 'MisGridPage');
const ReconPage                = lazyPage(() => import('./features/crm2/recon/ReconPage'), 'ReconPage');
const DashboardsPage           = lazyPage(() => import('./features/crm2/dashboards/DashboardsPage'), 'DashboardsPage');
const Crm2PermissionsPage      = lazyPage(() => import('./features/crm2/admin/Crm2PermissionsPage'), 'Crm2PermissionsPage');

// ── MIS (lazy group) ─────────────────────────────────────────────────────────
const MisShell                 = lazyPage(() => import('./components/layout/MisShell'), 'MisShell');
const MisOverviewPage          = lazyPage(() => import('./features/mis/overview/MisOverviewPage'), 'MisOverviewPage');
const DisputesPage             = lazyPage(() => import('./features/mis/disputes/DisputesPage'), 'DisputesPage');
const MisLearnPage             = lazyPage(() => import('./features/mis/learn/MisLearnPage'), 'MisLearnPage');
const StatementsPage           = lazyPage(() => import('./features/mis/statements/StatementsPage'), 'StatementsPage');
const UploadStatementPage      = lazyPage(() => import('./features/mis/statements/UploadStatementPage'), 'UploadStatementPage');
const StatementDetailPage      = lazyPage(() => import('./features/mis/statements/StatementDetailPage'), 'StatementDetailPage');
const ReconciliationPage       = lazyPage(() => import('./features/mis/reconciliation/ReconciliationPage'), 'ReconciliationPage');
const PayoutsPage              = lazyPage(() => import('./features/mis/payouts/PayoutsPage'), 'PayoutsPage');
const GeneratePayoutsPage      = lazyPage(() => import('./features/mis/payouts/GeneratePayoutsPage'), 'GeneratePayoutsPage');
const PayoutDetailPage         = lazyPage(() => import('./features/mis/payouts/PayoutDetailPage'), 'PayoutDetailPage');
const PayoutSlabsPage          = lazyPage(() => import('./features/mis/payouts/PayoutSlabsPage'), 'PayoutSlabsPage');
const StatementTemplatesPage   = lazyPage(() => import('./features/mis/admin/StatementTemplatesPage'), 'StatementTemplatesPage');

export const router = createBrowserRouter([
  {
    path: '/track/:token',
    element: <CustomerTrackerPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/login',
    element: <LoginPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/reset-password',
    element: <ResetPasswordPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    // Handles branded password-reset links: /auth-action?mode=resetPassword&oobCode=xxx
    // DOB verification → new password form → success
    path: '/auth-action',
    element: <AuthActionPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/request-access',
    element: <RequestAccessPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/',
    element: <LauncherPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    // Phase P — super-admin console for page shares (standalone, no module shell)
    path: '/admin/shares',
    element: s(<ManageSharesPage />),
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/hrms',
    element: s(<HrmsShell />),
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true,        element: <Navigate to="/hrms/dashboard" replace /> },
      { path: 'dashboard',  element: s(<HrmsDashboardPage />) },
      { path: 'employees',                element: s(<EmployeesPage />) },
      { path: 'employees/:userId',        element: s(<EmployeeProfilePage />) },
      { path: 'admin/access-requests',     element: s(<AccessRequestsPage />) },
      { path: 'admin/import-employees',   element: s(<ImportEmployeesPage />) },
      { path: 'attendance', element: s(<AttendancePage />) },
      { path: 'leave',               element: s(<LeavePage />) },
      { path: 'leave/apply',         element: s(<ApplyLeavePage />) },
      { path: 'leave/admin',         element: s(<AdminLeavePage />) },
      { path: 'leave/team-calendar', element: s(<TeamCalendarPage />) },
      { path: 'admin/comp-off',      element: s(<AdminCompOffPage />) },
      { path: 'directory',           element: s(<EmployeeDirectoryPage />) },
      { path: 'payslips',            element: s(<PayslipsPage />) },
      { path: 'holidays',            element: s(<HolidaysPage />) },
      { path: 'admin/permissions',    element: s(<SuperAdminPermissionsPage />) },
      { path: 'admin/attendance',    element: s(<AdminAttendancePage />) },
      { path: 'admin/payslips',      element: s(<GeneratePayslipPage />) },
      { path: 'admin/holidays',      element: s(<HolidaysPage />) },
      { path: 'admin/claims',        element: s(<AdminClaimsPage />) },
      { path: 'admin/claims-analytics', element: s(<ClaimsAnalyticsPage />) },
      { path: 'admin/documents',     element: s(<AdminDocumentsPage />) },
      { path: 'admin/announcements', element: s(<AdminAnnouncementsPage />) },
      { path: 'admin/compliance',    element: s(<ComplianceCalendarPage />) },
      { path: 'admin/pf-tracker',   element: s(<PfTrackerPage />) },
      { path: 'admin/assets',        element: s(<AssetsPage />) },
      { path: 'admin/connectors',    element: s(<ConnectorsPage />) },
      { path: 'admin/onboarding',      element: s(<OnboardingPage />) },
      { path: 'admin/probation',       element: s(<ProbationPage />) },
      { path: 'performance',           element: s(<PerformancePage />) },
      { path: 'admin/performance',     element: s(<AdminPerformancePage />) },
      { path: 'admin/offboarding',     element: s(<OffboardingPage />) },
      { path: 'admin/recruitment',     element: s(<RecruitmentPage />) },
      { path: 'training',              element: s(<TrainingPage />) },
      { path: 'admin/training',        element: s(<AdminTrainingPage />) },
      { path: 'hr-helpdesk',           element: s(<HrHelpdeskPage />) },
      { path: 'admin/hr-helpdesk',     element: s(<AdminHelpdeskPage />) },
      { path: 'admin/salary-history',  element: s(<AdminSalaryHistoryPage />) },
      { path: 'it-declaration',        element: s(<ItDeclarationPage />) },
      { path: 'admin/it-declarations', element: s(<AdminItDeclarationsPage />) },
      { path: 'org-chart',             element: s(<OrgChartPage />) },
      { path: 'guide',                 element: s(<PulseGuidePage />) },
      { path: 'admin/leave-year-end',  element: s(<LeaveYearEndPage />) },
      { path: 'admin/letters',         element: s(<HrLetterGeneratorPage />) },
      { path: 'admin/data-import',     element: s(<DataImportPage />) },
      { path: 'claims',              element: s(<ClaimsPage />) },
      { path: 'documents',           element: s(<DocumentsPage />) },
      { path: 'announcements',       element: s(<AnnouncementsPage />) },
      { path: 'settings',            element: s(<HrmsSettingsPage />) },
    ],
  },
  {
    path: '/crm',
    element: s(<CrmShell />),
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true,       element: <Navigate to="/crm/dashboard" replace /> },
      { path: 'command-centre', element: s(<CommandCentrePage />) },
      { path: 'team',           element: s(<TeamPerformancePage />) },
      { path: 'dashboard',   element: s(<CrmDashboardPage />) },
      { path: 'my-queue',    element: s(<MyQueuePage />) },
      // leads/new before leads/:leadId so 'new' isn't treated as a leadId param
      { path: 'leads',                                     element: s(<LeadsPage />) },
      { path: 'leads/new',                                 element: s(<NewLeadPage />) },
      { path: 'leads/:leadId',                             element: s(<LeadDetailPage />) },
      { path: 'leads/:leadId/opportunities/new',           element: s(<AddOpportunityPage />) },
      { path: 'leads/:leadId/opportunities/:oppId',                    element: s(<OpportunityDetailPage />) },
      { path: 'leads/:leadId/opportunities/:oppId/submissions/:subId', element: s(<BankSubmissionDetailPage />) },
      { path: 'pipeline',                 element: s(<PipelinePage />) },
      { path: 'commissions',              element: s(<CommissionRecordsPage />) },
      { path: 'admin/commission-slabs',      element: s(<CommissionSlabsPage />) },
      { path: 'admin/access-logs',           element: s(<AccessLogsPage />) },
      { path: 'admin/right-to-be-forgotten', element: s(<RightToBeForgottenPage />) },
      { path: 'admin/webhooks',              element: s(<WebhookConfigPage />) },
      { path: 'admin/document-types',        element: s(<DocumentTypesPage />) },
      { path: 'admin/commission-leakage',    element: s(<CommissionLeakagePage />) },
      { path: 'admin/providers',             element: s(<ProvidersPage />) },
      { path: 'admin/competitor-intelligence',element: s(<CompetitorIntelligencePage />) },
      { path: 'admin/referrers',             element: s(<ReferralIntelligencePage />) },
      { path: 'admin/rate-memory',           element: s(<RateNegotiationMemoryPage />) },
      { path: 'admin/eligibility-rules',     element: s(<EligibilityRulesPage />) },
      { path: 'import',                      element: s(<ImportPage />) },
      { path: 'import/queue',                element: s(<ImportQueuePage />) },
      { path: 'import/history',          element: s(<ImportHistoryPage />) },
      { path: 'targets',                     element: s(<TargetsPage />) },
      { path: 'meetings',                    element: s(<MyMeetingsPage />) },
      { path: 'learn',                       element: s(<CrmLearnPage />) },
      { path: 'reports/aging',               element: s(<LeadAgingPage />) },
      // CRM 2.0 / Pipeline (PLAN.md) — coexists with the old CRM until migration
      { path: 'pipeline/masters',            element: s(<Crm2MastersPage />) },
      { path: 'pipeline/leads',              element: s(<Crm2LeadsPage />) },
      { path: 'pipeline/cases',              element: s(<Crm2CasesPage />) },
      { path: 'pipeline/cases/:caseId',      element: s(<CaseWorkspacePage />) },
      { path: 'pipeline/payouts',            element: s(<PayoutBoardPage />) },
      { path: 'pipeline/mis',                element: s(<MisGridPage />) },
      { path: 'pipeline/recon',              element: s(<ReconPage />) },
      { path: 'pipeline/dashboards',         element: s(<DashboardsPage />) },
      { path: 'pipeline/permissions',        element: s(<Crm2PermissionsPage />) },
      // Employee referral pages — accessible to all HRMS employees (referral mode)
      { path: 'referrals',               element: s(<MyReferralsPage />) },
      { path: 'referrals/new',           element: s(<SubmitReferralPage />) },
      { path: 'referrals/import',        element: s(<ImportReferralsPage />) },
    ],
  },
  {
    path: '/mis',
    element: s(<MisShell />),
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true,                  element: <Navigate to="/mis/overview" replace /> },
      { path: 'overview',             element: s(<MisOverviewPage />) },
      { path: 'statements',           element: s(<StatementsPage />) },
      { path: 'statements/upload',    element: s(<UploadStatementPage />) },
      { path: 'statements/:statementId', element: s(<StatementDetailPage />) },
      { path: 'reconciliation',       element: s(<ReconciliationPage />) },
      { path: 'disputes',             element: s(<DisputesPage />) },
      { path: 'learn',                element: s(<MisLearnPage />) },
      { path: 'payouts',              element: s(<PayoutsPage />) },
      { path: 'payouts/generate',     element: s(<GeneratePayoutsPage />) },
      { path: 'payouts/:payoutId',    element: s(<PayoutDetailPage />) },
      { path: 'admin/payout-slabs',   element: s(<PayoutSlabsPage />) },
      { path: 'admin/statement-templates', element: s(<StatementTemplatesPage />) },
    ],
  },
]);
