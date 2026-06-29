import { Link } from 'react-router-dom';
import { X, Clock, ChevronRight } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useCallbackReminders } from '../hooks/useCallbackReminders';
import { ContactActions, PhoneLink } from './ContactActions';
import type { Lead } from '../../../types';

/**
 * Persistent callback reminders. Mounted once in CrmShell so it follows the user
 * across every CRM page. A card appears ~15 min before a scheduled callback and
 * STAYS until the user dismisses it with the × — these are important and must not
 * be missed. Sits top-right so it never hides behind the mobile bottom bar.
 */
export function CallbackReminderDock() {
  const { user } = useAuth();
  const { due, dismiss } = useCallbackReminders(user?.uid ?? '');
  if (due.length === 0) return null;

  return (
    <div className="fixed top-16 right-3 sm:right-4 z-[60] w-[min(92vw,22rem)] space-y-2">
      {due.slice(0, 5).map((lead) => (
        <CallbackCard key={lead.id} lead={lead} onDismiss={() => dismiss(lead)} />
      ))}
      {due.length > 5 && (
        <div className="glass-panel px-3 py-2 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
          +{due.length - 5} more callback{due.length - 5 === 1 ? '' : 's'} due
        </div>
      )}
    </div>
  );
}

function CallbackCard({ lead, onDismiss }: { lead: Lead; onDismiss: () => void }) {
  const cbMs = lead.callbackAt ? new Date(lead.callbackAt).getTime() : NaN;
  const diffMin = Math.round((cbMs - Date.now()) / 60000);
  const overdue = diffMin <= 0;
  const when =
    diffMin > 0 ? `in ${diffMin} min` :
    diffMin === 0 ? 'now' :
    `overdue by ${Math.abs(diffMin)} min`;
  const accent = overdue ? '#f87171' : '#C9A961';

  return (
    <div className="glass-panel p-3.5 shadow-lg animate-[fv-pop_0.2s_ease-out]"
      style={{ borderLeft: `3px solid ${accent}`, backgroundColor: 'var(--ss-bg)' }}>
      <div className="flex items-start gap-2">
        <Clock size={16} className="shrink-0 mt-0.5" style={{ color: accent }} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>
            Callback {when}
          </p>
          <p className="text-sm font-semibold truncate mt-0.5" style={{ color: 'var(--text-primary)' }}>
            {lead.displayName || 'Customer'}
          </p>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <PhoneLink phone={lead.phone} mono={false} className="text-xs font-medium" />
            <ContactActions phone={lead.phone} name={lead.displayName} size="sm" />
          </div>
          <Link to={`/crm/leads/${lead.id}`}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold hover:underline"
            style={{ color: accent }}>
            Open customer <ChevronRight size={12} />
          </Link>
        </div>
        <button onClick={onDismiss} aria-label="Dismiss reminder"
          className="shrink-0 p-1 rounded-md hover:bg-(--shell-hover-soft) transition-colors"
          style={{ color: 'var(--text-muted)' }}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
