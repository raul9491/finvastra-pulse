/**
 * AppsMenu — module switcher dropdown that opens from the "Apps" button in all shells.
 * Shows only modules the current user has access to. Each module carries its own
 * accent; the current module gets the full accent treatment (tint + ring + ACTIVE pill).
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Users, TrendingUp, BarChart3, LayoutGrid, ChevronRight, Check, Command, GraduationCap, MessageCircle } from 'lucide-react';
import type { UserProfile } from '../../types';
import { MODULE_ACCENTS } from '../../config/navigation';

interface AppsMenuProps {
  profile:       UserProfile | null;
  currentModule: 'hrms' | 'crm' | 'mis' | 'social';
}

const MODULES = [
  {
    key:    'hrms' as const,
    name:   'HR & Operations',
    icon:   Users,
    path:   '/hrms/dashboard',
    desc:   'Employees · leave · payslips',
    accent: MODULE_ACCENTS.hrms,
    check:  (p: UserProfile | null) => p?.role === 'admin' || p?.hrmsAccess !== false,
  },
  {
    key:    'crm' as const,
    name:   'CRM & Leads',
    icon:   TrendingUp,
    path:   '/crm/dashboard',
    desc:   'Pipeline · commissions',
    accent: MODULE_ACCENTS.crm,
    check:  (p: UserProfile | null) => p?.role === 'admin' || p?.crmAccess === true,
  },
  {
    key:    'social' as const,
    name:   'Social Media',
    icon:   MessageCircle,
    path:   '/social/inbox',
    desc:   'WhatsApp · social inbox',
    accent: MODULE_ACCENTS.social,
    check:  (p: UserProfile | null) => p?.role === 'admin' || p?.socialAccess === true,
  },
  {
    key:    'mis' as const,
    name:   'MIS',
    icon:   BarChart3,
    path:   '/mis/overview',
    desc:   'Reconciliation · payouts',
    accent: MODULE_ACCENTS.mis,
    check:  (p: UserProfile | null) => p?.role === 'admin' || p?.misAccess != null,
  },
  {
    key:    'command' as const,
    name:   'Command & Compliance',
    icon:   Command,
    path:   '/command',
    desc:   'Oversight · compliance',
    accent: MODULE_ACCENTS.command,
    check:  (p: UserProfile | null) => p?.role === 'admin' || p?.commandCentreAccess === true || p?.isHrmsManager === true || p?.crmRole === 'manager',
  },
  {
    key:    'lms' as const,
    name:   'LMS',
    icon:   GraduationCap,
    path:   '/lms',
    desc:   'Guides · tours · training',
    accent: MODULE_ACCENTS.lms,
    check:  () => true,
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      {/* ── Trigger ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors hover:bg-(--shell-hover-hard)"
        style={{ color: open ? '#C9A961' : 'var(--shell-text-secondary)' }}
        title="Switch module"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <LayoutGrid size={14} />
        <span className="hidden sm:block">Apps</span>
      </button>

      {/* ── Dropdown ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="absolute left-0 top-full mt-2 z-50 rounded-2xl overflow-hidden"
            style={{
              width: 312, maxWidth: 'calc(100vw - 2rem)', transformOrigin: 'top left',
              backgroundColor: 'var(--ss-bg)',
              border: '1px solid var(--shell-border)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
            }}
          >
            {/* Header */}
            <div className="px-4 pt-3.5 pb-2.5" style={{ borderBottom: '1px solid var(--shell-border)' }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.28em]" style={{ color: 'var(--shell-text-dim)' }}>
                Switch module
              </p>
            </div>

            <div className="p-2 flex flex-col gap-1">
              {visible.map(({ key, name, icon: Icon, path, desc, accent }) => {
                const isActive = key === currentModule;
                return (
                  <button
                    key={key}
                    onClick={() => { navigate(path); setOpen(false); }}
                    className="group flex items-center gap-3 px-2.5 py-2.5 rounded-xl transition-colors text-left w-full"
                    style={{
                      backgroundColor: isActive ? accent + '14' : 'transparent',
                      border: `1px solid ${isActive ? accent + '4D' : 'transparent'}`,
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--shell-hover-soft)'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    {/* Icon tile */}
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: accent + (isActive ? '26' : '1A'),
                        color: accent,
                        boxShadow: isActive ? `inset 0 0 0 1px ${accent}55` : 'none',
                      }}>
                      <Icon size={18} />
                    </div>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold leading-tight truncate"
                        style={{ color: isActive ? accent : 'var(--text-primary)' }}>
                        {name}
                      </p>
                      <p className="text-[11px] leading-tight mt-0.5 truncate" style={{ color: 'var(--shell-text-dim)' }}>
                        {desc}
                      </p>
                    </div>

                    {/* Right affordance */}
                    {isActive ? (
                      <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full shrink-0"
                        style={{ backgroundColor: accent + '26', color: accent }}>
                        <Check size={10} /> Active
                      </span>
                    ) : (
                      <ChevronRight size={16} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: 'var(--shell-text-dim)' }} />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
