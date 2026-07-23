/**
 * The Monthly grid view and its CSV export.
 * 
 * The grid marks only SUNDAY as non-working — correct for Finvastra's Mon-Sat
 * week (see src/lib/workingDays.ts; two other screens had this wrong until
 * 2026-07-23).
 * 
 * Extracted verbatim from AdminAttendancePage.tsx (2026-07-23).
 */
import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { format, parseISO, getDaysInMonth } from 'date-fns';
import { db } from '../../../lib/firebase';
import type { UserProfile, Attendance, AttendanceStatus } from '../../../types';
import { toDate } from './AdminAttendancePage';

export const MONTH_MARK: Record<string, { ch: string; color: string; bg: string }> = {
  present:  { ch: 'P', color: '#065F46', bg: 'rgba(16,122,81,0.14)' },
  half_day: { ch: '½', color: '#92400E', bg: 'rgba(217,119,6,0.14)' },
  absent:   { ch: 'A', color: '#991B1B', bg: 'rgba(220,38,38,0.14)' },
  leave:    { ch: 'L', color: '#7A6030', bg: 'rgba(201,169,97,0.18)' },
  holiday:  { ch: 'H', color: '#1E40AF', bg: 'rgba(59,130,246,0.14)' },
};


// ─── MonthExportButton ────────────────────────────────────────────────────────
// Separate sub-component so we can call useMyAttendance per-employee only
// within the export flow without violating rules-of-hooks.

interface MonthExportProps {
  employees: UserProfile[];
  month: string; // YYYY-MM
}

// We only mount this component when the user clicks "Export Month". It reads
// all employees' month records from the hook of the first employee (demo) —
// but since hooks can't be called conditionally, we build a thin wrapper that
// collects from the hook for one employee at a time, then aggregates on the
// parent side.
//
// Given the small team size (~25 employees) we use a simpler approach: build
// the CSV from whatever records are already in-memory via the per-day query,
// accumulated across a full month using Firestore snapshot directly. The button
// triggers an imperative fetch (not a hook) to avoid complexity.

export function ExportMonthButton({ employees, month }: MonthExportProps) {
  const [exporting, setExporting] = useState(false);

  // We need to do an imperative fetch of all attendance docs for the month.
  // We import getDocs directly here to keep the export self-contained.
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const startDate = `${month}-01`;
      const daysInMonth = getDaysInMonth(parseISO(`${month}-01`));
      const endDate = `${month}-${String(daysInMonth).padStart(2, '0')}`;

      const q = query(
        collection(db, 'attendance'),
        where('date', '>=', startDate),
        where('date', '<=', endDate),
        orderBy('date', 'asc'),
      );

      const snap = await getDocs(q);
      const records = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Attendance));

      // Build name lookup
      const nameMap = new Map<string, string>(
        employees.map((e) => [e.userId, e.displayName]),
      );

      const rows: string[] = [
        'Name,Date,Status,Check-in,Check-out,Hours,Notes',
      ];

      for (const r of records) {
        const name = nameMap.get(r.userId) ?? r.userId;
        const checkIn  = r.checkIn  ? format(toDate(r.checkIn)!,  'HH:mm') : '';
        const checkOut = r.checkOut ? format(toDate(r.checkOut)!, 'HH:mm') : '';
        const csvRow = [
          `"${name}"`,
          r.date,
          r.status,
          checkIn,
          checkOut,
          r.workingHours.toFixed(2),
          `"${r.notes.replace(/"/g, '""')}"`,
        ].join(',');
        rows.push(csvRow);
      }

      const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Finvastra-Attendance-${month}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [employees, month]);

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className="px-4 py-2 rounded-xl text-sm font-semibold border border-(--shell-border) hover:bg-(--glass-panel-bg) transition-colors disabled:opacity-50"
      style={{ color: 'var(--text-primary)' }}
    >
      {exporting ? 'Exporting…' : 'Export Month CSV'}
    </button>
  );
}

export function MonthlyView({ employees, month }: { employees: UserProfile[]; month: string }) {
  const [records, setRecords] = useState<Attendance[] | null>(null);

  useEffect(() => {
    let alive = true;
    setRecords(null);
    (async () => {
      const days  = getDaysInMonth(parseISO(`${month}-01`));
      const start = `${month}-01`;
      const end   = `${month}-${String(days).padStart(2, '0')}`;
      const snap = await getDocs(query(
        collection(db, 'attendance'),
        where('date', '>=', start),
        where('date', '<=', end),
      ));
      if (alive) setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Attendance)));
    })().catch(() => { if (alive) setRecords([]); });
    return () => { alive = false; };
  }, [month]);

  const days    = getDaysInMonth(parseISO(`${month}-01`));
  const dayNums = Array.from({ length: days }, (_, i) => i + 1);
  const [year, mon] = month.split('-').map(Number);
  const weekday  = (d: number) => new Date(year, mon - 1, d).getDay();
  const isSunday = (d: number) => weekday(d) === 0;
  const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  // Highlight today's column when viewing the current month
  const now = new Date();
  const todayNum = format(now, 'yyyy-MM') === month ? now.getDate() : -1;

  const statusByKey = new Map<string, AttendanceStatus>();
  (records ?? []).forEach((r) => statusByKey.set(`${r.userId}_${Number(r.date.slice(8, 10))}`, r.status));

  if (records === null) {
    return <div className="py-16 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading month…</div>;
  }

  const sorted = [...employees].sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Sticky cells need an OPAQUE theme surface (--ss-bg: solid navy/white) —
  // a translucent panel bg lets scrolled content bleed through, and the old
  // fixed cream header was unreadable in dark mode.
  const solid = 'var(--ss-bg)';
  const sundayTint = 'var(--shell-hover-soft)';
  const todayStyle = { boxShadow: 'inset 0 0 0 1px #C9A961' } as const;

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
        {format(parseISO(`${month}-01`), 'MMMM yyyy')} &nbsp;·&nbsp; P present · ½ half · A absent · L leave · H holiday · · no record
      </p>
      <div className="overflow-auto rounded-xl border border-(--shell-border)" style={{ maxHeight: 600 }}>
        <table className="text-xs border-collapse">
          {/* Date header stays STATIC — sticky on top while rows scroll */}
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 px-3 py-2 text-left font-bold whitespace-nowrap"
                style={{ backgroundColor: solid, color: 'var(--text-muted)', minWidth: 180, boxShadow: 'inset -1px -1px 0 var(--shell-border-mid)' }}>Employee</th>
              {dayNums.map((d) => (
                <th key={d} className="sticky top-0 z-20 px-1 py-1.5 text-center font-semibold"
                  style={{
                    color: isSunday(d) ? '#f87171' : todayNum === d ? '#C9A961' : 'var(--text-muted)',
                    backgroundColor: solid,
                    minWidth: 24,
                    boxShadow: `inset 0 -1px 0 var(--shell-border-mid)${todayNum === d ? ', inset 0 0 0 1px #C9A961' : ''}`,
                  }}>
                  <span className="block leading-none">{d}</span>
                  <span className="block leading-none mt-0.5 text-[9px] font-normal opacity-70">{WD[weekday(d)]}</span>
                </th>
              ))}
              {['P', 'A', 'L'].map((h) => (
                <th key={h} className="sticky top-0 z-20 px-2 py-2 text-center font-bold"
                  style={{ color: 'var(--text-muted)', backgroundColor: solid, boxShadow: 'inset 0 -1px 0 var(--shell-border-mid)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((emp) => {
              let p = 0, a = 0, l = 0;
              const cells = dayNums.map((d) => {
                const st = statusByKey.get(`${emp.userId}_${d}`);
                if (st === 'present' || st === 'half_day') p++;
                else if (st === 'absent') a++;
                else if (st === 'leave') l++;
                const mark = st ? MONTH_MARK[st] : null;
                return (
                  <td key={d} className="px-1.5 py-1.5 text-center"
                    style={{
                      backgroundColor: mark?.bg ?? (isSunday(d) ? sundayTint : undefined),
                      ...(todayNum === d ? todayStyle : {}),
                    }}>
                    <span style={{ color: mark?.color ?? 'var(--text-muted)', fontWeight: mark ? 700 : 400 }}>{mark?.ch ?? '·'}</span>
                  </td>
                );
              });
              return (
                <tr key={emp.userId} className="border-t border-(--shell-border)">
                  <td className="sticky left-0 z-10 px-3 py-1.5 font-medium whitespace-nowrap"
                    style={{ backgroundColor: solid, color: 'var(--text-primary)', minWidth: 180, boxShadow: 'inset -1px 0 0 var(--shell-border-mid)' }}>{emp.displayName}</td>
                  {cells}
                  <td className="px-2 py-1.5 text-center font-bold" style={{ color: '#34d399' }}>{p}</td>
                  <td className="px-2 py-1.5 text-center font-bold" style={{ color: '#f87171' }}>{a}</td>
                  <td className="px-2 py-1.5 text-center font-bold" style={{ color: '#C9A961' }}>{l}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
