/**
 * OrgChartPage — CSS tree built from the `managerId` field on user docs.
 *
 * - Root: Ajay Newatia (FAPL-000, UID 3zdX5QBnTbQAcTdLzUjfXxefP8r2).
 * - Employees whose managerId is absent or points to an unknown UID are attached
 *   directly under root so no one is lost.
 * - Max rendered depth: 10 (prevents infinite loops from bad data).
 * - Collapse/expand per node (state held in a Set of collapsed UIDs).
 * - Department filter: shows only the subtree containing employees in the chosen
 *   department (preserves ancestor chain for context).
 * - Visible to all authenticated employees (read-only).
 */

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Users } from 'lucide-react';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { DEPARTMENTS } from '../../../config/hrmsConfig';

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
    employeeStatus?: string;
  }[],
): OrgNode {
  // Only include active employees
  const active = employees.filter(
    (e) => !e.employeeStatus || e.employeeStatus === 'active',
  );

  const byUid = new Map(active.map((e) => [e.userId, e]));

  // childrenOf[uid] = list of direct-report uids
  const childrenOf = new Map<string, string[]>();
  const attached   = new Set<string>();

  for (const emp of active) {
    if (emp.userId === ROOT_UID) continue; // root handled separately
    const parentId =
      emp.managerId && byUid.has(emp.managerId) ? emp.managerId : ROOT_UID;
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId)!.push(emp.userId);
    attached.add(emp.userId);
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

// ─── OrgCard ──────────────────────────────────────────────────────────────────

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
  return dept ? (DEPT_COLORS[dept] ?? '#8B8B85') : '#8B8B85';
}

function avatarInitial(name: string): string {
  const parts = name.trim().split(' ');
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

interface OrgCardProps {
  node:       OrgNode;
  collapsed:  Set<string>;
  onToggle:   (uid: string) => void;
  depth:      number;
}

function OrgCard({ node, collapsed, onToggle, depth }: OrgCardProps) {
  const isCollapsed = collapsed.has(node.userId);
  const hasKids     = node.children.length > 0;
  const color       = deptColor(node.department);

  return (
    <div className="flex flex-col items-center" style={{ minWidth: 0 }}>
      {/* Card */}
      <div
        className="relative group rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md"
        style={{
          borderColor: color + '44',
          borderTopWidth: 3,
          borderTopColor: color,
          width: 164,
          userSelect: 'none',
        }}
      >
        {/* Avatar */}
        <div className="flex flex-col items-center pt-4 pb-3 px-3 gap-1">
          <div
            className="rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
            style={{
              width: 44,
              height: 44,
              backgroundColor: color,
              fontSize: 15,
            }}
          >
            {node.photoURL
              ? <img src={node.photoURL} alt="" className="w-full h-full rounded-full object-cover" />
              : avatarInitial(node.displayName)}
          </div>

          <p
            className="text-xs font-semibold text-center leading-tight mt-1"
            style={{ color: '#0A0A0A', maxWidth: 130 }}
          >
            {node.displayName}
          </p>

          {node.designation && (
            <p
              className="text-[10px] text-center leading-tight"
              style={{ color: '#8B8B85', maxWidth: 130 }}
            >
              {node.designation}
            </p>
          )}

          {node.employeeId && (
            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{ backgroundColor: '#F1F5F9', color: '#64748B' }}
            >
              {node.employeeId}
            </span>
          )}

          {node.department && (
            <span
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5"
              style={{
                backgroundColor: color + '18',
                color: color,
              }}
            >
              {node.department.split(' ')[0]}
            </span>
          )}
        </div>

        {/* Expand / collapse toggle */}
        {hasKids && (
          <button
            onClick={() => onToggle(node.userId)}
            className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full border-2 flex items-center justify-center bg-white z-10 transition-colors hover:border-gold"
            style={{ borderColor: color }}
            title={isCollapsed ? `Show ${node.children.length} report${node.children.length !== 1 ? 's' : ''}` : 'Collapse'}
          >
            {isCollapsed
              ? <ChevronRight size={12} style={{ color }} />
              : <ChevronDown  size={12} style={{ color }} />}
          </button>
        )}
      </div>

      {/* Vertical connector down to children bar */}
      {hasKids && !isCollapsed && (
        <div className="flex flex-col items-center">
          {/* Short vertical line from card to horizontal bar */}
          <div className="w-px bg-slate-200" style={{ height: 28 }} />

          {/* Horizontal bar spanning all children */}
          <div className="relative flex items-start justify-center gap-6">
            {/* The horizontal line */}
            {node.children.length > 1 && (
              <div
                className="absolute top-0 bg-slate-200"
                style={{
                  height: 1,
                  left:  '50%',
                  right: '50%',
                  transform: 'none',
                  // We'll use CSS trick: span from leftmost to rightmost child center
                  // by making it full-width of the container minus padding
                  width: '100%',
                }}
              />
            )}

            {node.children.map((child) => (
              <div key={child.userId} className="flex flex-col items-center pt-0">
                {/* Vertical drop to child card */}
                <div className="w-px bg-slate-200" style={{ height: 18 }} />
                <OrgCard
                  node={child}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  depth={depth + 1}
                />
              </div>
            ))}
          </div>
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
    // Collect all non-leaf UIDs
    const allInternal = new Set<string>();
    function walk(node: OrgNode) {
      if (node.children.length > 0) {
        allInternal.add(node.userId);
        node.children.forEach(walk);
      }
    }
    walk(tree);
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
      <div>
        <h2
          className="text-3xl mb-1"
          style={{
            fontFamily: '"Fraunces", Georgia, serif',
            fontStyle: 'italic',
            fontVariationSettings: '"SOFT" 30',
            fontWeight: 300,
            color: '#0A0A0A',
          }}
        >
          Organisation Chart
        </h2>
        <p className="text-sm" style={{ color: '#8B8B85' }}>
          Reporting structure across Finvastra
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Department filter */}
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-gold"
          style={{ color: '#0A0A0A', minWidth: 200 }}
        >
          <option value="">All Departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs" style={{ color: '#8B8B85' }}>
            {visibleCount} {deptFilter ? `in ${deptFilter.split(' ')[0]}` : 'employees'}
          </span>
          <button
            onClick={expandAll}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
            style={{ color: '#0A0A0A' }}
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
            style={{ color: '#0A0A0A' }}
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Chart canvas */}
      <div
        className="bg-white rounded-2xl border border-slate-200 overflow-auto"
        style={{ minHeight: 400 }}
      >
        {loading ? (
          <div className="flex items-center justify-center h-64 gap-2">
            <div className="w-5 h-5 rounded-full border-2 border-gold border-t-transparent animate-spin" />
            <span className="text-sm" style={{ color: '#8B8B85' }}>Loading…</span>
          </div>
        ) : !filteredTree ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2">
            <Users size={36} className="text-slate-200" />
            <p className="text-sm" style={{ color: '#8B8B85' }}>
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
          <div className="p-8 overflow-x-auto">
            <div className="inline-flex" style={{ minWidth: 'max-content' }}>
              <OrgCard
                node={filteredTree}
                collapsed={collapsed}
                onToggle={toggle}
                depth={0}
              />
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
