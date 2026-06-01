import { cn } from '../../lib/cn';

// ─── Base ─────────────────────────────────────────────────────────────────────

function SkeletonBase({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-md', className)}
      style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
    />
  );
}

// ─── Compound sub-components ──────────────────────────────────────────────────

/** One or more text-height skeleton lines. Last line is shorter when lines > 1. */
function SkeletonText({ lines = 1, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-4 animate-pulse rounded',
            i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full',
          )}
          style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
        />
      ))}
    </div>
  );
}

/** Stat-card shaped skeleton with label, big number, and sub-label rows. */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-2xl p-5 space-y-3', className)}
      style={{
        backgroundColor: 'rgba(255,255,255,0.04)',
        border:          '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div className="h-3 w-1/3 animate-pulse rounded" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
      <div className="h-8 w-2/3 animate-pulse rounded" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
      <div className="h-3 w-1/2 animate-pulse rounded" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
    </div>
  );
}

/** A skeleton `<tr>` with `cols` cells — drop-in for loading rows inside a `<tbody>`. */
function SkeletonRow({ cols = 6 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-6 py-4">
          <div
            className="h-4 animate-pulse rounded"
            style={{ width: i === cols - 1 ? 80 : '100%', backgroundColor: 'rgba(255,255,255,0.08)' }}
          />
        </td>
      ))}
    </tr>
  );
}

// ─── Namespace export ─────────────────────────────────────────────────────────

/**
 * Skeleton namespace component.
 *
 * @example
 * <Skeleton className="h-8 w-40" />           // raw base
 * <Skeleton.Text lines={3} />                  // multi-line text
 * <Skeleton.Card />                            // stat card placeholder
 * <Skeleton.Row cols={4} />                    // table row (must be inside <tbody>)
 */
export const Skeleton = Object.assign(SkeletonBase, {
  Text: SkeletonText,
  Card: SkeletonCard,
  Row:  SkeletonRow,
});
