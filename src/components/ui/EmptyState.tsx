import type { ElementType } from 'react';
import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  icon?: ElementType;
  title: string;
  body?: string;
  cta?: { label: string; onClick: () => void };
  className?: string;
}

/**
 * Centred empty-state with optional icon, title, body text and CTA button.
 * Use inside table cells (`colSpan={n}`) or as a standalone block.
 */
export function EmptyState({ icon: Icon, title, body, cta, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-8 text-center', className)}>
      {Icon && (
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mb-4 shrink-0"
          style={{ backgroundColor: 'rgba(201,169,97,0.10)' }}
        >
          <Icon size={22} style={{ color: 'rgba(201,169,97,0.60)' }} />
        </div>
      )}
      <p className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        {title}
      </p>
      {body && (
        <p className="text-sm max-w-sm" style={{ color: 'var(--text-muted)' }}>
          {body}
        </p>
      )}
      {cta && (
        <button
          onClick={cta.onClick}
          className="mt-4 text-sm font-semibold px-4 py-2 rounded-lg transition-all hover:brightness-110"
          style={{
            background:  'linear-gradient(135deg, rgba(201,169,97,0.85), rgba(154,126,63,0.85))',
            color:        '#0B1538',
            border:       '1px solid rgba(201,169,97,0.40)',
          }}
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}
