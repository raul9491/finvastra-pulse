interface BulkAction {
  label: string;
  value: string;
}

interface BulkActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  stageOptions: BulkAction[];
  onStageUpdate: (stage: string) => void;
  rmOptions: BulkAction[];
  onAssignRm: (userId: string) => void;
  /** Phase 2.5c: tag management — wired up in a later sub-phase */
  onAddTag: (tag: string) => void;
  isProcessing: boolean;
}

export function BulkActionBar({
  selectedCount,
  onClearSelection,
  stageOptions,
  onStageUpdate,
  rmOptions,
  onAssignRm,
  isProcessing,
}: BulkActionBarProps) {
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-xl"
      style={{ backgroundColor: 'var(--ss-bg)', color: 'var(--text-primary)', border: '1px solid #1B2A4E' }}
    >
      {/* Selection count */}
      <span className="text-sm font-semibold" style={{ color: '#C9A961' }}>
        {selectedCount} selected
      </span>

      <div className="w-px h-5 shrink-0" style={{ backgroundColor: 'var(--shell-border)' }} />

      {/* Move to stage */}
      <select
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) {
            onStageUpdate(e.target.value);
            // Reset so the same option can be re-selected after processing
            e.target.value = '';
          }
        }}
        disabled={isProcessing}
        className="text-sm px-3 py-1.5 rounded-lg outline-none bg-transparent cursor-pointer disabled:opacity-50"
        style={{ color: 'var(--text-muted)', border: '1px solid #1B2A4E' }}
      >
        <option value="" disabled style={{ backgroundColor: 'var(--ss-bg)' }}>Move to stage…</option>
        {stageOptions.map((s) => (
          <option key={s.value} value={s.value} style={{ backgroundColor: 'var(--ss-bg)' }}>
            {s.label}
          </option>
        ))}
      </select>

      {/* Assign RM */}
      <select
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) {
            onAssignRm(e.target.value);
            e.target.value = '';
          }
        }}
        disabled={isProcessing}
        className="text-sm px-3 py-1.5 rounded-lg outline-none bg-transparent cursor-pointer disabled:opacity-50"
        style={{ color: 'var(--text-muted)', border: '1px solid #1B2A4E' }}
      >
        <option value="" disabled style={{ backgroundColor: 'var(--ss-bg)' }}>Assign to RM…</option>
        {rmOptions.map((r) => (
          <option key={r.value} value={r.value} style={{ backgroundColor: 'var(--ss-bg)' }}>
            {r.label}
          </option>
        ))}
      </select>

      {/* Processing indicator */}
      {isProcessing && (
        <span className="text-xs animate-pulse" style={{ color: '#C9A961' }}>
          Processing…
        </span>
      )}

      {/* Clear selection */}
      <button
        onClick={onClearSelection}
        disabled={isProcessing}
        className="text-sm px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
        style={{ color: 'var(--text-muted)' }}
      >
        Clear
      </button>
    </div>
  );
}
