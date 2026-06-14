import {
  LayoutDashboard, FileSpreadsheet, GitCompareArrows, AlertTriangle,
  Wallet, SlidersHorizontal,
} from 'lucide-react';
import type { LearnSection } from '../types';

export const MIS_SECTIONS: LearnSection[] = [
  {
    id: 'overview',
    icon: <LayoutDashboard size={18} />,
    title: 'Overview — the MIS dashboard',
    color: 'var(--text-primary)',
    items: [
      { q: 'What does MIS do?', a: 'MIS is the back-office: it imports the commission statements banks/AMCs/insurers send, reconciles them against the commissions we expected from CRM, flags disputes, and calculates what each RM gets paid.', link: '/mis/overview', linkLabel: 'Open Overview →' },
      { q: 'What’s on the Overview?', a: 'Total expected vs. received commission, the variance, and a Disbursals tab that bridges from CRM (loan/app numbers, DSA codes, connector). Start here to see the month at a glance.' },
    ],
  },
  {
    id: 'statements',
    icon: <FileSpreadsheet size={18} />,
    title: 'Statements',
    color: '#C9A961',
    items: [
      { q: 'How do I upload a commission statement?', a: 'Open Statements → Upload, choose the provider, and drop in the CSV. Pulse auto-detects the columns (date, description, amount); confirm the mapping and it creates the line items.', link: '/mis/statements', linkLabel: 'Open Statements →' },
      { q: 'Can I avoid re-mapping columns every time?', a: 'Yes — save the column mapping as a template for that bank (Statement Templates). Next month the upload maps itself automatically.' },
    ],
  },
  {
    id: 'reconciliation',
    icon: <GitCompareArrows size={18} />,
    title: 'Reconciliation',
    color: '#3B82F6',
    items: [
      { q: 'What is reconciliation?', a: 'Matching each line on a bank statement to the commission we expected for a specific deal — so received money ties back to the right case. This is the core of MIS.', link: '/mis/reconciliation', linkLabel: 'Open Reconciliation →' },
      { q: 'How does Auto-Match work?', a: 'It scores each line against expected records by amount (±5%) and date (±30 days). High-confidence matches are made automatically; you match the leftovers by hand, then close the statement.' },
      { q: 'What do I do with leftover lines?', a: 'Match them manually from the line, or mark them excluded/unknown. The “Matched To” column shows the CRM loan/app number so you can confirm you’re matching the right deal.' },
    ],
  },
  {
    id: 'disputes',
    icon: <AlertTriangle size={18} />,
    title: 'Disputes',
    color: '#f87171',
    items: [
      { q: 'When does a dispute appear?', a: 'Automatically — when a reconciled line is off by more than 5% from what we expected (the bank under/over-paid). It’s created with a priority based on the amount at stake.', link: '/mis/disputes', linkLabel: 'Open Disputes →' },
      { q: 'How do I work a dispute?', a: 'Assign it to yourself, add notes as you chase the bank, then Resolve it (paid correctly) or Write it off (with a reason). Nothing falls through the cracks.' },
    ],
  },
  {
    id: 'payouts',
    icon: <Wallet size={18} />,
    title: 'RM Payouts',
    color: '#10B981',
    items: [
      { q: 'How are RM payouts calculated?', a: 'On money actually received (not just expected). Pick a period, Pulse finds the paid commissions per RM, applies their payout slab, and creates a draft payout.', link: '/mis/payouts', linkLabel: 'Open RM Payouts →' },
      { q: 'How do I release a payout?', a: 'Review the draft, Approve it, then mark it Paid with a payment reference. The status moves draft → approved → paid so there’s a clear audit trail.' },
    ],
  },
  {
    id: 'admin',
    icon: <SlidersHorizontal size={18} />,
    title: 'Admin — slabs & templates',
    color: '#6366F1',
    show: (c) => c.isAdmin,
    items: [
      { q: 'Payout Slabs', a: 'Set the % each role/RM earns on received commission, by business line, with effective dates. User-specific slabs override role-based ones.', link: '/mis/admin/payout-slabs', linkLabel: 'Open Payout Slabs →' },
      { q: 'Statement Templates', a: 'Per-bank column mappings so uploads auto-map. Seed the common banks once and statement imports become one click.', link: '/mis/admin/statement-templates', linkLabel: 'Open Templates →' },
    ],
  },
];
