// Registry of the automated / recurring notifications that can be toggled on the
// super-admin Notifications settings page. Each `key` must match the key the server
// checks via notificationsEnabled(key) in server.ts / server/crm2.ts before sending.
// Default is ENABLED — the config doc app_config/notification_settings only stores a
// key when it's turned OFF (value false).

export type NotificationToggle = {
  key: string;
  label: string;
  description: string;
  group: 'Performance' | 'Reminders' | 'CRM operations' | 'Finance';
};

export const NOTIFICATION_TOGGLES: NotificationToggle[] = [
  // ── Performance (manager/RM summaries) ──
  { key: 'monthly_scorecards',   label: 'Monthly performance scorecards', group: 'Performance',
    description: "Emailed to each RM (with a PDF) on the 1st of every month." },
  { key: 'daily_briefing',       label: 'Daily RM briefing',              group: 'Performance',
    description: "Daily email to each RM: overdue SLAs, stale leads, target progress." },
  { key: 'weekly_team_digest',   label: 'Weekly team digest',             group: 'Performance',
    description: "Friday summary emailed + belled to each manager for their team." },

  // ── Reminders (time-sensitive nudges) ──
  { key: 'callback_reminders',   label: 'Callback reminders',             group: 'Reminders',
    description: "Bell + email ~15 min before a scheduled customer callback." },
  { key: 'partner_candidates',   label: 'New partner candidates',         group: 'Reminders',
    description: "Bell + email to super admins when someone asks to become a partner (website form, auto-routed lead, or manual move)." },
  { key: 'meeting_reminders',    label: 'Meeting reminders',              group: 'Reminders',
    description: "Bell + email ~30 min before a scheduled meeting." },
  { key: 'followup_reminders',   label: 'Lead follow-up reminders',       group: 'Reminders',
    description: "Alerts the owner when an active lead has had no activity for 3+ days." },
  { key: 'crm2_followup_reminders', label: 'Pipeline follow-up reminders', group: 'Reminders',
    description: "Reminders for CRM 2.0 leads whose scheduled follow-up is due." },

  // ── CRM operations (SLA / expiry watchdogs) ──
  { key: 'lead_sla_sweep',       label: 'Lead SLA breach alerts',         group: 'CRM operations',
    description: "Alerts managers when a lead misses its response-time SLA." },
  { key: 'bank_sla_check',       label: 'Bank SLA breach alerts',         group: 'CRM operations',
    description: "Daily check for bank submissions sitting past their SLA." },
  { key: 'document_expiry_check',label: 'Document expiry alerts',         group: 'CRM operations',
    description: "Daily alert for customer documents nearing their expiry." },

  // ── Finance ──
  { key: 'commission_leakage_check', label: 'Commission leakage alerts',  group: 'Finance',
    description: "Monthly check that flags commission discrepancies." },
  { key: 'payout_reminders',     label: 'Payout data-share reminders',    group: 'Finance',
    description: "Reminders on payout cycles awaiting data-share / banker confirmation." },
];

export const NOTIFICATION_GROUPS: NotificationToggle['group'][] =
  ['Performance', 'Reminders', 'CRM operations', 'Finance'];
