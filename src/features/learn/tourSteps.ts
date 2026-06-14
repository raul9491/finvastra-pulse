import type { LearnModule } from '../../types';

/**
 * A single coachmark step. `target` is a CSS selector for the element to
 * spotlight (we use `[data-tour="..."]` anchors placed on real nav items /
 * buttons). When `target` is absent OR can't be found/seen (a tool the user
 * lacks access to, or the collapsed mobile drawer), the step renders as a
 * centered card instead — so one step list works role-aware and on mobile.
 */
export interface TourStep {
  target?: string;        // CSS selector, e.g. '[data-tour="crm-meetings"]'
  title: string;
  body: string;
  route?: string;         // optional: navigate here before showing the step
}

const crm: TourStep[] = [
  {
    title: 'Welcome to the CRM 👋',
    body: 'This is where you manage customers, deals and your day. Here’s a 60-second tour of the tools — you can skip anytime and replay it later from the Learn tab.',
  },
  {
    target: '[data-tour="crm-dashboard"]',
    title: 'Dashboard',
    body: 'Your snapshot: leads, open pipeline, what you’ve won this month, and anything overdue. Start your day here.',
  },
  {
    target: '[data-tour="crm-customers"]',
    title: 'Customers',
    body: 'Every customer (lead) you own. Open one to see their details, log calls, set their status, schedule meetings, and move their deal forward. Tap a phone number to call or WhatsApp.',
  },
  {
    target: '[data-tour="crm-myqueue"]',
    title: 'My Queue',
    body: 'Fresh customers waiting on you, sorted by urgency. Overdue ones are flagged in red — work this list down to stay within SLA.',
  },
  {
    target: '[data-tour="crm-meetings"]',
    title: 'Meetings',
    body: 'Schedule a client meeting from any customer page and it lands on your own Google Calendar (and phone). This tab lists all your upcoming meetings.',
  },
  {
    target: '[data-tour="crm-targets"]',
    title: 'Targets',
    body: 'Your monthly target vs. live actuals (disbursals, conversions). Check it often to see where you stand.',
  },
  {
    target: '[data-tour="crm-team"]',
    title: 'My Team',
    body: 'Managers: see every team member’s leads and their statuses at a glance, and reassign customers between people when needed.',
  },
  {
    target: '[data-tour="learn"]',
    title: 'Learn anything, anytime',
    body: 'That’s the tour! Open Learn whenever you want — replay this walkthrough or read how each tool works to get faster at your job.',
  },
];

const hrms: TourStep[] = [
  {
    title: 'Welcome to Pulse HR 👋',
    body: 'Everything for your work life — attendance, leave, payslips, claims and more. Here’s a quick tour. Skip anytime; replay later from the Learn tab.',
  },
  {
    target: '[data-tour="hrms-attendance"]',
    title: 'Attendance',
    body: 'Clock in and out each day right here — works on your phone too. Forgot to mark a day? Raise a correction request and HR can approve it.',
  },
  {
    target: '[data-tour="hrms-leave"]',
    title: 'Leave',
    body: 'Apply for leave, see your balances (casual, sick, earned), and track approvals. Approved leave shows on the shared calendar automatically.',
  },
  {
    target: '[data-tour="hrms-payslips"]',
    title: 'Payslips',
    body: 'Download any month’s payslip as a PDF. Everything HR generates for you appears here.',
  },
  {
    target: '[data-tour="hrms-claims"]',
    title: 'Claims & Reimbursements',
    body: 'Submit expense claims with a photo of the bill (travel, medical, petrol…). Track approval and payment status without chasing anyone.',
  },
  {
    target: '[data-tour="hrms-announcements"]',
    title: 'Announcements',
    body: 'Company updates and circulars land here — important ones are pinned. The bell tells you what’s unread.',
  },
  {
    target: '[data-tour="learn"]',
    title: 'Learn anything, anytime',
    body: 'That’s the tour! Open the Pulse Guide whenever you’re unsure how something works — or replay this walkthrough.',
  },
];

const mis: TourStep[] = [
  {
    title: 'Welcome to MIS 👋',
    body: 'The back-office: import bank/AMC commission statements, reconcile them against expected commissions, resolve disputes, and run RM payouts. Quick tour — skip anytime.',
  },
  {
    target: '[data-tour="mis-overview"]',
    title: 'Overview',
    body: 'Your KPI dashboard — expected vs. received commission, variance, and the Disbursals bridge from CRM. Start here.',
  },
  {
    target: '[data-tour="mis-statements"]',
    title: 'Statements',
    body: 'Upload a bank/AMC/insurer commission statement (CSV). Pulse auto-detects the columns; save a template per bank so next time is one click.',
  },
  {
    target: '[data-tour="mis-reconciliation"]',
    title: 'Reconciliation',
    body: 'Auto-match statement lines to expected commissions (by amount + date), then resolve the rest by hand. This is how received money ties back to each deal.',
  },
  {
    target: '[data-tour="mis-disputes"]',
    title: 'Disputes',
    body: 'When a bank pays the wrong amount, it surfaces here as a dispute. Assign it, add notes, and resolve or write it off — nothing slips through.',
  },
  {
    target: '[data-tour="mis-payouts"]',
    title: 'RM Payouts',
    body: 'Generate each RM’s payout from money actually received (not just expected), apply the slab, then approve and mark paid with a reference.',
  },
  {
    target: '[data-tour="learn"]',
    title: 'Learn anything, anytime',
    body: 'That’s the tour! Open Learn to replay this or read exactly how reconciliation and payouts work.',
  },
];

export const TOURS: Record<LearnModule, TourStep[]> = { crm, hrms, mis };

export const TOUR_LABEL: Record<LearnModule, string> = {
  crm: 'CRM', hrms: 'Pulse HR', mis: 'MIS',
};
