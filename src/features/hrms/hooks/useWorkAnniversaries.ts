/**
 * useWorkAnniversaries — work anniversary recognition hook.
 *
 * Data source: /users collection, joiningDate field (YYYY-MM-DD).
 * No secondary collection needed — joiningDate lives directly on UserProfile.
 *
 * Returns:
 *  - anniversaryEmployees: employees whose work anniversary is TODAY (completing N years)
 *  - upcomingAnniversaries: employees with anniversaries in the next 1–7 days (max 5, sorted asc)
 *
 * @param enabled  Pass false to skip fetching entirely (non-admin/non-manager users)
 */

import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { UserProfile } from '../../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnniversaryEmployee {
  userId: string;
  displayName: string;
  department?: string;
  designation?: string;
  photoURL?: string;
  employeeId?: string;
  yearsCompleted: number;   // integer — how many full years they are completing today/soon
}

export interface UpcomingAnniversaryEmployee extends AnniversaryEmployee {
  daysUntil: number;        // 0 = today (not used in upcoming list; 1–7 for upcoming)
}

// ─── Milestone helpers ────────────────────────────────────────────────────────

/**
 * Returns a milestone emoji/label for significant year marks.
 * 1 yr, 3 yr, 5 yr, 10 yr, 15 yr, 20 yr get special treatment in the UI.
 */
export function milestoneLabel(years: number): string {
  if (years === 1)  return '🥇 1 Year';
  if (years === 3)  return '🏅 3 Years';
  if (years === 5)  return '⭐ 5 Years';
  if (years === 10) return '💎 10 Years';
  if (years === 15) return '🏆 15 Years';
  if (years === 20) return '👑 20 Years';
  return `${years} Years`;
}

export function isMilestoneYear(years: number): boolean {
  return [1, 3, 5, 10, 15, 20].includes(years);
}

// ─── useWorkAnniversaries ─────────────────────────────────────────────────────

export function useWorkAnniversaries(enabled: boolean): {
  anniversaryEmployees: AnniversaryEmployee[];
  upcomingAnniversaries: UpcomingAnniversaryEmployee[];
  loading: boolean;
} {
  const [anniversaryEmployees, setAnniversaryEmployees] = useState<AnniversaryEmployee[]>([]);
  const [upcomingAnniversaries, setUpcomingAnniversaries] = useState<UpcomingAnniversaryEmployee[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const today      = new Date();
        const todayDay   = today.getDate();
        const todayMonth = today.getMonth() + 1;
        const todayYear  = today.getFullYear();
        const todayStart = new Date(todayYear, today.getMonth(), todayDay);

        const usersSnap   = await getDocs(collection(db, 'users'));
        const activeUsers = usersSnap.docs
          .map((d) => d.data() as UserProfile)
          .filter((u) => !u.employeeStatus || u.employeeStatus === 'active');

        const todayList:    AnniversaryEmployee[]          = [];
        const upcomingList: UpcomingAnniversaryEmployee[]  = [];

        for (const user of activeUsers) {
          if (!user.joiningDate) continue;

          try {
            // joiningDate format: YYYY-MM-DD
            const [yearStr, monthStr, dayStr] = user.joiningDate.split('-');
            const joinYear  = Number(yearStr);
            const joinMonth = Number(monthStr);
            const joinDay   = Number(dayStr);

            if (!joinYear || !joinMonth || !joinDay) continue;
            // Must have joined at least 1 year ago to have an anniversary
            if (joinYear >= todayYear) continue;

            const emp: AnniversaryEmployee = {
              userId:       user.userId,
              displayName:  user.displayName,
              department:   user.department,
              designation:  user.designation,
              photoURL:     user.photoURL,
              employeeId:   user.employeeId,
              yearsCompleted: 0, // filled below
            };

            if (joinDay === todayDay && joinMonth === todayMonth) {
              // Anniversary is today — compute years completed
              emp.yearsCompleted = todayYear - joinYear;
              todayList.push(emp);
            } else {
              // Compute next occurrence of this anniversary date
              let nextAnniversary = new Date(todayYear, joinMonth - 1, joinDay);
              // If the anniversary this calendar year has already passed, move to next year
              if (nextAnniversary <= todayStart) {
                nextAnniversary = new Date(todayYear + 1, joinMonth - 1, joinDay);
              }
              const daysUntil = Math.round(
                (nextAnniversary.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24),
              );
              if (daysUntil >= 1 && daysUntil <= 7) {
                const yearsCompleted = nextAnniversary.getFullYear() - joinYear;
                upcomingList.push({ ...emp, yearsCompleted, daysUntil });
              }
            }
          } catch {
            // Skip employees with malformed joiningDate strings
          }
        }

        if (!cancelled) {
          setAnniversaryEmployees(todayList);
          setUpcomingAnniversaries(
            upcomingList.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 5),
          );
        }
      } catch {
        // Silently fail — regular employees don't need this data
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [enabled]);

  return { anniversaryEmployees, upcomingAnniversaries, loading };
}
