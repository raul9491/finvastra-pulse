import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { UserProfile, EmployeeProfile } from '../../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BirthdayEmployee {
  userId: string;
  displayName: string;
  department?: string;
  designation?: string;
  photoURL?: string;
  employeeId?: string;
}

export interface UpcomingBirthdayEmployee extends BirthdayEmployee {
  daysUntil: number;
}

// ─── useBirthdayEmployees ────────────────────────────────────────────────────
/**
 * Reads all employees from /users and their DOB from /employee_profiles.
 * Returns employees whose birthday is today, and those in the next 7 days.
 *
 * DOB format in employee_profiles: "DD-MM-YYYY" (year is ignored — only
 * day + month compared against today's date).
 *
 * /employee_profiles is admin/hrmsManager-only — this hook silently returns
 * empty arrays for regular employees (Firestore permission denied is caught).
 *
 * @param enabled  Pass false to skip fetching (non-admin/non-manager users)
 */
export function useBirthdayEmployees(enabled: boolean): {
  birthdayEmployees: BirthdayEmployee[];
  upcomingBirthdays: UpcomingBirthdayEmployee[];
  loading: boolean;
} {
  const [birthdayEmployees, setBirthdayEmployees] = useState<BirthdayEmployee[]>([]);
  const [upcomingBirthdays, setUpcomingBirthdays] = useState<UpcomingBirthdayEmployee[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const today       = new Date();
        const todayDay    = today.getDate();
        const todayMonth  = today.getMonth() + 1;
        // Midnight of today for clean day-diff arithmetic
        const todayStart  = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        // Fetch all users — filter active client-side (no composite index needed)
        const usersSnap  = await getDocs(collection(db, 'users'));
        const activeUsers = usersSnap.docs
          .map((d) => d.data() as UserProfile)
          // Treat absent employeeStatus as active (legacy docs before field was added)
          .filter((u) => !u.employeeStatus || u.employeeStatus === 'active');

        // Fetch employee profiles (DOB lives here as DD-MM-YYYY)
        const profilesSnap = await getDocs(collection(db, 'employee_profiles'));
        const profileByEmpCode = new Map<string, EmployeeProfile>();
        profilesSnap.docs.forEach((d) => {
          profileByEmpCode.set(d.id, { uid: d.id, ...d.data() } as EmployeeProfile);
        });

        const todayBirthdays: BirthdayEmployee[]         = [];
        const upcoming:       UpcomingBirthdayEmployee[] = [];

        for (const user of activeUsers) {
          if (!user.employeeId) continue;
          const profile = profileByEmpCode.get(user.employeeId);
          if (!profile?.dob || profile.dob === 'NA') continue;

          try {
            const parts = profile.dob.split('-').map(Number);
            const day   = parts[0];
            const month = parts[1];
            // Defensive: reject obviously invalid values
            if (!day || !month || day < 1 || day > 31 || month < 1 || month > 12) continue;

            const emp: BirthdayEmployee = {
              userId:      user.userId,
              displayName: user.displayName,
              department:  user.department,
              designation: user.designation,
              photoURL:    user.photoURL,
              employeeId:  user.employeeId,
            };

            if (day === todayDay && month === todayMonth) {
              // Birthday is today — goes to the "today" list
              todayBirthdays.push(emp);
            } else {
              // Compute next occurrence (this year or next if already passed)
              let nextBirthday = new Date(today.getFullYear(), month - 1, day);
              if (nextBirthday <= todayStart) {
                nextBirthday = new Date(today.getFullYear() + 1, month - 1, day);
              }
              const daysUntil = Math.round(
                (nextBirthday.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24),
              );
              if (daysUntil >= 1 && daysUntil <= 7) {
                upcoming.push({ ...emp, daysUntil });
              }
            }
          } catch {
            // Skip employees with malformed DOB strings
          }
        }

        if (!cancelled) {
          setBirthdayEmployees(todayBirthdays);
          setUpcomingBirthdays(
            upcoming.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 5),
          );
        }
      } catch {
        // Silently fail — permission denied for non-admin/non-manager users.
        // Regular employees just see no birthday section.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [enabled]);

  return { birthdayEmployees, upcomingBirthdays, loading };
}
