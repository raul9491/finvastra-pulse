import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size    = 'sm' | 'md' | 'lg';

// Omit React animation/drag event handlers that conflict with Framer Motion's signatures
type NativeButtonProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'onAnimationStart' | 'onAnimationEnd' | 'onDragStart' | 'onDrag' | 'onDragEnd'
>;

export interface ButtonProps extends NativeButtonProps {
  variant?: Variant;
  size?: Size;
  /** Show a spinner and disable interactions */
  loading?: boolean;
  /** Prepend a leading icon (hidden while loading) */
  icon?: ReactNode;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0 ' +
  'disabled:opacity-50 disabled:pointer-events-none';

// Glass-friendly className (non-color parts only; colors handled via inline style)
const variantClass: Record<Variant, string> = {
  primary:   'hover:brightness-110',
  secondary: 'hover:brightness-110',
  danger:    'hover:brightness-110',
  ghost:     '',
};

// Inline styles per variant — glass backgrounds work better as inline styles
const variantStyle: Record<Variant, React.CSSProperties> = {
  primary: {
    background:  'linear-gradient(135deg, rgba(201,169,97,0.85), rgba(154,126,63,0.85))',
    color:        '#0B1538',
    border:       '1px solid rgba(201,169,97,0.40)',
    boxShadow:    '0 2px 12px rgba(201,169,97,0.20)',
  },
  secondary: {
    background:   'rgba(255,255,255,0.07)',
    color:        'var(--text-primary)',
    border:       '1px solid rgba(255,255,255,0.12)',
    backdropFilter: 'blur(8px)',
  },
  danger: {
    background:   'rgba(248,113,113,0.15)',
    color:        '#f87171',
    border:       '1px solid rgba(248,113,113,0.30)',
  },
  ghost: {
    background:   'transparent',
    color:        'var(--text-muted)',
    border:       '1px solid transparent',
  },
};

const sizeStyles: Record<Size, string> = {
  sm: 'text-xs px-3 py-1.5 h-7',
  md: 'text-sm px-4 py-2 h-9',
  lg: 'text-sm px-5 py-2.5 h-11',
};

export function Button({
  variant = 'primary',
  size    = 'md',
  loading,
  icon,
  children,
  className,
  style,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      className={cn(base, variantClass[variant], sizeStyles[size], className)}
      style={{ ...variantStyle[variant], ...style }}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={14} className="animate-spin shrink-0" /> : icon}
      {children}
    </motion.button>
  );
}
