// ─── ModuleSidebar — the unified, registry-driven sidebar (Phase 2) ───────────
// One sidebar body shared by all 3 shells. Renders: a Pinned section (top) +
// grouped collapsible sections derived from src/config/navigation.ts, filtered
// to the current module + the caller's access ctx.
//
// Badges STAY computed in the shells (their live Firestore subscriptions) and are
// passed in: `itemBadges` keyed by node.route, `sectionBadges` keyed by group.
// Persistent open-sections + pins come from useUiPrefs (localStorage).
//
// All hooks are unconditional + top-of-component (no ESLint in this repo).

import { NavLink } from 'react-router-dom';
import { ChevronDown, Star } from 'lucide-react';
import { useUiPrefs } from '../../features/auth/hooks/useUiPrefs';
import { PinButton } from '../ui/PinButton';
import {
  moduleNodes, nodeByKey, resolveNavIcon, NODE_DATA_TOUR, MODULE_GROUP_ORDER,
  type ModuleKey, type NavAccessCtx, type NavNode,
} from '../../config/navigation';

export type BadgeColor = 'gold' | 'red' | 'amber';
const BADGE_STYLE: Record<BadgeColor, { bg: string; fg: string }> = {
  gold:  { bg: 'rgba(201,169,97,0.20)', fg: '#C9A961' },
  red:   { bg: 'rgba(248,113,113,0.20)', fg: '#f87171' },
  amber: { bg: 'rgba(217,119,6,0.20)',  fg: '#fbbf24' },
};

type BadgeValue = number | { count: number; color?: BadgeColor };
function normBadge(v: BadgeValue | undefined): { count: number; color: BadgeColor } | null {
  if (v === undefined) return null;
  const count = typeof v === 'number' ? v : v.count;
  if (!count || count <= 0) return null;
  return { count, color: typeof v === 'number' ? 'red' : (v.color ?? 'red') };
}

export interface ModuleSidebarProps {
  module: ModuleKey;
  navCtx: NavAccessCtx;
  pathname: string;
  itemBadges?: Record<string, BadgeValue>;                               // node.route -> badge
  sectionBadges?: Record<string, { count: number; color?: BadgeColor }>; // group -> badge
  onNavigate?: () => void;                                               // close mobile drawer
}

function isActive(pathname: string, node: NavNode): boolean {
  const route = node.route.replace(/\?.*$/, '');
  return (node.end ?? false) ? pathname === route : pathname === route || pathname.startsWith(route + '/');
}

function NavRow({ node, pathname, badge, onNavigate, tour = true }: {
  node: NavNode; pathname: string; badge?: BadgeValue; onNavigate?: () => void; tour?: boolean;
}) {
  const Icon = resolveNavIcon(node.icon);
  const active = isActive(pathname, node);
  const b = normBadge(badge);
  return (
    <div className="group/navrow relative">
      <NavLink
        to={node.route}
        data-tour={tour ? NODE_DATA_TOUR[node.key] : undefined}
        end={node.end ?? false}
        onClick={onNavigate}
        className={`flex items-center gap-3 py-2.5 rounded-lg transition-colors ${active ? 'pl-2.5 border-l-2' : 'pl-3 nav-item-hover'}`}
        style={active
          ? { backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961', borderColor: '#C9A961' }
          : { color: 'var(--shell-text-secondary)' }}
      >
        <Icon size={17} className="shrink-0" />
        <span className="text-sm flex-1 truncate">{node.label}</span>
        {b && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none" style={{ backgroundColor: BADGE_STYLE[b.color].bg, color: BADGE_STYLE[b.color].fg }}>{b.count}</span>
        )}
        {/* reserve room for the hover pin so the label never sits under it */}
        <span className="w-5 shrink-0" aria-hidden />
      </NavLink>
      <PinButton nodeKey={node.key} className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover/navrow:opacity-100 focus-within:opacity-100" />
    </div>
  );
}

function Section({ module, group, nodes, pathname, itemBadges, badge, onNavigate }: {
  module: ModuleKey; group: string; nodes: NavNode[]; pathname: string;
  itemBadges: Record<string, BadgeValue>; badge?: { count: number; color?: BadgeColor }; onNavigate?: () => void;
}) {
  const { isGroupOpen, toggleGroup } = useUiPrefs();
  const hasActive = nodes.some((n) => isActive(pathname, n));
  const open = isGroupOpen(module, group) || hasActive;
  const bs = badge && badge.count > 0 ? BADGE_STYLE[badge.color ?? 'red'] : null;
  return (
    <div>
      <button onClick={() => toggleGroup(module, group)} className="w-full flex items-center justify-between px-3 pt-4 pb-2 nav-item-hover rounded-lg">
        <span className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: 'var(--shell-text-dim)' }}>{group}</span>
        <span className="flex items-center gap-1.5">
          {bs && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none" style={{ backgroundColor: bs.bg, color: bs.fg }}>{badge!.count}</span>}
          <ChevronDown size={12} className="shrink-0 transition-transform" style={{ color: 'var(--shell-text-dim)', transform: open ? 'none' : 'rotate(-90deg)' }} />
        </span>
      </button>
      {open && (
        <div className="space-y-0.5">
          {nodes.map((n) => <NavRow key={n.key} node={n} pathname={pathname} badge={itemBadges[n.route]} onNavigate={onNavigate} />)}
        </div>
      )}
    </div>
  );
}

export function ModuleSidebar({ module, navCtx, pathname, itemBadges = {}, sectionBadges = {}, onNavigate }: ModuleSidebarProps) {
  const { pins } = useUiPrefs();
  const nodes = moduleNodes(module, navCtx);

  // Group nodes by section, preserving MODULE_GROUP_ORDER (moduleNodes already sorted).
  const order = MODULE_GROUP_ORDER[module] ?? [];
  const groups: { group: string; nodes: NavNode[] }[] = [];
  for (const n of nodes) {
    let g = groups.find((x) => x.group === n.group);
    if (!g) { g = { group: n.group, nodes: [] }; groups.push(g); }
    g.nodes.push(n);
  }
  groups.sort((a, b) => (order.indexOf(a.group) + 1 || 99) - (order.indexOf(b.group) + 1 || 99));

  const pinnedNodes = pins
    .map(nodeByKey)
    .filter((n): n is NavNode => !!n && n.module === module && n.access(navCtx));

  return (
    <div className="space-y-1">
      {pinnedNodes.length > 0 && (
        <div>
          <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
            <Star size={10} fill="#C9A961" style={{ color: '#C9A961' }} />
            <span className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: 'var(--shell-text-dim)' }}>Pinned</span>
          </div>
          <div className="space-y-0.5">
            {pinnedNodes.map((n) => <NavRow key={`pin-${n.key}`} node={n} pathname={pathname} badge={itemBadges[n.route]} onNavigate={onNavigate} tour={false} />)}
          </div>
        </div>
      )}

      {groups.map(({ group, nodes }) =>
        nodes.length === 1
          ? <NavRow key={group} node={nodes[0]} pathname={pathname} badge={itemBadges[nodes[0].route]} onNavigate={onNavigate} />
          : <Section key={group} module={module} group={group} nodes={nodes} pathname={pathname} itemBadges={itemBadges} badge={sectionBadges[group]} onNavigate={onNavigate} />,
      )}
    </div>
  );
}
