// Canonical Finvastra brand mark. All shells and public pages use this.
// Light variant: white wordmark (for dark/navy backgrounds).
// Default: navy wordmark (for light backgrounds).

interface VastraLogoProps {
  className?: string;
  iconOnly?: boolean;
  light?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const ICON_SIZES = { sm: 'w-7 h-7', md: 'w-10 h-10', lg: 'w-16 h-16' } as const;

export function VastraLogo({
  className = '',
  iconOnly = false,
  light = false,
  size = 'md',
}: VastraLogoProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Diamond mark — 4 rotated rounded squares with gold stroke */}
      <div className="relative shrink-0">
        <svg viewBox="0 0 100 100" className={`${ICON_SIZES[size]} drop-shadow-sm`} aria-hidden>
          <g transform="translate(50,50) scale(0.9)">
            <rect x="-15" y="-38" width="30" height="30" rx="6" fill="none" stroke="#C9A961" strokeWidth="7" transform="rotate(45 0 -23)" />
            <rect x="-15" y="8"   width="30" height="30" rx="6" fill="none" stroke="#C9A961" strokeWidth="7" transform="rotate(45 0 23)"  />
            <rect x="-38" y="-15" width="30" height="30" rx="6" fill="none" stroke="#C9A961" strokeWidth="7" transform="rotate(45 -23 0)" />
            <rect x="8"   y="-15" width="30" height="30" rx="6" fill="none" stroke="#C9A961" strokeWidth="7" transform="rotate(45 23 0)"  />
          </g>
        </svg>
      </div>

      {!iconOnly && (
        <div className="flex flex-col justify-center -mt-0.5">
          {/* Wordmark */}
          <span
            className={`text-2xl font-black tracking-tighter leading-none select-none ${light ? 'text-white' : 'text-navy'}`}
          >
            Fin<span className="text-gold">vastra</span>
          </span>
          {/* Subline */}
          <span
            className={`text-[10px] font-bold uppercase leading-none mt-1 select-none ${light ? 'text-(--text-muted)' : 'text-gold-deep'}`}
            style={{ letterSpacing: '0.22em' }}
          >
            Pulse
          </span>
        </div>
      )}
    </div>
  );
}
