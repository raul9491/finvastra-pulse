/**
 * OrgChartPage — indented vertical tree built from each user's reporting manager.
 *
 * Layout: a top-to-bottom indented list (like a file explorer), NOT a wide card
 * tree — so it never needs horizontal scrolling and reads cleanly on any screen,
 * however many direct reports a manager has.
 *
 * Manager resolution (per active employee), in order:
 *   reportingManagerUid → legacy managerId → reportingManagerName matched against
 *   employee display names (name fallback for records that saved only the name).
 *
 * - Root: Ajay Newatia (FAPL-000). Anyone whose manager can't be resolved attaches
 *   directly under root so no one is lost.
 * - Max rendered depth: 10 (guards against circular references in bad data).
 * - Collapse/expand per node; department filter keeps the ancestor chain for context.
 * - Visible to all authenticated employees (read-only).
 */

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Users } from 'lucide-react';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { DEPARTMENTS } from '../../../config/hrmsConfig';
import { PageHeader } from '../../../components/ui/primitives';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROOT_UID  = '3zdX5QBnTbQAcTdLzUjfXxefP8r2'; // Ajay Newatia FAPL-000
const MAX_DEPTH = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrgNode {
  userId:      string;
  displayName: string;
  employeeId?: string;
  designation?: string;
  department?:  string;
  photoURL:     string;
  children:     OrgNode[];
}

// ─── Build tree ───────────────────────────────────────────────────────────────

function buildTree(
  employees: {
    userId: string;
    displayName: string;
    employeeId?: string;
    designation?: string;
    department?: string;
    photoURL: string;
    managerId?: string;
    reportingManagerUid?: string;
    reportingManagerName?: string;
    employeeStatus?: string;
  }[],
): OrgNode {
  // Only include active employees
  const active = employees.filter(
    (e) => !e.employeeStatus || e.employeeStatus === 'active',
  );

  const byUid = new Map(active.map((e) => [e.userId, e]));
  // Name → uid, for records that stored only the manager's *name* and not the uid.
  // The Add Employee endpoint and the bulk importer both persist
  // reportingManagerName only — this lets those link without a data migration.
  const byName = new Map<string, string>();
  for (const e of active) {
    if (e.displayName) byName.set(e.displayName.trim().toLowerCase(), e.userId);
  }

  // childrenOf[uid] = list of direct-report uids
  const childrenOf = new Map<string, string[]>();

  for (const emp of active) {
    if (emp.userId === ROOT_UID) continue; // root handled separately

    // Resolve the manager: prefer the stored uid, then legacy managerId, then
    // fall back to matching the stored manager *name* against employee names.
    let mgr = '';
    if (emp.reportingManagerUid && byUid.has(emp.reportingManagerUid)) {
      mgr = emp.reportingManagerUid;
    } else if (emp.managerId && byUid.has(emp.managerId)) {
      mgr = emp.managerId;
    } else if (emp.reportingManagerName) {
      mgr = byName.get(emp.reportingManagerName.trim().toLowerCase()) ?? '';
    }
    const parentId = mgr && mgr !== emp.userId ? mgr : ROOT_UID;

    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId)!.push(emp.userId);
  }

  function toNode(uid: string, depth: number): OrgNode {
    const emp = byUid.get(uid)!;
    const kids = (childrenOf.get(uid) ?? [])
      .sort((a, b) => {
        const nameA = byUid.get(a)?.displayName ?? '';
        const nameB = byUid.get(b)?.displayName ?? '';
        return nameA.localeCompare(nameB);
      })
      .map((childId) => (depth < MAX_DEPTH ? toNode(childId, depth + 1) : null))
      .filter((n): n is OrgNode => n !== null);

    return {
      userId:      emp.userId,
      displayName: emp.displayName,
      employeeId:  emp.employeeId,
      designation: emp.designation,
      department:  emp.department,
      photoURL:    emp.photoURL,
      children:    kids,
    };
  }

  // Ensure root exists even if not in active list (super-admin may have no managerId)
  if (!byUid.has(ROOT_UID)) {
    return {
      userId:      ROOT_UID,
      displayName: 'Ajay Newatia',
      employeeId:  'FAPL-000',
      designation: 'Co-Founder & Director',
      department:  'Management',
      photoURL:    '',
      children:    [],
    };
  }

  return toNode(ROOT_UID, 0);
}

// ─── Filter: keep subtree containing department match ────────────────────────

function filterTree(node: OrgNode, dept: string): OrgNode | null {
  if (!dept) return node; // no filter — return as-is

  // Recurse children first
  const filteredKids = node.children
    .map((c) => filterTree(c, dept))
    .filter((c): c is OrgNode => c !== null);

  const selfMatch = node.department === dept;
  if (!selfMatch && filteredKids.length === 0) return null;

  return { ...node, children: filteredKids };
}

// ─── Colours / helpers ────────────────────────────────────────────────────────

const DEPT_COLORS: Record<string, string> = {
  'Management':                          '#C9A961',
  'Business Development & Client Relations': '#3B82F6',
  'Digital Marketing':                   '#8B5CF6',
  'Human Resources':                     '#EC4899',
  'Finance & Accounts':                  '#10B981',
  'Technology':                          '#F59E0B',
  'Operations':                          '#06B6D4',
  'Admin & Facilities':                  '#6366F1',
  'Housekeeping':                        '#84CC16',
  'Consultant':                          '#F97316',
};

function deptColor(dept?: string): string {
  return dept ? (DEPT_COLORS[dept] ?? 'var(--text-muted)') : 'var(--text-muted)';
}

function avatarInitial(name: string): string {
  const parts = name.trim().split(' ');
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

// ─── OrgRow — one indented row, recurses for children ─────────────────────────

interface OrgRowProps {
  node:      OrgNode;
  collapsed: Set<string>;
  onToggle:  (uid: string) => void;
}

function OrgRow({ node, collapsed, onToggle }: OrgRowProps) {
  const isCollapsed = collapsed.has(node.userId);
  const hasKids     = node.children.length > 0;
  const color       = deptColor(node.department);

  return (
    <div>
      {/* Row */}
      <div className="flex items-center gap-2.5 py-1.5 pl-1 pr-2 rounded-lg transition-colors hover:bg-(--glass-panel-bg)">
        {/* Chevron / spacer (keeps avatars aligned whether or not there are reports) */}
        {hasKids ? (
          <button
            onClick={() => onToggle(node.userId)}
            className="w-5 h-5 flex items-center justify-center rounded shrink-0 transition-colors hover:bg-(--shell-hover-hard)"
            style={{ color: 'var(--text-muted)' }}
            title={isCollapsed ? `Show ${node.children.length} report${node.children.length !== 1 ? 's' : ''}` : 'Collapse'}
          >
            {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          </button>
        ) : (
          <span className="w-5 h-5 shrink-0" />
        )}

        {/* Avatar */}
        <div
          className="rounded-full flex items-center justify-center text-white font-bold shrink-0 overflow-hidden"
          style={{ width: 34, height: 34, backgroundColor: color, fontSize: 12 }}
        >
          {node.photoURL
            ? <img src={node.photoURL} alt="" className="w-full h-full object-cover" />
            : avatarInitial(node.displayName)}
        </div>

        {/* Name + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {node.displayName}
            </span>
            {node.employeeId && (
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
                style={{ backgroundColor: 'var(--glass-panel-bg)', color: 'var(--text-muted)' }}
              >
                {node.employeeId}
              </span>
            )}
            {node.department && (
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                style={{ backgroundColor: color + '18', color }}
              >
                {node.department.split(' ')[0]}
              </span>
            )}
          </div>
          {node.designation && (
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{node.designation}</p>
          )}
        </div>

        {/* Report count */}
        {hasKids && (
          <span className="text-[11px] shrink-0 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
            {node.children.length} report{node.children.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Children — indented with a guide line */}
      {hasKids && !isCollapsed && (
        <div className="ml-4 pl-3 border-l" style={{ borderColor: 'var(--shell-border)' }}>
          {node.children.map((child) => (
            <OrgRow key={child.userId} node={child} collapsed={collapsed} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── OrgChartPage ────────────────────────────────────────────────────────────

export function OrgChartPage() {
  const { employees, loading } = useAllEmployees();
  const [collapsed,  setCollapsed]  = useState<Set<string>>(new Set());
  const [deptFilter, setDeptFilter] = useState('');

  const tree = useMemo(() => buildTree(employees), [employees]);

  const filteredTree = useMemo(
    () => filterTree(tree, deptFilter),
    [tree, deptFilter],
  );

  const toggle = (uid: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else               next.add(uid);
      return next;
    });
  };

  const collapseAll = () => {
    // Collapse everything except the root, so the top person stays visible
    const allInternal = new Set<string>();
    function walk(node: OrgNode, depth: number) {
      if (node.children.length > 0) {
        if (depth > 0) allInternal.add(node.userId);
        node.children.forEach((c) => walk(c, depth + 1));
      }
    }
    walk(tree, 0);
    setCollapsed(allInternal);
  };

  const expandAll = () => setCollapsed(new Set());

  // Count employees in current view
  const visibleCount = useMemo(() => {
    if (!filteredTree) return 0;
    let count = 0;
    function count_(n: OrgNode) {
      count++;
      n.children.forEach(count_);
    }
    count_(filteredTree);
    return count;
  }, [filteredTree]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Organisation Chart"
        subtitle="Reporting structure across Finvastra"
        pinKey="hrms.orgchart"
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Department filter */}
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="border border-(--shell-border) rounded-xl px-3 py-2 text-sm bg-(--glass-panel-bg) outline-none focus:ring-2 focus:ring-gold"
          style={{ color: 'var(--text-primary)', minWidth: 200 }}
        >
          <option value="">All Departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {visibleCount} {deptFilter ? `in ${deptFilter.split(' ')[0]}` : 'employees'}
          </span>
          <button
            onClick={expandAll}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors"
            style={{ color: 'var(--text-primary)' }}
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors"
            style={{ color: 'var(--text-primary)' }}
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Chart canvas — indented tree, vertical growth only */}
      <div
        className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden"
        style={{ minHeight: 300 }}
      >
        {loading ? (
          <div className="flex items-center justify-center h-64 gap-2">
            <div className="w-5 h-5 rounded-full border-2 border-gold border-t-transparent animate-spin" />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</span>
          </div>
        ) : !filteredTree ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2">
            <Users size={36} className="text-(--text-dim)" />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No employees in <strong>{deptFilter}</strong>.
            </p>
            <button
              onClick={() => setDeptFilter('')}
              className="text-xs underline"
              style={{ color: '#C9A961' }}
            >
              Clear filter
            </button>
          </div>
        ) : (
          <div className="p-3 sm:p-5">
            <div className="max-w-3xl">
              <OrgRow node={filteredTree} collapsed={collapsed} onToggle={toggle} />
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(DEPT_COLORS).map(([dept, color]) => (
          <button
            key={dept}
            onClick={() => setDeptFilter(deptFilter === dept ? '' : dept)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-opacity hover:opacity-70"
            style={{
              backgroundColor: color + '18',
              color,
              outline: deptFilter === dept ? `2px solid ${color}` : 'none',
              outlineOffset: 1,
            }}
          >
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            {dept}
          </button>
        ))}
      </div>
    </div>
  );
}
