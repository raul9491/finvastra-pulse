// ─── Global Command Palette (⌘K / Ctrl+K) ────────────────────────────────────
// Search-and-jump to any page or action across ALL modules from anywhere.
// Opens on ⌘K/Ctrl+K, or when any header "Search" button dispatches the window
// event `fv:open-command-palette`. Mounted once per shell + the launcher (only
// one is ever rendered at a time, since routes are exclusive).
//
// Data comes from the unified registry (src/config/navigation.ts), filtered to
// what the signed-in user may access. Hooks are all unconditional + top-of-fn
// (the repo has no ESLint — Rules-of-Hooks violations would crash at runtime).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { Search, CornerDownLeft, Moon, Sun, LogOut, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { useAuth } from '../../features/auth/AuthContext';
import { useTheme } from './ThemeProvider';
import {
  NAV_NODES, MODULES, buildNavCtx, resolveNavIcon, type NavNode, type ModuleKey,
} from '../../config/navigation';

export const OPEN_COMMAND_PALETTE_EVENT = 'fv:open-command-palette';

const RECENTS_KEY = 'fv-cmd-recents';
const MAX_RECENTS = 6;

function loadRecents(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function pushRecent(key: string) {
  const next = [key, ...loadRecents().filter((k) => k !== key)].slice(0, MAX_RECENTS);
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* storage full / private mode */ }
}

const MODULE_LABEL: Record<ModuleKey, string> = Object.fromEntries(MODULES.map((m) => [m.key, m.label])) as Record<ModuleKey, string>;

type ActionItem = { kind: 'action'; key: string; label: string; icon: LucideIcon; run: () => void; group: string };
type PaletteItem =
  | { kind: 'node'; key: string; node: NavNode }
  | ActionItem;

/** Cheap, dependency-free relevance: all query tokens must appear; rank exact/prefix higher. */
function scoreNode(node: NavNode, q: string): number {
  if (!q) return 0;
  const label = node.label.toLowerCase();
  const hay = `${label} ${(node.keywords ?? []).join(' ')} ${node.group} ${MODULE_LABEL[node.module]}`.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.every((t) => hay.includes(t))) return -1;
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;
  if (label.split(/\s+/).some((w) => w.startsWith(tokens[0]))) return 40;
  return 20;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { theme, toggle } = useTheme();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const ctx = useMemo(() => buildNavCtx(user, profile), [user, profile]);
  const allowedNodes = useMemo(() => NAV_NODES.filter((n) => n.access(ctx)), [ctx]);

  // Actions (always available). Kept as palette items so they're searchable too.
  const actions: ActionItem[] = useMemo(() => [
    { kind: 'action', key: 'act.theme', label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', icon: theme === 'dark' ? Sun : Moon, group: 'Actions', run: () => toggle() },
    { kind: 'action', key: 'act.signout', label: 'Sign out', icon: LogOut, group: 'Actions', run: () => { signOut(auth).catch(() => {}); } },
  ], [theme, toggle]);

  // Open/close wiring — ⌘K / Ctrl+K + the header button event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    };
  }, []);

  // Reset + focus on open.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Build the visible item list. Empty query → recents + actions; else ranked matches.
  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const recents = loadRecents()
        .map((k) => allowedNodes.find((n) => n.key === k))
        .filter((n): n is NavNode => !!n)
        .map((n) => ({ kind: 'node' as const, key: n.key, node: n }));
      return [...recents, ...actions];
    }
    const matched = allowedNodes
      .map((n) => ({ n, s: scoreNode(n, q) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || a.n.label.localeCompare(b.n.label))
      .map(({ n }) => ({ kind: 'node' as const, key: n.key, node: n }));
    const actionMatches = actions.filter((a) => a.label.toLowerCase().includes(q));
    return [...matched, ...actionMatches];
  }, [query, allowedNodes, actions]);

  // Group items for display (preserve order). Empty query labels the recents group.
  const groups = useMemo(() => {
    const q = query.trim();
    const out: { label: string; items: { item: PaletteItem; index: number }[] }[] = [];
    items.forEach((item, index) => {
      const label = item.kind === 'action'
        ? 'Actions'
        : q ? MODULE_LABEL[item.node.module] : 'Recent';
      let g = out.find((x) => x.label === label);
      if (!g) { g = { label, items: [] }; out.push(g); }
      g.items.push({ item, index });
    });
    return out;
  }, [items, query]);

  useEffect(() => { setActive(0); }, [query]);

  const run = useCallback((item: PaletteItem) => {
    setOpen(false);
    if (item.kind === 'action') { item.run(); return; }
    pushRecent(item.node.key);
    navigate(item.node.route);
  }, [navigate]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[active]; if (it) run(it); }
  };

  // Keep the active row in view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-start justify-center px-4 pt-[12vh] sm:pt-[14vh]"
      style={{ backgroundColor: 'rgba(5,13,31,0.55)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="w-full max-w-xl rounded-2xl overflow-hidden flex flex-col"
        style={{ backgroundColor: 'var(--ss-bg)', border: '1px solid var(--shell-border)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', maxHeight: '70vh' }}
        onKeyDown={onKeyDown}>
        {/* Search row */}
        <div className="flex items-center gap-2.5 px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--shell-border)' }}>
          <Search size={17} style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and actions…"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: 'var(--text-primary)' }}
          />
          <kbd className="hidden sm:inline text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--text-dim)', border: '1px solid var(--shell-border)' }}>ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto py-2">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No matches for “{query}”.</p>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="mb-1">
                <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>{g.label}</p>
                {g.items.map(({ item, index }) => {
                  const isActive = index === active;
                  const Icon = item.kind === 'node' ? resolveNavIcon(item.node.icon) : item.icon;
                  const label = item.kind === 'node' ? item.node.label : item.label;
                  const sub = item.kind === 'node' && query.trim() ? item.node.group : undefined;
                  return (
                    <button
                      key={item.key}
                      data-idx={index}
                      onMouseMove={() => setActive(index)}
                      onClick={() => run(item)}
                      className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors"
                      style={isActive ? { backgroundColor: 'rgba(201,169,97,0.14)' } : undefined}>
                      <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: isActive ? 'rgba(201,169,97,0.18)' : 'var(--shell-hover-soft)', color: isActive ? '#C9A961' : 'var(--text-muted)' }}>
                        <Icon size={15} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm truncate" style={{ color: isActive ? '#C9A961' : 'var(--text-primary)' }}>{label}</span>
                        {sub && <span className="block text-[11px] truncate" style={{ color: 'var(--text-dim)' }}>{sub}</span>}
                      </span>
                      {isActive
                        ? <CornerDownLeft size={13} style={{ color: 'var(--text-dim)' }} />
                        : <ArrowRight size={13} style={{ color: 'var(--text-dim)', opacity: 0 }} />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Fire from any header "Search" button to open the palette. */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
}

/** Header trigger — a compact "Search … ⌘K" button. Mount next to AppsMenu. */
export function CommandSearchButton() {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button
      onClick={openCommandPalette}
      title="Search (⌘K)"
      aria-label="Search"
      className="flex items-center gap-2 h-8 px-2.5 rounded-lg transition-colors hover:bg-(--shell-hover-mid)"
      style={{ border: '1px solid var(--shell-border)', color: 'var(--text-muted)' }}>
      <Search size={15} />
      <span className="hidden md:inline text-xs">Search</span>
      <kbd className="hidden md:inline text-[10px] font-semibold px-1 py-0.5 rounded" style={{ color: 'var(--text-dim)', backgroundColor: 'var(--shell-hover-soft)' }}>
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  );
}
