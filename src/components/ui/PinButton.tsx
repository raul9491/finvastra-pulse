// ─── PinButton — star toggle to pin a registry page to the sidebar top ────────
import { Star } from 'lucide-react';
import { useUiPrefs } from '../../features/auth/hooks/useUiPrefs';

export function PinButton({ nodeKey, className = '' }: { nodeKey: string; className?: string }) {
  const { isPinned, togglePin } = useUiPrefs();
  const pinned = isPinned(nodeKey);
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(nodeKey); }}
      title={pinned ? 'Unpin' : 'Pin to top'}
      aria-label={pinned ? 'Unpin' : 'Pin to top'}
      className={`shrink-0 p-1 rounded-md transition-colors hover:bg-(--shell-hover-hard) ${className}`}
    >
      <Star size={13} fill={pinned ? '#C9A961' : 'none'} style={{ color: pinned ? '#C9A961' : 'var(--text-dim)' }} />
    </button>
  );
}
