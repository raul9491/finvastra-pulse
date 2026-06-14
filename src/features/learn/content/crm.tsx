import {
  LayoutDashboard, Users, Inbox, CalendarClock, GitBranch,
  IndianRupee, Target, UsersRound, Upload,
} from 'lucide-react';
import type { LearnSection } from '../types';

export const CRM_SECTIONS: LearnSection[] = [
  {
    id: 'dashboard',
    icon: <LayoutDashboard size={18} />,
    title: 'Dashboard — your daily snapshot',
    color: 'var(--text-primary)',
    items: [
      { q: 'What does the Dashboard show me?', a: 'Your key numbers at a glance: total leads, open pipeline value, deals won this month, commission earned, and anything overdue on SLA. It’s the best place to start your day.', link: '/crm/dashboard', linkLabel: 'Open Dashboard →' },
      { q: 'How do I use it to stay efficient?', a: 'Check the overdue/SLA alerts first thing — those are customers waiting on you. Then work your My Queue down. Managers also see a team performance table here.' },
    ],
  },
  {
    id: 'customers',
    icon: <Users size={18} />,
    title: 'Customers (Leads)',
    color: '#C9A961',
    items: [
      { q: 'What is a Customer?', a: 'A customer (lead) is a person you’re working with. Open one to see their contact details, the deals (opportunities) they have, their activity history, and their current status.', link: '/crm/leads', linkLabel: 'Open Customers →' },
      { q: 'How do I call or message a customer?', a: 'Tap the phone number anywhere it appears — you’ll get one-tap Call, WhatsApp and Email buttons that open your phone’s dialer / WhatsApp directly.' },
      { q: 'How do I record what happened on a call?', a: 'On the customer’s page use the Quick Log bar at the bottom — pick Call / WhatsApp / Meeting / Note, type a line, and hit enter. It’s saved to their timeline so nothing is forgotten.' },
      { q: 'How do I set a customer’s status?', a: 'Use the Status dropdown on the customer page (Interested, Callback later, Not interested, No response, Wrong number). “Callback later” lets you pick a date/time and Pulse reminds you when it’s due.' },
      { q: 'What is the disposition board?', a: 'On the Customers page, dispositioned leads group into columns (Interested, Callback, No response…) above the table, so you can see what’s left to work and follow up in order.' },
    ],
  },
  {
    id: 'myqueue',
    icon: <Inbox size={18} />,
    title: 'My Queue',
    color: '#3B82F6',
    items: [
      { q: 'What is My Queue?', a: 'Your personal worklist of fresh customers, sorted by urgency. Overdue ones (past their first-contact SLA) are flagged red. Work this list down to keep your response time fast.', link: '/crm/my-queue', linkLabel: 'Open My Queue →' },
      { q: 'How do I action a customer quickly?', a: 'Each row has one-tap Call/WhatsApp and an inline log bar — you can call, log the outcome, and set a callback without leaving the queue.' },
    ],
  },
  {
    id: 'meetings',
    icon: <CalendarClock size={18} />,
    title: 'Meetings → your Google Calendar',
    color: '#8B5CF6',
    items: [
      { q: 'How do I schedule a client meeting?', a: 'Open the customer, go to the Meetings section, and pick a date/time + duration. The meeting is saved in Pulse and added straight to your own Google Workspace calendar (and your phone), so you never miss it.', link: '/crm/meetings', linkLabel: 'Open My Meetings →' },
      { q: 'Who can schedule a meeting?', a: 'Anyone with CRM access — not just the customer’s RM. When a colleague schedules on your customer, you’re added as a guest and notified.' },
      { q: 'Where do I see all my meetings?', a: 'The Meetings tab lists your upcoming meetings grouped Today / Tomorrow / This week / Later. You’ll also get a reminder ~30 minutes before each one.' },
    ],
  },
  {
    id: 'pipeline',
    icon: <GitBranch size={18} />,
    title: 'Pipeline',
    color: '#06B6D4',
    items: [
      { q: 'What is the Pipeline board?', a: 'A board showing every deal as a card in its current stage (Contacted → Documents → Submitted → Sanctioned → Disbursed). It’s the visual view of where all your deals stand.', link: '/crm/pipeline', linkLabel: 'Open Pipeline →' },
      { q: 'How do I move a deal forward?', a: 'Advance the stage from the deal’s page. Each stage asks for the relevant details (bank, application number, sanctioned amount, disbursal date…) so the record stays complete and feeds MIS automatically.' },
    ],
  },
  {
    id: 'commissions',
    icon: <IndianRupee size={18} />,
    title: 'Commissions',
    color: '#10B981',
    items: [
      { q: 'What are Commissions here?', a: 'The expected commission Finvastra should earn on each won deal, calculated from the slab and deal size when a deal is disbursed. (Money actually received from banks is reconciled later in MIS.)', link: '/crm/commissions', linkLabel: 'Open Commissions →' },
    ],
  },
  {
    id: 'targets',
    icon: <Target size={18} />,
    title: 'Targets',
    color: '#F59E0B',
    items: [
      { q: 'How do targets work?', a: 'Your monthly target vs. live actuals — disbursals and conversions tracked automatically as you work. Check it through the month to see how you’re tracking and where to push.', link: '/crm/targets', linkLabel: 'Open Targets →' },
    ],
  },
  {
    id: 'team',
    icon: <UsersRound size={18} />,
    title: 'My Team (managers)',
    color: '#EC4899',
    show: (c) => c.isManager,
    items: [
      { q: 'What can I see about my team?', a: 'Every team member with the status breakdown of their leads (interested, callback due, no response…), their pipeline, disbursed vs. target, and what needs action today.', link: '/crm/team', linkLabel: 'Open My Team →' },
      { q: 'How do I reassign customers between people?', a: 'Click “Manage” on a team member to see their customers, select the ones you want to move, and reassign them to another teammate. You can only move people within your own team.' },
      { q: 'I’m a super admin — can I see all teams?', a: 'Yes. Use the team picker at the top of My Team to view any manager’s team and reassign within it.' },
    ],
  },
  {
    id: 'import',
    icon: <Upload size={18} />,
    title: 'Importing & distributing leads (managers/admin)',
    color: '#6366F1',
    show: (c) => c.isManager || c.isAdmin,
    items: [
      { q: 'How do I bulk-import leads?', a: 'Use Import to bring in a Google Sheet / CSV. Leads are held unassigned with a batch name; then open the Import Queue, pick the agents, and distribute — Pulse round-robins them and sets each one’s follow-up SLA.', link: '/crm/import', linkLabel: 'Open Import →' },
    ],
  },
];
