import { usePresence } from '../hooks/usePresence';

/**
 * Phase P — "Also viewing:" initials chips (≤3 + "+N more").
 * Renders nothing when nobody else is on the page.
 */
export function PresenceChips({ pageKey }: { pageKey: string | null }) {
  const viewers = usePresence(pageKey);
  if (viewers.length === 0) return null;

  const shown = viewers.slice(0, 3);
  const extra = viewers.length - shown.length;

  return (
    <div className="flex items-center gap-1.5" title={viewers.map((v) => v.displayName).join(', ')}>
      <span className="text-[11px] hidden sm:inline" style={{ color: 'var(--text-muted)' }}>
        Also viewing:
      </span>
      <div className="flex -space-x-1.5">
        {shown.map((v) => (
          <div
            key={v.uid}
            title={v.displayName}
            className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold border"
            style={{ backgroundColor: '#0B1538', color: '#C9A961', borderColor: 'rgba(201,169,97,0.45)' }}
          >
            {v.avatarInitials}
          </div>
        ))}
      </div>
      {extra > 0 && (
        <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
          +{extra} more
        </span>
      )}
    </div>
  );
}
