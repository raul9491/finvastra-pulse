import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'green' | 'amber' | 'red' | 'blue' | 'navy' | 'muted';
type Size    = 'sm' | 'md';

export interface BadgeProps {
  variant?: Variant;
  size?: Size;
  /** Show a colour-matched leading dot */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

// Glass-friendly badge variants — semi-transparent backgrounds on dark surfaces
const variantStyles: Record<Variant, string> = {
  green:  'bg-[rgba(52,211,153,0.15)]  text-[#34d399]',
  amber:  'bg-[rgba(251,191,36,0.15)]  text-[#fbbf24]',
  red:    'bg-[rgba(248,113,113,0.15)] text-[#f87171]',
  blue:   'bg-[rgba(96,165,250,0.15)]  text-[#60a5fa]',
  navy:   'bg-[rgba(201,169,97,0.15)]  text-[#C9A961]',
  muted:  'bg-[rgba(255,255,255,0.08)] text-[rgba(240,236,224,0.50)]',
};

const dotColors: Record<Variant, string> = {
  green:  'bg-[#34d399]',
  amber:  'bg-[#fbbf24]',
  red:    'bg-[#f87171]',
  blue:   'bg-[#60a5fa]',
  navy:   'bg-[#C9A961]',
  muted:  'bg-[rgba(240,236,224,0.35)]',
};

const sizeStyles: Record<Size, string> = {
  sm: 'text-[10px] px-1.5 py-0.5',
  md: 'text-xs     px-2   py-0.5',
};

export function Badge({ variant = 'muted', size = 'md', dot, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-semibold rounded-full leading-none whitespace-nowrap',
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
    >
      {dot && (
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColors[variant])} />
      )}
      {children}
    </span>
  );
}
