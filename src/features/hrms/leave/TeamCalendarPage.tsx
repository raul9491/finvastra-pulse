/**
 * TeamCalendarPage — visual monthly calendar showing who is on approved leave.
 *
 * Access:
 *  - Admin / isHrmsManager: sees ALL employees
 *  - Regular employee: sees own department only
 *
 * Data: approved leave_applications + holidays collection (read-only, no writes).
 * Week starts Monday (Mon–Sun columns), Sundays greyed as non-working.
 */

import { useState, useMemo } from 'react';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  parseISO, addMonths, subMonths, isSameDay, isSameMonth,
} from 'date-fns';
import { ChevronLeft, ChevronRight, CalendarDays, Filter } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAllApprovedLeaves } from '../hooks/useLeave';
import { useHolidays } from '../hooks/useHolidays';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import type { LeaveType } from '../../../types';
import { PageHeader } from '../../../components/ui/primitives';

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Mon = 0 in this layout
function dayIndex(date: Date): number {
  const d = date.getDay(); // 0=Sun...6=Sat
  return (d + 6) % 7;     // Mon=0, Tue=1, ..., Sun=6
}

const TYPE_META: Record<LeaveType, { abbr: string; bg: string; text: string }> = {
  casual:    { abbr: 'CL',  bg: '#DBEAFE', text: '#1E40AF' },
  sick:      { abbr: 'SL',  bg: '#FEE2E2', text: '#B91C1C' },
  earned:    { abbr: 'EL',  bg: '#D1FAE5', text: '#065F46' },
  comp_off:  { abbr: 'CO',  bg: '#EDE9FE', text: '#5B21B6' },
  maternity: { abbr: 'ML',  bg: '#FCE7F3', text: '#9D174D' },
  lop:       { abbr: 'LOP', bg: '#FEE2E2', text: '#9F1239' },
  optional:  { abbr: 'OL',  bg: '#CCFBF1', text: '#134E4A' },
};

const CHIP_VISIBLE_LIMIT = 3;

// ─── LeaveChip ────────────────────────────────────────────────────────────────

function LeaveChip({
  name,
  type,
}: {
  name: string;
  type: LeaveType;
}) {
  const meta = TYPE_META[type] ?? { abbr: '?', bg: 'var(--shell-hover-hard)', text: 'var(--text-secondary)' };
  const firstName = name.split(' ')[0];
  const initial = name[0].toUpperCase();

  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium truncate"
      style={{ backgroundColor: meta.bg, color: meta.text }}>
      <span className="font-bold text-[10px] shrink-0">{initial}</span>
      <span className="truncate">{firstName}</span>
      <span className="text-[9px] shrink-0 opacity-70">{meta.abbr}</span>
    </div>
  );
}

// ─── DayCell ──────────────────────────────────────────────────────────────────

interface DayLeave {
  employeeId: string;
  employeeName: string;
  type: LeaveType;
}

function DayCell({
  date,
  isCurrent,
  isToday,
  isSunday,
  holiday,
  leaves,
}: {
  date: Date;
  isCurrent: boolean;
  isToday: boolean;
  isSunday: boolean;
  holiday: string | null;
  leaves: DayLeave[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? leaves : leaves.slice(0, CHIP_VISIBLE_LIMIT);
  const overflow = leaves.length - CHIP_VISIBLE_LIMIT;

  return (
    <div
      className={`min-h-[90px] p-1.5 border-r border-b border-(--shell-border) flex flex-col gap-1 ${
        !isCurrent ? 'bg-(--glass-panel-bg)/50' : isSunday ? 'bg-(--glass-panel-bg)' : 'bg-(--glass-panel-bg)'
      } ${isToday ? 'ring-2 ring-inset ring-navy/20' : ''}`}
    >
      {/* Date number */}
      <div className="flex items-center justify-between">
        <span
          className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
            isToday ? 'text-white' : isCurrent && !isSunday ? 'text-(--text-primary)' : 'text-(--text-muted)'
          }`}
          style={isToday ? { backgroundColor: '#0B1538' } : undefined}
        >
          {isCurrent ? format(date, 'd') : ''}
        </span>
        {isCurrent && holiday && (
          <span className="text-[9px] font-bold truncate max-w-[60%] px-1 py-0.5 rounded"
            style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
            {holiday}
          </span>
        )}
      </div>

      {/* Leave chips */}
      {isCurrent && (
        <div className="flex flex-col gap-0.5">
          {visible.map((l, i) => (
            <LeaveChip key={`${l.employeeId}-${i}`} name={l.employeeName} type={l.type} />
          ))}
          {!expanded && overflow > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="text-[10px] text-(--text-muted) hover:text-(--text-primary) transition-colors text-left pl-1"
            >
              +{overflow} more
            </button>
          )}
          {expanded && overflow > 0 && (
            <button
              onClick={() => setExpanded(false)}
              className="text-[10px] text-(--text-muted) hover:text-(--text-primary) transition-colors text-left pl-1"
            >
              show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TeamCalendarPage ─────────────────────────────────────────────────────────

export function TeamCalendarPage() {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? '';
  const isAdmin       = profile?.role === 'admin';
  const isHrmsManager = profile?.isHrmsManager === true;
  const canSeeAll     = isAdmin || isHrmsManager;

  const [viewDate,   setViewDate]   = useState(() => new Date());
  const [deptFilter, setDeptFilter] = useState('');

  const viewYear  = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth(); // 0-based

  const { applications, loading: leavesLoading } = useAllApprovedLeaves();
  const { holidays } = useHolidays(viewYear);
  const { employees } = useAllEmployees();

  // ── Derived data ────────────────────────────────────────────────────────────

  // All departments for filter chips
  const departments = useMemo(
    () => [...new Set(employees.map((e) => e.department).filter(Boolean))] as string[],
    [employees],
  );

  // Build employee map: uid → { name, department }
  const empMap = useMemo(() => {
    const map = new Map<string, { name: string; department: string }>();
    for (const e of employees) {
      map.set(e.userId, { name: e.displayName, department: e.department ?? '' });
    }
    return map;
  }, [employees]);

  // For non-admin employees: set of visible UIDs = own department-mates (including self)
  const visibleUids = useMemo((): Set<string> | null => {
    if (canSeeAll) return null; // null = all
    const myDept = profile?.department ?? '';
    if (!myDept) {
      // No department? Show only self
      return new Set([uid]);
    }
    const set = new Set<string>();
    for (const e of employees) {
      if (e.department === myDept) set.add(e.userId);
    }
    return set;
  }, [canSeeAll, employees, profile?.department, uid]);

  // Holiday map: date string → holiday name
  const holidayMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of holidays) map.set(h.date, h.name);
    return map;
  }, [holidays]);

  // Filtered leaves for the current month view
  // A leave covers a day if fromDate <= day <= toDate
  const monthStart = startOfMonth(viewDate);
  const monthEnd   = endOfMonth(viewDate);
  const monthStartStr = format(monthStart, 'yyyy-MM-dd');
  const monthEndStr   = format(monthEnd,   'yyyy-MM-dd');

  const relevantLeaves = useMemo(() => {
    return applications.filter((app) => {
      // Overlap check: app.fromDate <= monthEnd AND app.toDate >= monthStart
      if (app.fromDate > monthEndStr)   return false;
      if (app.toDate   < monthStartStr) return false;
      // Employee visibility
      if (visibleUids && !visibleUids.has(app.employeeId)) return false;
      // Dept filter
      if (deptFilter) {
        const empDept = empMap.get(app.employeeId)?.department ?? '';
        if (empDept !== deptFilter) return false;
      }
      return true;
    });
  }, [applications, monthStartStr, monthEndStr, visibleUids, deptFilter, empMap]);

  // ── Calendar grid ────────────────────────────────────────────────────────────

  // Build list of days to display (includes leading/trailing pads)
  const firstDayIdx = dayIndex(monthStart); // 0=Mon...6=Sun
  const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const today = new Date();

  // Grid cells: pads at start + actual days + pads at end (to fill last row)
  const totalCells = Math.ceil((firstDayIdx + allDays.length) / 7) * 7;
  const cells: (Date | null)[] = [
    ...Array(firstDayIdx).fill(null),
    ...allDays,
    ...Array(totalCells - firstDayIdx - allDays.length).fill(null),
  ];

  // Helper: get all leaves on a given day
  function leavesOnDay(day: Date): DayLeave[] {
    const dayStr = format(day, 'yyyy-MM-dd');
    return relevantLeaves
      .filter((app) => app.fromDate <= dayStr && app.toDate >= dayStr)
      .map((app) => ({
        employeeId:   app.employeeId,
        employeeName: empMap.get(app.employeeId)?.name ?? app.employeeId,
        type:         app.type as LeaveType,
      }));
  }

  // ── Stat summary for current month ──────────────────────────────────────────
  const statsLeaves = useMemo(() => {
    // Days off = count of distinct employee-days this month
    return relevantLeaves.reduce((sum, app) => {
      // Count days this leave overlaps with the current month
      const from = app.fromDate > monthStartStr ? app.fromDate : monthStartStr;
      const to   = app.toDate   < monthEndStr   ? app.toDate   : monthEndStr;
      if (from > to) return sum;
      return sum + app.days;
    }, 0);
  }, [relevantLeaves, monthStartStr, monthEndStr]);

  const uniqueOnLeave = useMemo(
    () => new Set(relevantLeaves.map((a) => a.employeeId)).size,
    [relevantLeaves],
  );

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* ── Header ── */}
      <PageHeader
        title="Team Calendar"
        subtitle={canSeeAll ? 'Approved leave across all employees.' : `Approved leave in your team (${profile?.department ?? 'your department'}).`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewDate((d) => subMonths(d, 1))}
              className="p-2 rounded-lg hover:bg-(--glass-panel-bg) transition-colors"
            >
              <ChevronLeft size={18} style={{ color: 'var(--text-primary)' }} />
            </button>
            <div className="text-center w-32">
              <p className="text-sm font-semibold text-(--text-primary)">{format(viewDate, 'MMMM yyyy')}</p>
            </div>
            <button
              onClick={() => setViewDate((d) => addMonths(d, 1))}
              className="p-2 rounded-lg hover:bg-(--glass-panel-bg) transition-colors"
            >
              <ChevronRight size={18} style={{ color: 'var(--text-primary)' }} />
            </button>
            {/* Jump to today */}
            {!isSameMonth(viewDate, today) && (
              <button
                onClick={() => setViewDate(new Date())}
                className="ml-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-(--shell-border) hover:bg-(--glass-panel-bg)"
                style={{ color: 'var(--text-primary)' }}
              >
                Today
              </button>
            )}
          </div>
        }
      />

      {/* ── Stats + Filter strip ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Stats */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-sm">
            <CalendarDays size={14} style={{ color: 'var(--text-primary)' }} />
            <span className="font-semibold text-(--text-primary)">{uniqueOnLeave}</span>
            <span className="text-(--text-muted)">employee{uniqueOnLeave !== 1 ? 's' : ''} on leave</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="font-semibold text-(--text-primary)">{statsLeaves}</span>
            <span className="text-(--text-muted)">leave day{statsLeaves !== 1 ? 's' : ''} this month</span>
          </div>
        </div>

        {/* Dept filter (admin only) */}
        {canSeeAll && departments.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={13} style={{ color: 'var(--text-muted)' }} />
            <button
              onClick={() => setDeptFilter('')}
              className="px-2.5 py-1 rounded-full text-xs font-semibold transition-colors"
              style={deptFilter === '' ? { backgroundColor: '#0B1538', color: '#FFFFFF' } : { backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-secondary)' }}
            >
              All
            </button>
            {departments.map((dept) => (
              <button
                key={dept}
                onClick={() => setDeptFilter(dept === deptFilter ? '' : dept)}
                className="px-2.5 py-1 rounded-full text-xs font-semibold transition-colors"
                style={deptFilter === dept ? { backgroundColor: '#0B1538', color: '#FFFFFF' } : { backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-secondary)' }}
              >
                {dept}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Legend ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {(Object.entries(TYPE_META) as [LeaveType, typeof TYPE_META[LeaveType]][]).map(([type, meta]) => (
          <div key={type} className="flex items-center gap-1">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ backgroundColor: meta.bg, color: meta.text }}>
              {meta.abbr}
            </span>
            <span className="text-[10px] text-(--text-muted) capitalize">{type.replace('_', ' ')}</span>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>H</span>
          <span className="text-[10px] text-(--text-muted)">Holiday</span>
        </div>
      </div>

      {/* ── Calendar grid ── */}
      {leavesLoading ? (
        <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-12 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-(--shell-border) border-t-navy rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-(--shell-border)">
            {DAY_HEADERS.map((d) => (
              <div key={d}
                className={`py-2 text-center text-[11px] font-bold uppercase tracking-widest ${d === 'Sun' ? 'text-(--text-muted)' : 'text-(--text-muted)'}`}>
                {d}
              </div>
            ))}
          </div>

          {/* Cells */}
          <div className="grid grid-cols-7">
            {cells.map((day, idx) => {
              if (!day) {
                // Padding cell
                const isSunCol = idx % 7 === 6;
                return (
                  <div key={`pad-${idx}`}
                    className={`min-h-[90px] border-r border-b border-(--shell-border) ${isSunCol ? 'bg-(--glass-panel-bg)' : 'bg-(--glass-panel-bg)/30'}`}
                  />
                );
              }
              const dayStr     = format(day, 'yyyy-MM-dd');
              const holiday    = holidayMap.get(dayStr) ?? null;
              const dayLeaves  = leavesOnDay(day);
              const isSunCol   = dayIndex(day) === 6;
              const isDayToday = isSameDay(day, today);

              return (
                <DayCell
                  key={dayStr}
                  date={day}
                  isCurrent={true}
                  isToday={isDayToday}
                  isSunday={isSunCol}
                  holiday={holiday}
                  leaves={dayLeaves}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!leavesLoading && relevantLeaves.length === 0 && (
        <div className="text-center py-3">
          <p className="text-sm text-(--text-muted)">No approved leaves {deptFilter ? `in ${deptFilter}` : ''} for {format(viewDate, 'MMMM yyyy')}.</p>
        </div>
      )}
    </div>
  );
}
