// ─── Standard departments ─────────────────────────────────────────────────────
// Single source of truth for all department dropdowns across the platform.
// Keep sorted by org chart level (management → functional → support).

export const DEPARTMENTS = [
  'Management',
  'Business Development & Client Relations',
  'Digital Marketing',
  'Human Resources',
  'Finance & Accounts',
  'Technology',
  'Operations',
  'Admin & Facilities',
  'Housekeeping',
  'Consultant',
] as const;

export type Department = (typeof DEPARTMENTS)[number];

// ─── Standard designations ────────────────────────────────────────────────────
// Flat list for TypeScript typing. Use DESIGNATION_GROUPS for <select> rendering.

export const DESIGNATIONS = [
  // Founder level
  'Co-Founder & Director',
  // Senior Management
  'Director — Operations',
  'Director — Finance',
  'Director — Technology',
  // Management
  'Vice President',
  'Assistant Vice President',
  'Senior Manager',
  'Manager',
  // Executive
  'Sales Manager',
  'Relationship Manager',
  // Junior
  'Jr. Relationship Manager',
  'Telesales Officer',
  // Specialist / Support
  'Digital Content Manager',
  'Accountant Officer',
  'Office Assistant',
  // Non-staff
  'Consultant',
  'Housekeeping',
] as const;

export type Designation = (typeof DESIGNATIONS)[number];

// ─── Grouped designation options for <select> with <optgroup> ─────────────────
// HR sees visually separated tiers in every designation dropdown.

export const DESIGNATION_GROUPS = [
  {
    group: 'Founder',
    designations: ['Co-Founder & Director'],
  },
  {
    group: 'Senior Management',
    designations: [
      'Director — Operations',
      'Director — Finance',
      'Director — Technology',
    ],
  },
  {
    group: 'Mid Management',
    designations: ['Vice President', 'Assistant Vice President'],
  },
  {
    group: 'Team Lead',
    designations: ['Senior Manager'],
  },
  {
    group: 'Executive',
    designations: ['Manager'],
  },
  {
    group: 'Junior',
    designations: [
      'Sales Manager',
      'Relationship Manager',
    ],
  },
  {
    group: 'Entry Level',
    designations: [
      'Jr. Relationship Manager',
      'Telesales Officer',
    ],
  },
  {
    group: 'Support',
    designations: [
      'Digital Content Manager',
      'Accountant Officer',
      'Office Assistant',
    ],
  },
  {
    group: 'Non-Staff',
    designations: ['Consultant', 'Housekeeping'],
  },
] as const;

// ─── Super admin UIDs ─────────────────────────────────────────────────────────
// In authority order. These accounts cannot be deactivated or have their roles
// changed by non-super-admins — enforced in both server.ts and firestore.rules.
// UIDs are stable Firebase Auth identifiers, not editable via the UI.

export const SUPER_ADMIN_UIDS = [
  '3zdX5QBnTbQAcTdLzUjfXxefP8r2', // Ajay Newatia     (FAPL-000) — Co-Founder & Owner
  'ZmZaciATPDYBb1O2blYWBjjbzMv1', // Kumar Mangalam   (FAPL-003) — Director Operations
  '5lAbJ4CZ5uM0LbU4gUYItNRAlEn2', // Rahul Vijay Wargia (FAPL-022) — Tech & Builder
] as const;

export type SuperAdminUid = (typeof SUPER_ADMIN_UIDS)[number];

// Hierarchy label shown in the Access Management "Super Admin" badge.
export const SUPER_ADMIN_LABELS: Record<string, string> = {
  '3zdX5QBnTbQAcTdLzUjfXxefP8r2': 'Co-Founder & Owner',
  'ZmZaciATPDYBb1O2blYWBjjbzMv1': 'Director — Operations',
  '5lAbJ4CZ5uM0LbU4gUYItNRAlEn2': 'Tech & Builder',
};

// Canonical identity for the founding super-admins. These accounts were created
// by bootstrap / Google first-login WITHOUT the HRMS employee fields, so their
// /users docs show the email prefix as the name and blank work details. We
// auto-heal them on profile load (AuthContext) from this map so they never have
// to hand-enter their own identity. They can still override via "Edit details".
export const SUPER_ADMIN_PROFILES: Record<string, {
  employeeId: string; displayName: string; department: string; designation: string;
}> = {
  '3zdX5QBnTbQAcTdLzUjfXxefP8r2': { employeeId: 'FAPL-000', displayName: 'Ajay Newatia',        department: 'Management', designation: 'Co-Founder & Director' },
  'ZmZaciATPDYBb1O2blYWBjjbzMv1': { employeeId: 'FAPL-003', displayName: 'Kumar Mangalam',      department: 'Management', designation: 'Director — Operations' },
  '5lAbJ4CZ5uM0LbU4gUYItNRAlEn2': { employeeId: 'FAPL-022', displayName: 'Rahul Vijay Wargia',  department: 'Technology', designation: 'Director — Technology' },
};

// Phase P: a user is a super admin if they're in the hardcoded list OR their
// user doc carries superAdmin:true (set by the in-app Promote flow). The doc
// flag lets the CLIENT recognise promoted SAs without a redeploy; Firestore
// RULES still use the hardcoded isSuperAdminUid() list, so a promoted SA needs
// the printed manual rules + env-var update before rules-gated SA actions work.
export function isSuperAdmin(uid: string, profile?: { superAdmin?: boolean } | null): boolean {
  return (SUPER_ADMIN_UIDS as readonly string[]).includes(uid) || profile?.superAdmin === true;
}
