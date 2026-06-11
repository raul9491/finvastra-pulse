// ─── Shareable Pages Registry — Phase P ───────────────────────────────────────
// Single source of truth for every page a super admin can share with a user who
// lacks the module's team flag. Routes are the REAL router paths (the index
// routes /crm, /hrms, /mis redirect to these).
//
// NOTE: icons are lucide component NAMES (strings) so this module stays a pure
// config import; resolve to components via SHAREABLE_PAGE_ICONS.

import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, Users, ListTodo, Kanban, Target, Monitor, BarChart2,
  IndianRupee, Share2, Upload, Home, Network, CalendarCheck, FileText,
  Receipt, Clock, CalendarOff, Wallet, FileSignature, Bell, BarChart3,
  GitMerge, Banknote, FileSpreadsheet, TrendingUp, AlertTriangle,
} from 'lucide-react';
import type { ShareableModule } from '../types';

export type { ShareableModule };

export interface ShareablePage {
  title: string;
  route: string;
  module: ShareableModule;
  icon: string;          // lucide icon name — resolve via SHAREABLE_PAGE_ICONS
  description: string;
}

export const SHAREABLE_PAGES = {
  // ── CRM ──────────────────────────────────────────────────────────────────
  'crm.dashboard':      { title: 'CRM Dashboard',         route: '/crm/dashboard',              module: 'crm',  icon: 'LayoutDashboard', description: 'Pipeline, RM performance and commission overview.' },
  'crm.leads':          { title: 'Leads',                 route: '/crm/leads',                  module: 'crm',  icon: 'Users',           description: 'All customers with their deal pipelines.' },
  'crm.my-queue':       { title: 'My Queue',              route: '/crm/my-queue',               module: 'crm',  icon: 'ListTodo',        description: 'Urgency-sorted personal work queue of leads.' },
  'crm.pipeline':       { title: 'Pipeline Board',        route: '/crm/pipeline',               module: 'crm',  icon: 'Kanban',          description: 'Kanban board of open deals by stage.' },
  'crm.targets':        { title: 'Targets',               route: '/crm/targets',                module: 'crm',  icon: 'Target',          description: 'Monthly RM targets vs live actuals.' },
  'crm.command-centre': { title: 'Command Centre',        route: '/crm/command-centre',         module: 'crm',  icon: 'Monitor',         description: 'Cross-module manager dashboard (HR + CRM + MIS).' },
  'crm.lead-aging':     { title: 'Lead Aging Report',     route: '/crm/reports/aging',          module: 'crm',  icon: 'BarChart2',       description: 'Fresh / Active / Aging / Stale lead buckets.' },
  'crm.commissions':    { title: 'Commission Records',    route: '/crm/commissions',            module: 'crm',  icon: 'IndianRupee',     description: 'Expected commissions per disbursal with status.' },
  'crm.referrals':      { title: 'My Referrals',          route: '/crm/referrals',              module: 'crm',  icon: 'Share2',          description: 'Employee-submitted referral leads and their status.' },
  'crm.import-queue':   { title: 'Import Queue',          route: '/crm/import/queue',           module: 'crm',  icon: 'Upload',          description: 'Bulk-imported lead batches awaiting distribution.' },

  // ── HRMS ─────────────────────────────────────────────────────────────────
  'hrms.dashboard':     { title: 'HRMS Dashboard',        route: '/hrms/dashboard',             module: 'hrms', icon: 'Home',            description: 'Announcements, birthdays and HR pending actions.' },
  'hrms.employees':     { title: 'Employee Directory',    route: '/hrms/employees',             module: 'hrms', icon: 'Users',           description: 'Employee list with roles and access management.' },
  'hrms.orgchart':      { title: 'Org Chart',             route: '/hrms/org-chart',             module: 'hrms', icon: 'Network',         description: 'Reporting-line tree of the whole organisation.' },
  'hrms.compliance':    { title: 'Compliance Calendar',   route: '/hrms/admin/compliance',      module: 'hrms', icon: 'CalendarCheck',   description: 'Statutory filing deadlines (TDS, GST, PF, ESI, PT, MCA).' },
  'hrms.pf-tracker':    { title: 'PF Tracker',            route: '/hrms/admin/pf-tracker',      module: 'hrms', icon: 'FileText',        description: 'Monthly PF contributions with ECR export.' },
  'hrms.payslips':      { title: 'Payslips',              route: '/hrms/payslips',              module: 'hrms', icon: 'Receipt',         description: 'Monthly payslips with PDF download.' },
  'hrms.attendance':    { title: 'Attendance',            route: '/hrms/attendance',            module: 'hrms', icon: 'Clock',           description: 'Clock-in history and monthly attendance summary.' },
  'hrms.leave':         { title: 'Leave',                 route: '/hrms/leave',                 module: 'hrms', icon: 'CalendarOff',     description: 'Leave balances, applications and encashment.' },
  'hrms.claims':        { title: 'Claims',                route: '/hrms/claims',                module: 'hrms', icon: 'Wallet',          description: 'Expense claims with bill upload and status.' },
  'hrms.letters':       { title: 'HR Letters',            route: '/hrms/admin/letters',         module: 'hrms', icon: 'FileSignature',   description: 'Generate offer, increment, NOC and other HR letters.' },
  'hrms.announcements': { title: 'Announcements',         route: '/hrms/announcements',         module: 'hrms', icon: 'Bell',            description: 'Company announcements with read tracking.' },

  // ── MIS ──────────────────────────────────────────────────────────────────
  'mis.overview':       { title: 'MIS Overview',          route: '/mis/overview',               module: 'mis',  icon: 'BarChart3',       description: 'Commission reconciliation and payout KPIs.' },
  'mis.reconciliation': { title: 'Reconciliation',        route: '/mis/reconciliation',         module: 'mis',  icon: 'GitMerge',        description: 'Match bank statement lines to expected commissions.' },
  'mis.payouts':        { title: 'RM Payouts',            route: '/mis/payouts',                module: 'mis',  icon: 'Banknote',        description: 'Monthly RM payout generation and approval.' },
  'mis.statements':     { title: 'Commission Statements', route: '/mis/statements',             module: 'mis',  icon: 'FileSpreadsheet', description: 'Imported bank/AMC/insurer commission statements.' },
  'mis.disbursals':     { title: 'Disbursals',            route: '/mis/overview?tab=disbursals', module: 'mis', icon: 'TrendingUp',      description: 'All disbursed cases with commission and connector.' },
  'mis.disputes':       { title: 'Commission Disputes',   route: '/mis/disputes',               module: 'mis',  icon: 'AlertTriangle',   description: 'Variance disputes with banks — track to resolution.' },
} as const satisfies Record<string, ShareablePage>;

export type PageKey = keyof typeof SHAREABLE_PAGES;

export const SHAREABLE_PAGE_ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Users, ListTodo, Kanban, Target, Monitor, BarChart2,
  IndianRupee, Share2, Upload, Home, Network, CalendarCheck, FileText,
  Receipt, Clock, CalendarOff, Wallet, FileSignature, Bell, BarChart3,
  GitMerge, Banknote, FileSpreadsheet, TrendingUp, AlertTriangle,
};

export function pageIcon(key: PageKey): LucideIcon {
  return SHAREABLE_PAGE_ICONS[SHAREABLE_PAGES[key].icon] ?? FileText;
}

const ALL_KEYS = Object.keys(SHAREABLE_PAGES) as PageKey[];

/** Strip trailing slashes (but keep "/" itself). */
function normalizePath(pathname: string): string {
  const p = pathname.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

/**
 * Resolve the current location to a registry PageKey, or null when the page
 * isn't shareable. Tolerant of trailing slashes. Query-param routes
 * (mis.disbursals = /mis/overview?tab=disbursals) are matched by pathname +
 * the tab param, and win over their plain-pathname sibling.
 */
export function resolvePageKey(pathname: string, search = ''): PageKey | null {
  const path = normalizePath(pathname);
  const params = new URLSearchParams(search);

  // Query-param entries first (more specific).
  for (const key of ALL_KEYS) {
    const route = SHAREABLE_PAGES[key].route;
    const qIdx = route.indexOf('?');
    if (qIdx === -1) continue;
    const routePath = normalizePath(route.slice(0, qIdx));
    const routeParams = new URLSearchParams(route.slice(qIdx + 1));
    if (routePath !== path) continue;
    let all = true;
    routeParams.forEach((v, k) => { if (params.get(k) !== v) all = false; });
    if (all) return key;
  }

  for (const key of ALL_KEYS) {
    const route = SHAREABLE_PAGES[key].route;
    if (route.includes('?')) continue;
    if (normalizePath(route) === path) return key;
  }
  return null;
}
