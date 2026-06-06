/**
 * AppsMenu — module switcher dropdown that opens from the "Apps" button in all shells.
 * Shows only modules the current user has access to.
 * Current module is highlighted with a gold accent.
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, TrendingUp, BarChart3, LayoutGrid } from 'lucide-react';
import type { UserProfile } from '../../types';

interface AppsMenuProps {
  profile:       UserProfile | null;
  currentModule: 'hrms' | 'crm' | 'mis';
}

const MODULES = [
  {
    key:     'hrms'  as const,
    name:    'HR & Operations',
    short:   'HRMS',
    icon:    Users,
    path:    '/hrms/dashboard',
    desc:    'Employees, leave, payslips',
    check:   (p: UserProfile | null) => p?.role === 'admin' || p?.hrmsAccess !== false,
  },
  {
    key:     'crm'   as const,
    name:    'CRM & Leads',
    short:   'CRM',
    icon:    TrendingUp,
    path:    '/crm/dashboard',
    desc:    'Pipeline & commissions',
    check:   (p: UserProfile | null) => p?.role === 'admin' || p?.crmAccess === true,
  },
  {
    key:     'mis'   as const,
    name:    'MIS',
    short:   'MIS',
    icon:    BarChart3,
    path:    '/mis/overview',
    desc:    'Reconciliation & payouts',
    check:   (p: UserProfile | null) => p?.role === 'admin' || p?.misAccess != null,
  },
];

export function AppsMenu({ profile, currentModule }: AppsMenuProps) {
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);
  const navigate        = useNavigate();

  const visible = MODULES.filter((m) => m.check(profile));

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      {/* ── Trigger ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors hover:bg-(--shell-hover-hard)"
        style={{ color: 'var(--shell-text-secondary)' }}
        title="Switch module"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <LayoutGrid size={14} />
        <span className="hidden sm:block">Apps</span>
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div className="absolute left-0 top-full mt-2 z-50 glass-modal-panel p-3" style={{ width: 220 }}>

          <p className="text-[9px] font-bold uppercase tracking-[0.25em] px-1 pb-2"
            style={{ color: 'var(--shell-text-dim)' }}>
            Modules
          </p>

            <div className="flex flex-col gap-1.5">
            {visible.map(({ key, name, short, icon: Icon, path, desc }) => {
              const isActive = key === currentModule;
              return (
                <button
                  key={key}
                  onClick={() => { navigate(path); setOpen(false); }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left w-full"
                  style={{
                    backgroundColor: isActive ? 'rgba(201,169,97,0.14)' : 'transparent',
                    border: isActive ? '1px solid rgba(201,169,97,0.35)' : '1px solid transparent',
                  }}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: isActive ? 'rgba(201,169,97,0.20)' : 'var(--glass-panel-bg)',
                      color: isActive ? '#C9A961' : 'var(--shell-text-secondary)',
                    }}>
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-tight"
                      style={{ color: isActive ? '#C9A961' : 'var(--text-primary)' }}>
                      {name}
                    </p>
                    <p className="text-[10px] leading-tight mt-0.5"
                      style={{ color: 'var(--shell-text-dim)' }}>
                      {desc}
                    </p>
                  </div>
                  {isActive && (
                    <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ backgroundColor: 'rgba(201,169,97,0.20)', color: '#C9A961' }}>
                      Active
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
