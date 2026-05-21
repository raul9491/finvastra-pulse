// Skeleton loading placeholders

export function SkeletonLine({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-slate-200 rounded-lg animate-pulse ${className}`} />
  );
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white rounded-3xl border border-slate-200 p-6 animate-pulse ${className}`}>
      <div className="flex items-start gap-4 mb-4">
        <div className="w-16 h-16 bg-slate-200 rounded-2xl shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-4 bg-slate-200 rounded-lg w-3/4" />
          <div className="h-3 bg-slate-100 rounded-lg w-1/2" />
        </div>
      </div>
      <div className="space-y-2 pt-4 border-t border-slate-100">
        <div className="h-3 bg-slate-100 rounded w-full" />
        <div className="h-3 bg-slate-100 rounded w-2/3" />
      </div>
    </div>
  );
}

export function SkeletonRow({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-4 p-4 animate-pulse ${className}`}>
      <div className="w-10 h-10 bg-slate-200 rounded-xl shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 bg-slate-200 rounded w-1/3" />
        <div className="h-3 bg-slate-100 rounded w-1/4" />
      </div>
      <div className="h-3 bg-slate-100 rounded w-16" />
    </div>
  );
}

export function SkeletonStatCard() {
  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-200 animate-pulse">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 bg-slate-200 rounded-xl" />
        <div className="h-3 bg-slate-100 rounded w-12" />
      </div>
      <div className="h-8 bg-slate-200 rounded w-1/2 mb-2" />
      <div className="h-3 bg-slate-100 rounded w-3/4" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden animate-pulse">
      <div className="bg-slate-50 border-b border-slate-200 p-4 flex gap-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-3 bg-slate-200 rounded w-20" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} className="border-b border-slate-100 last:border-0" />
      ))}
    </div>
  );
}
