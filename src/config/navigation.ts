// ─── Unified Navigation Registry ──────────────────────────────────────────────
// Single source of truth describing every navigable page across all 5 modules.
// Feeds: the global Command Palette (Phase 1), the unified ModuleSidebar (Phase 2),
// pinned favourites, and the launcher search.
//
// IMPORTANT: this registry only *describes* routes — it never declares them.
// `src/router.tsx` remains the authority for what actually renders. Keep every
// `route` here in sync with a real router path (minus any ?query).
//
// Icons are lucide component NAMES (strings) so this stays a pure-config import;
// resolve to components via `resolveNavIcon()`.

import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, Clock, CalendarOff, Receipt, ReceiptText, BookUser, FolderOpen,
  Megaphone, Network, FileSearch2, TrendingUp, BookOpen, LifeBuoy, HelpCircle,
  Settings, Users, Inbox, UserPlus, Handshake, ClipboardList, CalendarDays,
  RotateCcw, FileText, ScrollText, Building2, Calculator, Briefcase, Laptop,
  GraduationCap, UserMinus, Lock, Database, ListChecks, Target, UsersRound,
  BarChart3, Upload, PackageOpen, User, Webhook, GitMerge, IndianRupee,
  AlertTriangle, Command,
} from 'lucide-react';
import type { User as FbUser } from 'firebase/auth';
import type { UserProfile } from '../types';
import { isSuperAdmin } from './hrmsConfig';

export type ModuleKey = 'hrms' | 'crm' | 'mis' | 'command' | 'lms';

// ── Access context — the exact booleans the shells already compute, in one place
export interface NavAccessCtx {
  isAdmin: boolean;
  isSA: boolean;
  isHrmsManager: boolean;
  isMisAdmin: boolean;
  isCrmManager: boolean;
  hrmsAccess: boolean;
  crmAccess: boolean;
  misAccess: boolean;
  crmCanImport: boolean;
  perms: Record<string, boolean>;
  profile: UserProfile | null;
}

export function buildNavCtx(user: FbUser | null, profile: UserProfile | null): NavAccessCtx {
  const isAdmin = profile?.role === 'admin';
  const p = profile as (UserProfile & { perms?: Record<string, boolean>; crmCanImport?: boolean }) | null;
  return {
    isAdmin,
    isSA: isSuperAdmin(user?.uid ?? '', profile),
    isHrmsManager: profile?.isHrmsManager === true,
    isMisAdmin: isAdmin || profile?.misAccess === 'admin',
    isCrmManager: profile?.crmRole === 'manager',
    hrmsAccess: isAdmin || profile?.hrmsAccess !== false,
    crmAccess: isAdmin || profile?.crmAccess === true,
    misAccess: isAdmin || profile?.misAccess != null,
    crmCanImport: isAdmin || profile?.crmRole === 'manager' || p?.crmCanImport === true,
    perms: p?.perms ?? {},
    profile: profile ?? null,
  };
}

// ── Reusable access predicates (mirror the live shell gates) ───────────────────
type Pred = (c: NavAccessCtx) => boolean;
const all: Pred = () => true;
const hrms: Pred = (c) => c.hrmsAccess;
const hrmsAdmin: Pred = (c) => c.isAdmin || c.isHrmsManager;
const sa: Pred = (c) => c.isSA;
const crm: Pred = (c) => c.crmAccess;
const crmLeads: Pred = (c) => c.isAdmin || c.perms['crm.leads.read'] === true;
const crmClients: Pred = (c) => c.isAdmin || c.perms['crm.leads.read'] === true || c.perms['crm.cases.read'] === true;
const crmCases: Pred = (c) => c.isAdmin || c.perms['crm.cases.read'] === true;
const crmManager: Pred = (c) => c.isAdmin || c.isCrmManager;
const crmImport: Pred = (c) => c.crmCanImport;
const crmAdmin: Pred = (c) => c.isAdmin;
const misAll: Pred = (c) => c.misAccess;
const misAdmin: Pred = (c) => c.isMisAdmin;
const command: Pred = (c) => c.isAdmin || c.profile?.commandCentreAccess === true || c.isHrmsManager || c.isCrmManager;

// ── Node shape ─────────────────────────────────────────────────────────────────
export interface NavNode {
  key: string;
  label: string;
  route: string;       // REAL router path (may carry ?query)
  module: ModuleKey;
  icon: string;        // lucide component name → resolveNavIcon()
  group: string;       // section header within the module
  keywords?: string[]; // extra search terms
  badgeKey?: string;   // optional id the shell maps to a live badge count (Phase 2)
  end?: boolean;       // exact-match active
  access: Pred;
}

// Per-module section order (drives the unified sidebar in Phase 2).
export const MODULE_GROUP_ORDER: Record<ModuleKey, string[]> = {
  hrms: ['General', 'My Work', 'Company', 'Growth', 'Support', 'People', 'Time & Leave', 'Payroll & Finance', 'Content', 'Performance', 'Statutory', 'Lifecycle', 'Admin Tools'],
  crm:  ['Dashboard', 'Workspace', 'Customers', 'Pipeline', 'Teams', 'Admin'],
  mis:  ['MIS', 'Archive · old MIS'],
  command: ['Command'],
  lms: ['Learn'],
};

export const NAV_NODES: NavNode[] = [
  // ════════════════════════════ HRMS ════════════════════════════
  { key: 'hrms.dashboard',        label: 'Dashboard',           route: '/hrms/dashboard',             module: 'hrms', icon: 'LayoutDashboard', group: 'General',  access: hrms, end: true },
  { key: 'hrms.attendance',       label: 'Attendance',          route: '/hrms/attendance',            module: 'hrms', icon: 'Clock',           group: 'My Work',  access: hrms },
  { key: 'hrms.leave',            label: 'Leave',               route: '/hrms/leave',                 module: 'hrms', icon: 'CalendarOff',     group: 'My Work',  access: hrms },
  { key: 'hrms.payslips',         label: 'Payslips',            route: '/hrms/payslips',              module: 'hrms', icon: 'Receipt',         group: 'My Work',  access: hrms },
  { key: 'hrms.claims',           label: 'My Claims',           route: '/hrms/claims',                module: 'hrms', icon: 'ReceiptText',     group: 'My Work',  access: hrms, keywords: ['reimbursement', 'expense'] },
  { key: 'hrms.directory',        label: 'Directory',           route: '/hrms/directory',             module: 'hrms', icon: 'BookUser',        group: 'Company',  access: hrms },
  { key: 'hrms.documents',        label: 'Documents',           route: '/hrms/documents',             module: 'hrms', icon: 'FolderOpen',      group: 'Company',  access: hrms },
  { key: 'hrms.announcements',    label: 'Announcements',       route: '/hrms/announcements',         module: 'hrms', icon: 'Megaphone',       group: 'Company',  access: hrms },
  { key: 'hrms.orgchart',         label: 'Organisation Chart',  route: '/hrms/org-chart',             module: 'hrms', icon: 'Network',         group: 'Company',  access: hrms },
  { key: 'hrms.it-declaration',   label: 'IT Declaration',      route: '/hrms/it-declaration',        module: 'hrms', icon: 'FileSearch2',     group: 'Growth',   access: hrms, keywords: ['80c', 'tax'] },
  { key: 'hrms.performance',      label: 'My Review',           route: '/hrms/performance',           module: 'hrms', icon: 'TrendingUp',      group: 'Growth',   access: hrms },
  { key: 'hrms.training',         label: 'My Training',         route: '/hrms/training',              module: 'hrms', icon: 'BookOpen',        group: 'Growth',   access: hrms },
  { key: 'hrms.helpdesk',         label: 'HR Helpdesk',         route: '/hrms/hr-helpdesk',           module: 'hrms', icon: 'LifeBuoy',        group: 'Support',  access: hrms },
  { key: 'hrms.guide',            label: 'Pulse Guide',         route: '/hrms/guide',                 module: 'hrms', icon: 'HelpCircle',      group: 'Support',  access: hrms },
  { key: 'hrms.settings',         label: 'Settings',            route: '/hrms/settings',              module: 'hrms', icon: 'Settings',        group: 'Support',  access: hrms },
  { key: 'hrms.employees',        label: 'Employees',           route: '/hrms/employees',             module: 'hrms', icon: 'Users',           group: 'People',   access: hrmsAdmin },
  { key: 'hrms.access-requests',  label: 'Access Requests',     route: '/hrms/admin/access-requests', module: 'hrms', icon: 'Inbox',           group: 'People',   access: hrmsAdmin },
  { key: 'hrms.import-employees', label: 'Import Employees',    route: '/hrms/admin/import-employees',module: 'hrms', icon: 'UserPlus',        group: 'People',   access: hrmsAdmin },
  { key: 'hrms.connectors',       label: 'Sub DSA',             route: '/hrms/admin/connectors',      module: 'hrms', icon: 'Handshake',       group: 'People',   access: hrmsAdmin, keywords: ['connector', 'channel partner', 'fac'] },
  { key: 'hrms.admin-attendance', label: 'Attendance — Admin',  route: '/hrms/admin/attendance',      module: 'hrms', icon: 'Clock',           group: 'Time & Leave', access: hrmsAdmin },
  { key: 'hrms.leave-admin',      label: 'Leave Approvals',     route: '/hrms/leave/admin',           module: 'hrms', icon: 'ClipboardList',   group: 'Time & Leave', access: hrmsAdmin },
  { key: 'hrms.comp-off',         label: 'Comp Off Credits',    route: '/hrms/admin/comp-off',        module: 'hrms', icon: 'CalendarDays',    group: 'Time & Leave', access: hrmsAdmin },
  { key: 'hrms.leave-year-end',   label: 'Year-End Reset',      route: '/hrms/admin/leave-year-end',  module: 'hrms', icon: 'RotateCcw',       group: 'Time & Leave', access: hrmsAdmin },
  { key: 'hrms.holidays',         label: 'Manage Holidays',     route: '/hrms/admin/holidays',        module: 'hrms', icon: 'CalendarDays',    group: 'Time & Leave', access: hrmsAdmin },
  { key: 'hrms.gen-payslips',     label: 'Generate Payslips',   route: '/hrms/admin/payslips',        module: 'hrms', icon: 'FileText',        group: 'Payroll & Finance', access: hrmsAdmin },
  { key: 'hrms.admin-claims',     label: 'Claims — Admin',      route: '/hrms/admin/claims',          module: 'hrms', icon: 'ReceiptText',     group: 'Payroll & Finance', access: hrmsAdmin },
  { key: 'hrms.claims-analytics', label: 'Claims Analytics',    route: '/hrms/admin/claims-analytics',module: 'hrms', icon: 'TrendingUp',      group: 'Payroll & Finance', access: hrmsAdmin },
  { key: 'hrms.salary-history',   label: 'Salary History',      route: '/hrms/admin/salary-history',  module: 'hrms', icon: 'TrendingUp',      group: 'Payroll & Finance', access: hrmsAdmin },
  { key: 'hrms.it-declarations',  label: 'IT Declarations',     route: '/hrms/admin/it-declarations', module: 'hrms', icon: 'FileSearch2',     group: 'Payroll & Finance', access: hrmsAdmin },
  { key: 'hrms.letters',          label: 'HR Letters',          route: '/hrms/admin/letters',         module: 'hrms', icon: 'ScrollText',      group: 'Content',  access: hrmsAdmin },
  { key: 'hrms.admin-documents',  label: 'Documents — Admin',   route: '/hrms/admin/documents',       module: 'hrms', icon: 'FolderOpen',      group: 'Content',  access: hrmsAdmin },
  { key: 'hrms.admin-announce',   label: 'Announcements — Admin',route: '/hrms/admin/announcements',  module: 'hrms', icon: 'Megaphone',       group: 'Content',  access: hrmsAdmin },
  { key: 'hrms.admin-perf',       label: 'Performance Reviews', route: '/hrms/admin/performance',     module: 'hrms', icon: 'TrendingUp',      group: 'Performance', access: hrmsAdmin },
  { key: 'hrms.training-admin',   label: 'Training',            route: '/hrms/admin/training',        module: 'hrms', icon: 'BookOpen',        group: 'Performance', access: hrmsAdmin },
  { key: 'hrms.helpdesk-admin',   label: 'HR Helpdesk — Admin', route: '/hrms/admin/hr-helpdesk',     module: 'hrms', icon: 'LifeBuoy',        group: 'Performance', access: hrmsAdmin },
  { key: 'hrms.compliance',       label: 'Compliance Calendar', route: '/hrms/admin/compliance',      module: 'hrms', icon: 'Building2',       group: 'Statutory', access: hrmsAdmin },
  { key: 'hrms.pf-tracker',       label: 'PF Tracker',          route: '/hrms/admin/pf-tracker',      module: 'hrms', icon: 'Calculator',      group: 'Statutory', access: hrmsAdmin },
  { key: 'hrms.recruitment',      label: 'Recruitment',         route: '/hrms/admin/recruitment',     module: 'hrms', icon: 'Briefcase',       group: 'Lifecycle', access: hrmsAdmin },
  { key: 'hrms.assets',           label: 'Assets',              route: '/hrms/admin/assets',          module: 'hrms', icon: 'Laptop',          group: 'Lifecycle', access: hrmsAdmin },
  { key: 'hrms.onboarding',       label: 'Onboarding',          route: '/hrms/admin/onboarding',      module: 'hrms', icon: 'UserPlus',        group: 'Lifecycle', access: hrmsAdmin },
  { key: 'hrms.probation',        label: 'Probation',           route: '/hrms/admin/probation',       module: 'hrms', icon: 'GraduationCap',   group: 'Lifecycle', access: hrmsAdmin },
  { key: 'hrms.offboarding',      label: 'Offboarding',         route: '/hrms/admin/offboarding',     module: 'hrms', icon: 'UserMinus',       group: 'Lifecycle', access: hrmsAdmin },
  { key: 'hrms.permissions',      label: 'Permission Manager',  route: '/hrms/admin/permissions',     module: 'hrms', icon: 'Lock',            group: 'Admin Tools', access: sa },
  { key: 'hrms.data-import',      label: 'Data Import',         route: '/hrms/admin/data-import',     module: 'hrms', icon: 'Database',        group: 'Admin Tools', access: sa },

  // ════════════════════════════ CRM ════════════════════════════
  { key: 'crm.dashboard',         label: 'Dashboard',           route: '/crm/dashboard',              module: 'crm', icon: 'LayoutDashboard', group: 'Dashboard', access: crm, end: true },
  { key: 'crm.tasks',             label: 'Tasks',               route: '/crm/tasks',                  module: 'crm', icon: 'ListChecks',      group: 'Workspace', access: crm, keywords: ['my queue', 'meetings'], badgeKey: 'crm.queueOverdue' },
  { key: 'crm.targets',           label: 'Targets',             route: '/crm/targets',                module: 'crm', icon: 'Target',          group: 'Workspace', access: crm, badgeKey: 'crm.targetMissing' },
  { key: 'crm.customers',         label: 'Customers',           route: '/crm/leads',                  module: 'crm', icon: 'TrendingUp',      group: 'Customers', access: crm, keywords: ['leads'] },
  { key: 'crm.pipeline-leads',    label: 'Leads',               route: '/crm/pipeline/leads',         module: 'crm', icon: 'Inbox',           group: 'Pipeline',  access: crmLeads, end: true },
  { key: 'crm.pipeline-clients',  label: 'Clients',             route: '/crm/pipeline/clients',       module: 'crm', icon: 'Building2',       group: 'Pipeline',  access: crmClients, end: true },
  { key: 'crm.pipeline-cases',    label: 'Cases',               route: '/crm/pipeline/cases',         module: 'crm', icon: 'Briefcase',       group: 'Pipeline',  access: crmCases },
  { key: 'crm.team',              label: 'My Team',             route: '/crm/team',                   module: 'crm', icon: 'UsersRound',      group: 'Teams',     access: crmManager, end: true },
  { key: 'crm.reports',           label: 'Reports',             route: '/crm/reports/aging',          module: 'crm', icon: 'BarChart3',       group: 'Teams',     access: crmManager, keywords: ['lead aging'] },
  { key: 'crm.import',            label: 'Import',              route: '/crm/import',                 module: 'crm', icon: 'Upload',          group: 'Teams',     access: crmImport, end: true },
  { key: 'crm.import-queue',      label: 'Import Queue',        route: '/crm/import/queue',           module: 'crm', icon: 'PackageOpen',     group: 'Teams',     access: crmImport, badgeKey: 'crm.queueAwaiting' },
  { key: 'crm.masters',           label: 'Masters',             route: '/crm/pipeline/masters',       module: 'crm', icon: 'Settings',        group: 'Admin',     access: crmAdmin },
  { key: 'crm.permissions',       label: 'Permissions',         route: '/crm/pipeline/permissions',   module: 'crm', icon: 'User',            group: 'Admin',     access: crmAdmin },
  { key: 'crm.dashboards',        label: 'CRM 2.0 Dashboards',  route: '/crm/pipeline/dashboards',    module: 'crm', icon: 'LayoutDashboard', group: 'Admin',     access: crmAdmin },
  { key: 'crm.import-history',    label: 'Import History',      route: '/crm/import/history',         module: 'crm', icon: 'Clock',           group: 'Admin',     access: crmAdmin },
  { key: 'crm.commission-leakage',label: 'Commission Leakage',  route: '/crm/admin/commission-leakage',module: 'crm', icon: 'Settings',       group: 'Admin',     access: crmAdmin },
  { key: 'crm.competitor-intel',  label: 'Competitor Intel',    route: '/crm/admin/competitor-intelligence', module: 'crm', icon: 'Settings', group: 'Admin',     access: crmAdmin },
  { key: 'crm.referral-intel',    label: 'Referral Intel',      route: '/crm/admin/referrers',        module: 'crm', icon: 'Settings',        group: 'Admin',     access: crmAdmin },
  { key: 'crm.access-logs',       label: 'Access Logs',         route: '/crm/admin/access-logs',      module: 'crm', icon: 'Settings',        group: 'Admin',     access: crmAdmin },
  { key: 'crm.rtbf',              label: 'Right to Erasure',    route: '/crm/admin/right-to-be-forgotten', module: 'crm', icon: 'Settings',   group: 'Admin',     access: crmAdmin },
  { key: 'crm.webhooks',          label: 'Webhooks',            route: '/crm/admin/webhooks',         module: 'crm', icon: 'Webhook',         group: 'Admin',     access: crmAdmin },

  // ════════════════════════════ MIS ════════════════════════════
  { key: 'mis.cases-mis',         label: 'MIS',                 route: '/mis/cases-mis',              module: 'mis', icon: 'BarChart3',       group: 'MIS',       access: misAll, end: true },
  { key: 'mis.recon',             label: 'Reconciliation',      route: '/mis/recon',                  module: 'mis', icon: 'GitMerge',        group: 'MIS',       access: misAll, end: true },
  { key: 'mis.payout-cycles',     label: 'Payout Cycles',       route: '/mis/payout-cycles',          module: 'mis', icon: 'IndianRupee',     group: 'MIS',       access: misAll },
  { key: 'mis.learn',             label: 'Learn',               route: '/mis/learn',                  module: 'mis', icon: 'GraduationCap',   group: 'MIS',       access: misAll, end: true, keywords: ['guide', 'tour'] },
  { key: 'mis.overview',          label: 'Overview',            route: '/mis/overview',               module: 'mis', icon: 'BarChart3',       group: 'Archive · old MIS', access: misAdmin },
  { key: 'mis.statements',        label: 'Statements',          route: '/mis/statements',             module: 'mis', icon: 'FileText',        group: 'Archive · old MIS', access: misAdmin },
  { key: 'mis.reconciliation',    label: 'Reconciliation (old)',route: '/mis/reconciliation',         module: 'mis', icon: 'GitMerge',        group: 'Archive · old MIS', access: misAdmin },
  { key: 'mis.disputes',          label: 'Disputes',            route: '/mis/disputes',               module: 'mis', icon: 'AlertTriangle',   group: 'Archive · old MIS', access: misAdmin, badgeKey: 'mis.openDisputes' },
  { key: 'mis.payouts',           label: 'RM Payouts',          route: '/mis/payouts',                module: 'mis', icon: 'IndianRupee',     group: 'Archive · old MIS', access: misAdmin },
  { key: 'mis.commissions',       label: 'Commissions',         route: '/mis/commissions',            module: 'mis', icon: 'IndianRupee',     group: 'Archive · old MIS', access: misAdmin },
  { key: 'mis.payout-slabs',      label: 'Payout Slabs',        route: '/mis/admin/payout-slabs',     module: 'mis', icon: 'Settings',        group: 'Archive · old MIS', access: misAdmin },
  { key: 'mis.statement-templates',label: 'Statement Templates',route: '/mis/admin/statement-templates', module: 'mis', icon: 'Settings',    group: 'Archive · old MIS', access: misAdmin },

  // ════════════════════════════ Command & LMS ════════════════════════════
  { key: 'command.home',          label: 'Command & Compliance',route: '/command',                    module: 'command', icon: 'Command',     group: 'Command',  access: command, keywords: ['compliance', 'command centre', 'pf'] },
  { key: 'lms.home',              label: 'Learning (LMS)',      route: '/lms',                        module: 'lms', icon: 'GraduationCap',   group: 'Learn',    access: all, keywords: ['training', 'guide', 'tour'] },
];

// ── Module metadata (launcher + AppsMenu single source of truth) ───────────────
export interface ModuleMeta {
  key: ModuleKey;
  label: string;
  short: string;
  desc: string;
  icon: string;
  accent: string;
  home: string;
  access: Pred;
}

export const MODULES: ModuleMeta[] = [
  { key: 'command', label: 'Command & Compliance', short: 'Command', desc: 'Cross-module oversight + statutory compliance.', icon: 'Command',       accent: '#8B5CF6', home: '/command',         access: command },
  { key: 'hrms',    label: 'HR & Operations',      short: 'HRMS',    desc: 'Employees · attendance · leave · payslips.',     icon: 'Users',         accent: '#5B9BD5', home: '/hrms/dashboard',  access: hrms },
  { key: 'crm',     label: 'CRM & Leads',          short: 'CRM',     desc: 'Leads · pipeline · cases · commissions.',         icon: 'TrendingUp',    accent: '#C9A961', home: '/crm/dashboard',   access: crm },
  { key: 'mis',     label: 'MIS',                  short: 'MIS',     desc: 'Reconciliation · payouts · disbursals.',          icon: 'BarChart3',     accent: '#34A853', home: '/mis/overview',    access: misAll },
  { key: 'lms',     label: 'Learning',             short: 'LMS',     desc: 'Guides, tours and training for Pulse.',           icon: 'GraduationCap', accent: '#EC4899', home: '/lms',             access: all },
];

export const MODULE_ACCENTS = Object.fromEntries(MODULES.map((m) => [m.key, m.accent])) as Record<ModuleKey, string>;

// ── Icon resolver ──────────────────────────────────────────────────────────────
const NAV_ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Clock, CalendarOff, Receipt, ReceiptText, BookUser, FolderOpen,
  Megaphone, Network, FileSearch2, TrendingUp, BookOpen, LifeBuoy, HelpCircle,
  Settings, Users, Inbox, UserPlus, Handshake, ClipboardList, CalendarDays,
  RotateCcw, FileText, ScrollText, Building2, Calculator, Briefcase, Laptop,
  GraduationCap, UserMinus, Lock, Database, ListChecks, Target, UsersRound,
  BarChart3, Upload, PackageOpen, User, Webhook, GitMerge, IndianRupee,
  AlertTriangle, Command,
};

export function resolveNavIcon(name: string): LucideIcon {
  return NAV_ICONS[name] ?? FileText;
}

// `data-tour` anchors the first-run guided tours target (src/features/learn).
// Kept here so the unified sidebar can stamp them on the right nav rows.
export const NODE_DATA_TOUR: Record<string, string> = {
  'crm.dashboard': 'crm-dashboard', 'crm.customers': 'crm-customers', 'crm.targets': 'crm-targets', 'crm.team': 'crm-team',
  'hrms.attendance': 'hrms-attendance', 'hrms.leave': 'hrms-leave', 'hrms.payslips': 'hrms-payslips', 'hrms.claims': 'hrms-claims', 'hrms.announcements': 'hrms-announcements', 'hrms.guide': 'learn',
  'mis.cases-mis': 'mis-overview', 'mis.recon': 'mis-reconciliation', 'mis.statements': 'mis-statements', 'mis.disputes': 'mis-disputes', 'mis.payouts': 'mis-payouts', 'mis.learn': 'learn',
};

// ── Selectors ──────────────────────────────────────────────────────────────────
/** All nodes the user is allowed to see (any module). */
export function accessibleNodes(ctx: NavAccessCtx): NavNode[] {
  return NAV_NODES.filter((n) => n.access(ctx));
}

/** Accessible nodes for one module, in section order then registry order. */
export function moduleNodes(module: ModuleKey, ctx: NavAccessCtx): NavNode[] {
  const order = MODULE_GROUP_ORDER[module] ?? [];
  return accessibleNodes(ctx)
    .filter((n) => n.module === module)
    .sort((a, b) => {
      const ga = order.indexOf(a.group), gb = order.indexOf(b.group);
      return (ga === -1 ? 99 : ga) - (gb === -1 ? 99 : gb);
    });
}

/** Lookup a node by stable key (used by pins/recents). */
const NODE_BY_KEY: Record<string, NavNode> = Object.fromEntries(NAV_NODES.map((n) => [n.key, n]));
export function nodeByKey(key: string): NavNode | undefined {
  return NODE_BY_KEY[key];
}

/** Modules the user can enter, in display order. */
export function accessibleModules(ctx: NavAccessCtx): ModuleMeta[] {
  return MODULES.filter((m) => m.access(ctx));
}
