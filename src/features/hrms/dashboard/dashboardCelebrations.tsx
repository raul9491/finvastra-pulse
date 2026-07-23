/**
 * Birthday and work-anniversary cards on the HRMS dashboard, plus the
 * localStorage dismissal helpers and the greeting.
 * 
 * Dismissals are date-scoped (`dismissed_birthday_{uid}_{yyyy-MM-dd}`), so a
 * dismissed card reappears the next day - unchanged.
 * 
 * Extracted verbatim from HrmsDashboardPage.tsx (2026-07-23).
 */
import { X } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { isMilestoneYear, milestoneLabel } from '../hooks/useWorkAnniversaries';
import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { db } from '../../../lib/firebase';
import type { UpcomingBirthdayEmployee, BirthdayEmployee } from '../hooks/useBirthdayEmployees';
import type { UpcomingAnniversaryEmployee, AnniversaryEmployee } from '../hooks/useWorkAnniversaries';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function greeting(name: string): string {
  const h = new Date().getHours();
  const time = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return `Good ${time}, ${name.split(' ')[0]}.`;
}


// localStorage helpers for birthday dismissal
export const todayStr = format(new Date(), 'yyyy-MM-dd');

export function birthdayDismissKey(userId: string) {
  return `dismissed_birthday_${userId}_${todayStr}`;
}

export function isBirthdayDismissed(userId: string): boolean {
  try { return !!localStorage.getItem(birthdayDismissKey(userId)); } catch { return false; }
}

export function dismissBirthdayInStorage(userId: string) {
  try { localStorage.setItem(birthdayDismissKey(userId), '1'); } catch { /* storage unavailable */ }
}

// localStorage helpers for anniversary dismissal
export function anniversaryDismissKey(userId: string) {
  return `dismissed_anniversary_${userId}_${todayStr}`;
}

export function isAnniversaryDismissed(userId: string): boolean {
  try { return !!localStorage.getItem(anniversaryDismissKey(userId)); } catch { return false; }
}

export function dismissAnniversaryInStorage(userId: string) {
  try { localStorage.setItem(anniversaryDismissKey(userId), '1'); } catch { /* storage unavailable */ }
}

// ─── Team Today hook (manager/admin only) ─────────────────────────────────────

export function useTeamToday(enabled: boolean): { present: number; leave: number; absent: number; loading: boolean } {
  const [stats, setStats] = useState({ present: 0, leave: 0, absent: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    const today = format(new Date(), 'yyyy-MM-dd');
    const q = query(collection(db, 'attendance'), where('date', '==', today));
    getDocs(q).then((snap) => {
      let present = 0, leave = 0;
      snap.forEach((d) => {
        const s = d.data().status as string;
        if (s === 'present' || s === 'half_day') present++;
        else if (s === 'leave') leave++;
      });
      setStats({ present, leave, absent: 0 });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [enabled]);

  return { ...stats, loading };
}

// ─── Birthday Cards ───────────────────────────────────────────────────────────

export function BirthdaySection({
  employees,
  onDismiss,
}: {
  employees: BirthdayEmployee[];
  onDismiss: (userId: string) => void;
}) {
  if (employees.length === 0) return null;

  return (
    <div className="mb-6">
      {employees.length > 1 && (
        <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
          {employees.length} birthdays today 🎉
        </p>
      )}
      <div className="space-y-2">
        {employees.map((emp) => (
          <div
            key={emp.userId}
            className="flex items-center gap-4 rounded-xl px-5 py-4"
            style={{
              borderLeft: '4px solid #C9A961',
              backgroundColor: 'rgba(201, 169, 97, 0.06)',
              border: '1px solid rgba(201, 169, 97, 0.25)',
              borderLeftWidth: '4px',
              borderLeftColor: '#C9A961',
            }}
          >
            {/* Cake icon */}
            <span className="text-2xl shrink-0 select-none" aria-hidden>🎂</span>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: '#C9A961' }}>
                Happy Birthday, {emp.displayName}! 🎉
              </p>
              {(emp.department || emp.designation) && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {[emp.department, emp.designation].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>

            {/* Right: confetti star */}
            <span className="text-xl shrink-0 select-none" aria-hidden>⭐</span>

            {/* Dismiss */}
            <button
              onClick={() => onDismiss(emp.userId)}
              className="shrink-0 p-1.5 rounded-lg hover:bg-black/5 transition-colors"
              title="Dismiss"
              aria-label={`Dismiss birthday card for ${emp.displayName}`}
            >
              <X size={14} style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Upcoming Birthdays section ───────────────────────────────────────────────

export function UpcomingBirthdaysSection({ employees }: { employees: UpcomingBirthdayEmployee[] }) {
  if (employees.length === 0) return null;

  return (
    <div className="glass-panel glass-card p-6 mb-6">
      <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
        Upcoming Birthdays
      </p>
      <div className="space-y-3">
        {employees.map((emp) => {
          const initials = emp.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
          return (
            <div key={emp.userId} className="flex items-center gap-3">
              {/* Avatar initial */}
              {emp.photoURL ? (
                <img
                  src={emp.photoURL}
                  alt={emp.displayName}
                  className="w-7 h-7 rounded-full object-cover shrink-0"
                />
              ) : (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#9A7E3F' }}
                >
                  {initials}
                </div>
              )}

              {/* Name + dept */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {emp.displayName}
                </p>
                {emp.designation && (
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{emp.designation}</p>
                )}
              </div>

              {/* Days until */}
              <span className="text-xs font-semibold whitespace-nowrap" style={{ color: '#C9A961' }}>
                in {emp.daysUntil} day{emp.daysUntil !== 1 ? 's' : ''} 🎂
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Anniversary Cards ────────────────────────────────────────────────────────

export function AnniversarySection({
  employees,
  onDismiss,
}: {
  employees: AnniversaryEmployee[];
  onDismiss: (userId: string) => void;
}) {
  if (employees.length === 0) return null;

  return (
    <div className="mb-6">
      {employees.length > 1 && (
        <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
          {employees.length} work anniversaries today 🏅
        </p>
      )}
      <div className="space-y-2">
        {employees.map((emp) => {
          const isMilestone = isMilestoneYear(emp.yearsCompleted);
          const label       = milestoneLabel(emp.yearsCompleted);
          return (
            <div
              key={emp.userId}
              className="flex items-center gap-4 rounded-xl px-5 py-4"
              style={{
                // Blue accent for milestones, gold for regular — both tints are
                // visible on dark and light backgrounds (navy tint was not).
                backgroundColor: isMilestone ? 'rgba(96,165,250,0.08)' : 'rgba(201,169,97,0.06)',
                border: `1px solid ${isMilestone ? 'rgba(96,165,250,0.30)' : 'rgba(201,169,97,0.25)'}`,
                borderLeftWidth: '4px',
                borderLeftColor: isMilestone ? '#60a5fa' : '#C9A961',
              }}
            >
              <span className="text-2xl shrink-0 select-none" aria-hidden>
                {isMilestone ? '🏅' : '🗓️'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {emp.displayName}
                  </p>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: isMilestone ? '#0B1538' : 'rgba(201,169,97,0.20)',
                      color:           isMilestone ? '#C9A961'  : '#9A7E3F',
                    }}
                  >
                    {label}
                  </span>
                </div>
                {(emp.department || emp.designation) && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {[emp.department, emp.designation].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <span className="text-xl shrink-0 select-none" aria-hidden>🎊</span>
              <button
                onClick={() => onDismiss(emp.userId)}
                className="shrink-0 p-1.5 rounded-lg hover:bg-black/5 transition-colors"
                title="Dismiss"
                aria-label={`Dismiss anniversary card for ${emp.displayName}`}
              >
                <X size={14} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Upcoming Anniversaries section ──────────────────────────────────────────

export function UpcomingAnniversariesSection({ employees }: { employees: UpcomingAnniversaryEmployee[] }) {
  if (employees.length === 0) return null;

  return (
    <div className="glass-panel glass-card p-6 mb-6">
      <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
        Upcoming Anniversaries
      </p>
      <div className="space-y-3">
        {employees.map((emp) => {
          const initials = emp.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
          const isMilestone = isMilestoneYear(emp.yearsCompleted);
          return (
            <div key={emp.userId} className="flex items-center gap-3">
              {emp.photoURL ? (
                <img src={emp.photoURL} alt={emp.displayName}
                  className="w-7 h-7 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-primary)' }}>
                  {initials}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {emp.displayName}
                </p>
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                  {milestoneLabel(emp.yearsCompleted)}
                  {isMilestone && ' 🏅'}
                </p>
              </div>
              <span className="text-xs font-semibold whitespace-nowrap" style={{ color: '#C9A961' }}>
                in {emp.daysUntil} day{emp.daysUntil !== 1 ? 's' : ''} 🗓️
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
