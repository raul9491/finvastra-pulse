import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, type LucideIcon } from 'lucide-react';

export interface MobileTab {
  label: string;
  path: string;
  Icon: LucideIcon;
  /** Exact-match the path for active state (e.g. dashboards) */
  end?: boolean;
}

/**
 * Phase R — app-style bottom tab bar, mobile only (hidden ≥ md).
 * Up to 4 quick tabs per module + a Menu tab that opens the shell's drawer
 * for everything else. Fixed to the bottom with safe-area padding so it
 * clears iPhone home indicators; pages add bottom padding via the shells.
 */
export function MobileTabBar({ tabs, onMenu }: { tabs: MobileTab[]; onMenu: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  if (tabs.length === 0) return null;

  const isActive = (t: MobileTab) =>
    t.end ? pathname === t.path : pathname === t.path || pathname.startsWith(t.path + '/');

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 flex items-stretch"
      style={{
        backgroundColor: 'var(--glass-panel-bg)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderTop: '1px solid var(--shell-border-mid)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      aria-label="Quick navigation"
    >
      {tabs.slice(0, 4).map((t) => {
        const active = isActive(t);
        return (
          <button
            key={t.path}
            onClick={() => navigate(t.path)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-14 transition-colors"
            style={{ color: active ? '#C9A961' : 'var(--shell-text-dim)' }}
            aria-current={active ? 'page' : undefined}
          >
            <t.Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
            <span className="text-[10px] font-semibold leading-none" style={{ fontWeight: active ? 700 : 500 }}>
              {t.label}
            </span>
          </button>
        );
      })}
      <button
        onClick={onMenu}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-14"
        style={{ color: 'var(--shell-text-dim)' }}
        aria-label="Open full menu"
      >
        <Menu size={20} strokeWidth={1.8} />
        <span className="text-[10px] font-semibold leading-none">Menu</span>
      </button>
    </nav>
  );
}
