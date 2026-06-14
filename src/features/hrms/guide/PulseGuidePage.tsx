import {
  Clock, CalendarOff, ReceiptText, Receipt, FileSearch2,
  FolderOpen, Megaphone, Users, TrendingUp, BookOpen, LifeBuoy, Shield,
} from 'lucide-react';
import { LearnView } from '../../learn/LearnView';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Section {
  id: string;
  icon: React.ReactNode;
  title: string;
  color: string;
  items: GuideItem[];
}

interface GuideItem {
  q: string;
  a: React.ReactNode;
  link?: string;
  linkLabel?: string;
}

// ─── Content ──────────────────────────────────────────────────────────────────

const SECTIONS: Section[] = [
  {
    id: 'attendance',
    icon: <Clock size={18} />,
    title: 'Attendance & Clock In/Out',
    color: 'var(--text-primary)',
    items: [
      {
        q: 'How do I clock in?',
        a: 'Go to Attendance in the sidebar. Click the green "Clock In" button. Your check-in time is recorded instantly. Clock out using the same button at the end of the day.',
        link: '/hrms/attendance',
        linkLabel: 'Go to Attendance →',
      },
      {
        q: 'Can I clock in from my phone?',
        a: 'Yes. Open pulse.finvastra.com in any browser on your phone. The app is fully mobile-responsive. Log in and use the Attendance page exactly like on desktop.',
      },
      {
        q: 'I forgot to clock in — what happens?',
        a: 'Your attendance will show as Absent for that day. Contact HR or your manager to mark your attendance manually. Only an admin/HR manager can override attendance records.',
      },
      {
        q: 'What are working hours?',
        a: 'Monday to Saturday. Standard office hours are 9:30 AM to 6:30 PM. Check with HR for your specific schedule or if you are on flexible timings.',
      },
    ],
  },
  {
    id: 'leave',
    icon: <CalendarOff size={18} />,
    title: 'Leave Applications',
    color: '#C9A961',
    items: [
      {
        q: 'How do I apply for leave?',
        a: 'Go to Leave → Apply for Leave. Fill in the leave type, dates, and reason. Submit — your manager/HR will receive it for approval. You\'ll see the status update in real time.',
        link: '/hrms/leave/apply',
        linkLabel: 'Apply for Leave →',
      },
      {
        q: 'What leave types are available?',
        a: (
          <div className="space-y-1">
            <p><strong>Casual Leave (CL)</strong> — 8 days/year. For personal errands and short breaks.</p>
            <p><strong>Sick Leave (SL)</strong> — 7 days/year. Medical illness or appointments.</p>
            <p><strong>Earned Leave (EL)</strong> — 15 days/year + carry-forward up to 30 days.</p>
            <p><strong>Comp Off</strong> — Earned by working on holidays. Granted by HR.</p>
            <p><strong>LOP (Loss of Pay)</strong> — When all paid leave is exhausted.</p>
            <p><strong>Maternity Leave</strong> — As per The Maternity Benefit Act, 1961 (26 weeks).</p>
          </div>
        ),
      },
      {
        q: 'How far in advance should I apply?',
        a: 'For planned leaves (personal travel, events), apply at least 3–5 working days in advance so your manager can plan coverage. For sick leave, apply on the same day or the next working day.',
      },
      {
        q: 'Can I see my leave balance?',
        a: 'Yes. Your Dashboard shows leave balance cards for CL, SL, and EL. The Leave page shows full balance details and your application history.',
        link: '/hrms/leave',
        linkLabel: 'View Leave Balance →',
      },
    ],
  },
  {
    id: 'claims',
    icon: <ReceiptText size={18} />,
    title: 'Expense Claims & Reimbursements',
    color: '#7C3AED',
    items: [
      {
        q: 'How do I submit a claim?',
        a: 'Go to My Claims. Click "New Claim". Choose the type (travel, food, stationery, etc.), enter the amount, attach a receipt photo or scan, and submit. HR will review and approve.',
        link: '/hrms/claims',
        linkLabel: 'Go to My Claims →',
      },
      {
        q: 'What types of expenses can I claim?',
        a: (
          <div className="space-y-1">
            <p><strong>Travel</strong> — Client visits, inter-office travel. Fill in from/to location and mode of transport.</p>
            <p><strong>Food & Entertainment</strong> — Client meetings or official events only. Personal meals are not reimbursable.</p>
            <p><strong>Stationery & Printing</strong> — Office supplies purchased out-of-pocket.</p>
            <p><strong>Telephone</strong> — Official calls beyond your plan.</p>
            <p><strong>Other</strong> — Any other approved expense with prior manager consent.</p>
          </div>
        ),
      },
      {
        q: 'How long does reimbursement take?',
        a: 'Claims are typically approved within 3–5 working days. Once approved, payment is processed in the next payroll cycle or via direct bank transfer. You\'ll see the status update in the app.',
      },
    ],
  },
  {
    id: 'payslips',
    icon: <Receipt size={18} />,
    title: 'Payslips',
    color: '#166534',
    items: [
      {
        q: 'Where do I find my payslip?',
        a: 'Go to Payslips in the sidebar. All your payslips are listed by month. Click any payslip to view full details or download the PDF.',
        link: '/hrms/payslips',
        linkLabel: 'View Payslips →',
      },
      {
        q: 'When is the payslip for this month generated?',
        a: 'Payslips are generated by HR/Accounts after month-end, typically by the 5th of the following month. If you don\'t see this month\'s payslip by the 7th, contact HR.',
      },
      {
        q: 'What if my salary seems wrong?',
        a: 'Review the payslip details (basic, HRA, deductions). If there\'s a discrepancy, raise an HR Helpdesk ticket from the sidebar with the specific amounts in question.',
        link: '/hrms/hr-helpdesk',
        linkLabel: 'Raise an HR Ticket →',
      },
    ],
  },
  {
    id: 'itdecl',
    icon: <FileSearch2 size={18} />,
    title: 'IT Declaration',
    color: '#0891B2',
    items: [
      {
        q: 'What is IT Declaration?',
        a: 'The Income Tax Declaration form where you declare your investments (PPF, LIC, ELSS, HRA, home loan, etc.) for the financial year. This helps HR compute your correct TDS (tax deducted at source) from salary.',
      },
      {
        q: 'When should I submit the declaration?',
        a: 'Submit before the deadline set by HR (typically June–July for the start of FY). Late submissions mean more TDS is deducted from your salary. You can revise your declaration if investments change.',
        link: '/hrms/it-declaration',
        linkLabel: 'Go to IT Declaration →',
      },
      {
        q: 'Do I need physical proof documents?',
        a: 'The declaration is a commitment. HR may ask for actual investment proof (receipts, statements) in January–February for the final TDS computation. Keep scanned copies ready.',
      },
    ],
  },
  {
    id: 'documents',
    icon: <FolderOpen size={18} />,
    title: 'Company Documents',
    color: '#D97706',
    items: [
      {
        q: 'Where are company policies and handbooks?',
        a: 'Go to Documents in the sidebar. You\'ll find HR policies, employee handbook, circulars, and other company documents uploaded by HR.',
        link: '/hrms/documents',
        linkLabel: 'Open Documents →',
      },
      {
        q: 'Can I upload my own documents?',
        a: 'You can upload personal documents (offer letter, certificates, ID proofs) to your employee profile. Go to your Employee Profile → scroll to "My Documents" section.',
        link: '/hrms/employees',
        linkLabel: 'Open My Profile →',
      },
    ],
  },
  {
    id: 'profile',
    icon: <Users size={18} />,
    title: 'Your Profile',
    color: '#DB2777',
    items: [
      {
        q: 'How do I update my contact details?',
        a: 'Go to Employees → find yourself → open your profile. Click "Edit My Details". You can update your phone number, personal email, present address, blood group, and emergency contact.',
      },
      {
        q: 'Can I change my bank account or official details?',
        a: 'Bank details, PAN, and official joining information can only be updated by HR. Raise an HR Helpdesk ticket or speak to HR directly.',
      },
      {
        q: 'How do I see assets assigned to me?',
        a: 'Your profile page shows the "Assigned Assets" section with any company equipment (laptop, SIM, etc.) currently assigned to you. This is updated by HR/IT.',
      },
    ],
  },
  {
    id: 'announcements',
    icon: <Megaphone size={18} />,
    title: 'Announcements',
    color: '#4F46E5',
    items: [
      {
        q: 'How do I see company announcements?',
        a: 'Go to Announcements in the sidebar. Urgent and pinned announcements also appear as banners on the Dashboard so you never miss important updates.',
        link: '/hrms/announcements',
        linkLabel: 'View Announcements →',
      },
      {
        q: 'Why is there a number badge on Announcements?',
        a: 'The badge shows how many announcements you haven\'t read yet. It clears automatically after you spend a few seconds on the Dashboard or when you open Announcements.',
      },
    ],
  },
  {
    id: 'performance',
    icon: <TrendingUp size={18} />,
    title: 'Performance Reviews',
    color: '#059669',
    items: [
      {
        q: 'How does the review process work?',
        a: 'Go to My Review. First, fill out your self-assessment by the deadline set by HR. Then your manager will complete their part. HR will share the final review outcome with you.',
        link: '/hrms/performance',
        linkLabel: 'Go to My Review →',
      },
      {
        q: 'What is a "360 review"?',
        a: 'Some review cycles include peer feedback from colleagues you work closely with. HR will invite you to give feedback when relevant. All feedback is visible only to HR and your manager, not the person you reviewed.',
      },
    ],
  },
  {
    id: 'training',
    icon: <BookOpen size={18} />,
    title: 'Training & Learning',
    color: '#7C3AED',
    items: [
      {
        q: 'Where do I see assigned training?',
        a: 'Go to My Training in the sidebar. HR assigns training programs — click each item to mark completion once you\'ve done it.',
        link: '/hrms/training',
        linkLabel: 'Open Training →',
      },
      {
        q: 'Can I request specific training?',
        a: 'Yes. Raise an HR Helpdesk ticket with the subject "Training Request" and mention the course/skill you want to learn. HR will evaluate and get back to you.',
      },
    ],
  },
  {
    id: 'helpdesk',
    icon: <LifeBuoy size={18} />,
    title: 'HR Helpdesk & Support',
    color: '#BE185D',
    items: [
      {
        q: 'How do I raise an HR ticket?',
        a: 'Go to HR Helpdesk in the sidebar. Choose the category, describe your issue, and submit. HR will respond in the app.',
        link: '/hrms/hr-helpdesk',
        linkLabel: 'Go to HR Helpdesk →',
      },
      {
        q: 'What kinds of issues can I raise a ticket for?',
        a: (
          <div className="space-y-1">
            <p>• Payslip discrepancies or queries</p>
            <p>• Leave balance correction requests</p>
            <p>• Document requests (offer letter, experience letter)</p>
            <p>• Salary certificate requests (for bank, visa)</p>
            <p>• IT/system access issues</p>
            <p>• Any other HR-related query</p>
          </div>
        ),
      },
      {
        q: 'Direct HR contacts',
        a: (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-(--text-primary) font-medium">HR Team</span>
              <span className="text-(--text-muted)">—</span>
              <a href="mailto:support@finvastra.com" className="text-blue-600 hover:underline">support@finvastra.com</a>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-(--text-primary) font-medium">Tech Support</span>
              <span className="text-(--text-muted)">—</span>
              <a href="mailto:rahulv@finvastra.com" className="text-blue-600 hover:underline">rahulv@finvastra.com</a>
            </div>
          </div>
        ),
      },
    ],
  },
  {
    id: 'security',
    icon: <Shield size={18} />,
    title: 'Security & Your Account',
    color: 'var(--text-muted)',
    items: [
      {
        q: 'How do I change my password?',
        a: 'Go to Settings → Reset Password. Enter your current password and your new one. Use a strong password that you don\'t use elsewhere.',
        link: '/hrms/settings',
        linkLabel: 'Go to Settings →',
      },
      {
        q: 'I think someone else has my login. What should I do?',
        a: 'Change your password immediately from Settings. Then contact IT support at rahulv@finvastra.com. Do not share your login credentials with anyone — not even HR or IT.',
      },
      {
        q: 'Is my data safe?',
        a: 'Yes. Pulse is hosted on Google Firebase with bank-grade encryption. Your payslip, leave, and personal data are only accessible to you, your manager, and HR. The platform follows DPDP Act 2023 compliance standards.',
      },
      {
        q: 'I was auto-logged out — is that normal?',
        a: 'Yes. Pulse has a 30-minute idle timeout for security. If you\'re inactive for 30 minutes, you\'ll be signed out automatically. Simply log in again.',
      },
    ],
  },
];

// ─── PulseGuidePage — HRMS "Learn" tab (powered by the shared LearnView) ──────

export function PulseGuidePage() {
  return (
    <LearnView
      module="hrms"
      title="Pulse Guide"
      intro="Everything you need to know about using Finvastra Pulse."
      quickLinks={[
        { label: 'Clock In / Out', href: '/hrms/attendance',  color: 'var(--text-primary)' },
        { label: 'Apply Leave',    href: '/hrms/leave/apply',  color: '#C9A961' },
        { label: 'Submit Claim',   href: '/hrms/claims',       color: '#7C3AED' },
        { label: 'Raise HR Ticket',href: '/hrms/hr-helpdesk',  color: '#BE185D' },
      ]}
      sections={SECTIONS}
    />
  );
}
