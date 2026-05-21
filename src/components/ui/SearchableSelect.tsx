import { useId, useRef, useState, useEffect, useCallback } from 'react';

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
  searchKeywords?: string[];
  disabled?: boolean;
}

// ─── SearchableSelect ─────────────────────────────────────────────────────────

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  label?: string; // for aria-label
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  emptyMessage = 'No options found.',
  className,
  required,
  disabled,
  label,
}: SearchableSelectProps) {
  const uid = useId();
  const listboxId = `ss-listbox-${uid.replace(/:/g, '')}`;
  const [isOpen, setIsOpen]       = useState(false);
  const [query,  setQuery]        = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.value === value) ?? null;

  // Filter options by query
  const filtered = query.trim() === ''
    ? options
    : options.filter((o) => {
        const q = query.toLowerCase();
        if (o.label.toLowerCase().includes(q)) return true;
        if (o.searchKeywords?.some((kw) => kw.toLowerCase().includes(q))) return true;
        return false;
      });

  // Keep highlight in bounds when filtered list changes
  useEffect(() => {
    setHighlightIdx(0);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  // Focus the filter input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const open = () => {
    if (disabled) return;
    setIsOpen(true);
    setQuery('');
    setHighlightIdx(0);
  };

  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  const select = useCallback(
    (opt: SearchableSelectOption) => {
      if (opt.disabled) return;
      onChange(opt.value);
      close();
    },
    [onChange], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        open();
      }
      return;
    }
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[highlightIdx];
      if (opt && !opt.disabled) select(opt);
    }
  };

  const highlightedOptId =
    filtered[highlightIdx] ? `ss-opt-${uid.replace(/:/g, '')}-${highlightIdx}` : undefined;

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`} onKeyDown={handleKeyDown}>
      {/* Trigger */}
      <div
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={isOpen ? highlightedOptId : undefined}
        aria-label={label}
        aria-required={required}
        tabIndex={disabled ? -1 : 0}
        onClick={open}
        className={[
          'w-full px-3.5 py-2.5 text-sm bg-white border border-slate-200 rounded-lg',
          'flex items-center justify-between gap-2 cursor-pointer select-none',
          'outline-none transition-all',
          isOpen  ? 'ring-2 ring-[#0B1538]' : '',
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-slate-300',
        ].join(' ')}
      >
        <span className={selectedOption ? 'text-[#0A0A0A]' : 'text-[#8B8B85]'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {selectedOption && !disabled && (
            <span
              role="button"
              aria-label="Clear selection"
              tabIndex={0}
              onClick={clear}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') clear(e as unknown as React.MouseEvent); }}
              className="text-[#8B8B85] hover:text-[#0A0A0A] leading-none px-0.5 outline-none focus:text-[#0A0A0A]"
            >
              ×
            </span>
          )}
          <svg
            className={`w-4 h-4 text-[#8B8B85] transition-transform ${isOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
          >
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50"
          style={{ maxHeight: 280, overflowY: 'auto' }}
        >
          {/* Filter input */}
          <div className="sticky top-0 bg-white border-b border-slate-100">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to search…"
              className="w-full px-3 py-2 text-sm outline-none bg-white"
            />
          </div>

          {/* Options */}
          {filtered.length === 0 ? (
            <div className="px-3.5 py-5 text-sm text-center" style={{ color: '#8B8B85' }}>
              {emptyMessage}
            </div>
          ) : (
            filtered.map((opt, idx) => {
              const isSelected    = opt.value === value;
              const isHighlighted = idx === highlightIdx;
              const optId         = `ss-opt-${uid.replace(/:/g, '')}-${idx}`;
              return (
                <div
                  key={opt.value}
                  id={optId}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled}
                  onMouseDown={(e) => { e.preventDefault(); select(opt); }}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className={[
                    'px-3.5 py-2.5 text-sm cursor-pointer flex items-center justify-between gap-2',
                    isHighlighted || isSelected ? 'bg-[#F2EFE7]' : '',
                    isSelected ? 'font-semibold text-[#0B1538]' : 'text-[#0A0A0A]',
                    opt.disabled ? 'opacity-40 cursor-not-allowed' : '',
                  ].join(' ')}
                >
                  <span className="flex flex-col gap-0.5 min-w-0">
                    <span className="truncate">{opt.label}</span>
                    {opt.description && (
                      <span className="text-xs" style={{ color: '#8B8B85' }}>{opt.description}</span>
                    )}
                  </span>
                  {isSelected && (
                    <span className="shrink-0 text-[#0B1538]">✓</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── MultiSearchableSelect ────────────────────────────────────────────────────

interface MultiSearchableSelectProps {
  options: SearchableSelectOption[];
  value: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  label?: string;
}

export function MultiSearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  emptyMessage = 'No options found.',
  className,
  required,
  disabled,
  label,
}: MultiSearchableSelectProps) {
  const uid = useId();
  const listboxId = `mss-listbox-${uid.replace(/:/g, '')}`;
  const [isOpen, setIsOpen]       = useState(false);
  const [query,  setQuery]        = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  const filtered = query.trim() === ''
    ? options
    : options.filter((o) => {
        const q = query.toLowerCase();
        if (o.label.toLowerCase().includes(q)) return true;
        if (o.searchKeywords?.some((kw) => kw.toLowerCase().includes(q))) return true;
        return false;
      });

  useEffect(() => { setHighlightIdx(0); }, [query]);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 0);
  }, [isOpen]);

  const open = () => {
    if (disabled) return;
    setIsOpen(true);
    setQuery('');
    setHighlightIdx(0);
  };

  const toggle = useCallback(
    (opt: SearchableSelectOption) => {
      if (opt.disabled) return;
      if (value.includes(opt.value)) {
        onChange(value.filter((v) => v !== opt.value));
      } else {
        onChange([...value, opt.value]);
      }
      // panel stays open
    },
    [value, onChange],
  );

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        open();
      }
      return;
    }
    if (e.key === 'Escape') { setIsOpen(false); setQuery(''); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[highlightIdx];
      if (opt && !opt.disabled) toggle(opt);
    }
  };

  // Trigger label
  const triggerLabel = (() => {
    if (value.length === 0) return null;
    if (value.length === 1) {
      return options.find((o) => o.value === value[0])?.label ?? '1 selected';
    }
    return `${value.length} selected`;
  })();

  const highlightedOptId =
    filtered[highlightIdx] ? `mss-opt-${uid.replace(/:/g, '')}-${highlightIdx}` : undefined;

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`} onKeyDown={handleKeyDown}>
      {/* Trigger */}
      <div
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={isOpen ? highlightedOptId : undefined}
        aria-label={label}
        aria-required={required}
        tabIndex={disabled ? -1 : 0}
        onClick={open}
        className={[
          'w-full px-3.5 py-2.5 text-sm bg-white border border-slate-200 rounded-lg',
          'flex items-center justify-between gap-2 cursor-pointer select-none',
          'outline-none transition-all',
          isOpen  ? 'ring-2 ring-[#0B1538]' : '',
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-slate-300',
        ].join(' ')}
      >
        <span className={triggerLabel ? 'text-[#0A0A0A]' : 'text-[#8B8B85]'}>
          {triggerLabel ?? placeholder}
        </span>
        <svg
          className={`w-4 h-4 text-[#8B8B85] transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50"
          style={{ maxHeight: 280, overflowY: 'auto' }}
        >
          {/* Filter input */}
          <div className="sticky top-0 bg-white border-b border-slate-100">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to search…"
              className="w-full px-3 py-2 text-sm outline-none bg-white"
            />
          </div>

          {/* Options */}
          {filtered.length === 0 ? (
            <div className="px-3.5 py-5 text-sm text-center" style={{ color: '#8B8B85' }}>
              {emptyMessage}
            </div>
          ) : (
            filtered.map((opt, idx) => {
              const isSelected    = value.includes(opt.value);
              const isHighlighted = idx === highlightIdx;
              const optId         = `mss-opt-${uid.replace(/:/g, '')}-${idx}`;
              return (
                <div
                  key={opt.value}
                  id={optId}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled}
                  onMouseDown={(e) => { e.preventDefault(); toggle(opt); }}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className={[
                    'px-3.5 py-2.5 text-sm cursor-pointer flex items-center gap-2.5',
                    isHighlighted ? 'bg-[#F2EFE7]' : '',
                    opt.disabled ? 'opacity-40 cursor-not-allowed' : '',
                  ].join(' ')}
                >
                  <span className="text-base shrink-0" style={{ color: '#0B1538' }}>
                    {isSelected ? '☑' : '□'}
                  </span>
                  <span className="flex flex-col gap-0.5 min-w-0">
                    <span className={`truncate ${isSelected ? 'font-semibold text-[#0B1538]' : 'text-[#0A0A0A]'}`}>
                      {opt.label}
                    </span>
                    {opt.description && (
                      <span className="text-xs" style={{ color: '#8B8B85' }}>{opt.description}</span>
                    )}
                  </span>
                </div>
              );
            })
          )}

          {/* Clear all */}
          {value.length > 0 && (
            <div className="sticky bottom-0 bg-white border-t border-slate-100 px-3.5 py-2">
              <button
                onMouseDown={clearAll}
                className="text-xs font-semibold underline"
                style={{ color: '#8B8B85' }}
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
