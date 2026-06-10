import type { ReactNode } from 'react';

interface NavItemProps {
  icon: ReactNode;
  label: string;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
  badge?: number;
}

export function NavItem({ icon, label, active, expanded, onClick, badge }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      title={!expanded ? label : undefined}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative ${
        active
          ? 'bg-navy text-gold shadow-[0_2px_8px_rgba(11,21,56,0.2)]'
          : 'text-(--text-muted) hover:bg-(--shell-hover-mid) hover:text-(--text-primary)'
      }`}
    >
      <div className={`shrink-0 ${active ? 'text-white' : 'text-(--text-muted) group-hover:text-(--text-muted)'}`}>
        {icon}
      </div>

      {expanded && (
        <span className="font-medium text-sm whitespace-nowrap flex-1 text-left">{label}</span>
      )}

      {badge !== undefined && badge > 0 && (
        <span
          className={`shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${
            active ? 'bg-gold text-navy' : 'bg-red-500 text-white'
          }`}
        >
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}
