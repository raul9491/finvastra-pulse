import { Link, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { Command, CalendarCheck2, Landmark, ScrollText, ArrowLeft, LayoutGrid, LogOut } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import { isSuperAdmin } from '../../config/hrmsConfig';
import { VideoLogo } from '../../components/ui/VideoLogo';

interface HubCard { name: string; desc: string; path: string; icon: React.ReactNode; color: string; show: boolean; }

/**
 * Command & Compliance Center — module landing (Phase 1). Aggregates the existing
 * cross-module command + compliance pages; a dedicated shell can follow later.
 */
export function CommandCompliancePage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === 'admin';
  const isHrmsManager = profile?.isHrmsManager === true || isAdmin || isSuperAdmin(user?.uid ?? '', profile ?? undefined);

  const cards: HubCard[] = [
    { name: 'Command Centre', desc: 'Team overview + pending actions across HR, CRM and MIS.', path: '/crm/command-centre', icon: <Command size={22} />, color: '#C9A961', show: isAdmin || profile?.commandCentreAccess === true },
    { name: 'Compliance Calendar', desc: 'TDS · GST · PF · ESI · ROC filings and due dates.', path: '/hrms/admin/compliance', icon: <CalendarCheck2 size={22} />, color: '#3B82F6', show: isHrmsManager },
    { name: 'PF Tracker', desc: 'EPF contributions and ECR export.', path: '/hrms/admin/pf-tracker', icon: <Landmark size={22} />, color: '#10B981', show: isHrmsManager },
    { name: 'Access Logs', desc: 'Who viewed what — audit trail (super admin).', path: '/crm/admin/access-logs', icon: <ScrollText size={22} />, color: '#8B5CF6', show: isAdmin },
  ];
  const visible = cards.filter((c) => c.show);

  const handleLogout = async () => { await signOut(auth); navigate('/login', { replace: true }); };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'transparent' }}>
      <header className="h-16 glass-header flex items-center justify-between px-6 sm:px-8 shrink-0">
        <button onClick={() => navigate('/')} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <LayoutGrid size={16} /> <span className="hidden sm:block">Apps</span>
        </button>
        <VideoLogo size="xs" showText />
        <button onClick={handleLogout} className="flex items-center gap-1.5 text-sm hover:opacity-60" style={{ color: 'var(--text-muted)' }}>
          <LogOut size={15} /> <span className="hidden sm:block">Sign out</span>
        </button>
      </header>

      <main className="flex-1 px-6 py-12 max-w-4xl mx-auto w-full">
        <button onClick={() => navigate('/')} className="inline-flex items-center gap-1.5 text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft size={13} /> Back to apps
        </button>
        <h1 className="text-3xl mb-1" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          Command &amp; Compliance Center
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>Cross-module oversight and statutory compliance in one place.</p>

        {visible.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>You don’t have access to any items here yet.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {visible.map((c) => (
              <Link key={c.path} to={c.path}
                className="glass-panel p-5 flex items-start gap-4 transition-transform hover:-translate-y-0.5">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: c.color + '1A', color: c.color }}>{c.icon}</div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{c.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
