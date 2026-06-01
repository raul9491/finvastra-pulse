/**
 * EmployeeDirectoryPage — searchable internal contact directory.
 *
 * Accessible to ALL employees (hrmsAccess = true is the default).
 * Shows name, designation, department, email, location.
 * Filters to active employees only. Search + department chips.
 *
 * No writes — pure read-only view of /users documents.
 */

import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, Mail, MapPin, Users, Filter } from 'lucide-react';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useAuth } from '../../auth/AuthContext';

// ─── EmployeeCard ─────────────────────────────────────────────────────────────

interface DirectoryEmployee {
  userId:      string;
  displayName: string;
  designation?: string;
  department?:  string;
  email:        string;
  photoURL?:    string;
  location?:    string;
  employeeId?:  string;
  joiningDate?: string;   // shown to admin/manager only
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function EmployeeCard({
  emp,
  showJoiningDate,
}: {
  emp: DirectoryEmployee;
  showJoiningDate: boolean;
}) {
  const ini = initials(emp.displayName);

  function formatJoiningDate(d: string): string {
    try {
      const [y, m, day] = d.split('-');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `Joined ${months[Number(m) - 1]} ${day}, ${y}`;
    } catch { return ''; }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      {/* Avatar + name */}
      <div className="flex items-center gap-3">
        {emp.photoURL ? (
          <img
            src={emp.photoURL}
            alt={emp.displayName}
            className="w-12 h-12 rounded-full object-cover shrink-0"
          />
        ) : (
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold shrink-0"
            style={{ backgroundColor: '#0B153815', color: '#0B1538' }}
          >
            {ini}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink truncate">{emp.displayName}</p>
          {emp.designation && (
            <p className="text-xs text-mute truncate">{emp.designation}</p>
          )}
        </div>
      </div>

      {/* Meta pills */}
      <div className="flex flex-wrap gap-1.5">
        {emp.department && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: '#0B153812', color: '#0B1538' }}>
            {emp.department}
          </span>
        )}
        {emp.employeeId && (
          <span className="text-[10px] text-mute px-1">{emp.employeeId}</span>
        )}
      </div>

      {/* Contact info */}
      <div className="space-y-1.5">
        <a
          href={`mailto:${emp.email}`}
          className="flex items-center gap-2 text-xs hover:opacity-70 transition-opacity truncate"
          style={{ color: '#0B1538' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Mail size={12} className="shrink-0" />
          <span className="truncate">{emp.email}</span>
        </a>
        {emp.location && (
          <div className="flex items-center gap-2 text-xs text-mute">
            <MapPin size={12} className="shrink-0" />
            <span className="truncate">{emp.location}</span>
          </div>
        )}
        {showJoiningDate && emp.joiningDate && (
          <p className="text-[10px] text-mute pl-0.5">
            {formatJoiningDate(emp.joiningDate)}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── EmployeeDirectoryPage ────────────────────────────────────────────────────

export function EmployeeDirectoryPage() {
  const { profile } = useAuth();
  const { employees, loading } = useAllEmployees();

  const [search, setSearch]     = useState('');
  const [deptFilter, setDeptFilter] = useState('');

  const isAdmin      = profile?.role === 'admin';
  const isHrManager  = isAdmin || profile?.isHrmsManager === true;

  // Active employees only, sorted alphabetically
  const activeEmployees = useMemo(
    () =>
      employees
        .filter((e) => !e.employeeStatus || e.employeeStatus === 'active')
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [employees],
  );

  // All departments for filter chips
  const departments = useMemo(
    () => [...new Set(activeEmployees.map((e) => e.department).filter(Boolean))] as string[],
    [activeEmployees],
  );

  // Filtered + searched list
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return activeEmployees.filter((e) => {
      if (deptFilter && e.department !== deptFilter) return false;
      if (!q) return true;
      return (
        e.displayName.toLowerCase().includes(q)  ||
        (e.designation  ?? '').toLowerCase().includes(q)  ||
        (e.department   ?? '').toLowerCase().includes(q)  ||
        (e.employeeId   ?? '').toLowerCase().includes(q)
      );
    });
  }, [activeEmployees, search, deptFilter]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl mb-1"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
            Employee Directory
          </h2>
          <p className="text-sm text-mute">
            {loading ? 'Loading…' : `${activeEmployees.length} active team member${activeEmployees.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Link to="/hrms/org-chart"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors hover:bg-slate-100 shrink-0"
          style={{ color: '#8B8B85', border: '1px solid #E2E8F0' }}>
          Org Chart →
        </Link>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search input */}
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input
            type="text"
            placeholder="Search by name, designation, department…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-navy/10 focus:border-navy bg-white"
          />
        </div>
      </div>

      {/* Department filter chips */}
      {departments.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={13} style={{ color: '#8B8B85' }} />
          <button
            onClick={() => setDeptFilter('')}
            className="px-3 py-1 rounded-full text-xs font-semibold transition-colors"
            style={deptFilter === '' ? { backgroundColor: '#0B1538', color: '#FFFFFF' } : { backgroundColor: '#F2EFE7', color: '#2A2A2A' }}
          >
            All ({activeEmployees.length})
          </button>
          {departments.map((dept) => {
            const count = activeEmployees.filter((e) => e.department === dept).length;
            return (
              <button
                key={dept}
                onClick={() => setDeptFilter(dept === deptFilter ? '' : dept)}
                className="px-3 py-1 rounded-full text-xs font-semibold transition-colors"
                style={deptFilter === dept ? { backgroundColor: '#0B1538', color: '#FFFFFF' } : { backgroundColor: '#F2EFE7', color: '#2A2A2A' }}
              >
                {dept} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Card grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-slate-100 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 bg-slate-100 rounded w-3/4" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                </div>
              </div>
              <div className="h-3 bg-slate-100 rounded w-1/3" />
              <div className="h-3 bg-slate-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center">
          <Users size={40} className="mx-auto mb-3 text-slate-200" />
          <p className="text-sm text-mute">
            {search || deptFilter ? 'No employees match your search.' : 'No active employees found.'}
          </p>
          {(search || deptFilter) && (
            <button
              onClick={() => { setSearch(''); setDeptFilter(''); }}
              className="mt-3 text-xs font-medium hover:opacity-70 transition-opacity"
              style={{ color: '#0B1538' }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((e) => (
            <EmployeeCard
              key={e.userId}
              emp={{
                userId:      e.userId,
                displayName: e.displayName,
                designation: e.designation,
                department:  e.department,
                email:       e.email,
                photoURL:    e.photoURL,
                location:    e.location,
                employeeId:  e.employeeId,
                joiningDate: e.joiningDate,
              }}
              showJoiningDate={isHrManager}
            />
          ))}
        </div>
      )}

      {/* Result count when filtered */}
      {!loading && (search || deptFilter) && filtered.length > 0 && (
        <p className="text-xs text-mute text-center">
          Showing {filtered.length} of {activeEmployees.length} employees
        </p>
      )}
    </div>
  );
}
