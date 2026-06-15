import { Link, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { GraduationCap, BookOpen, TrendingUp, BarChart3, ArrowLeft, LayoutGrid, LogOut } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import { VideoLogo } from '../../components/ui/VideoLogo';

interface HubCard { name: string; desc: string; path: string; icon: React.ReactNode; color: string; show: boolean; }

/**
 * LMS — module landing (Phase 1). Central place for the guided tours, per-module
 * Learn references and Training. A richer LMS can follow later.
 */
export function LmsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === 'admin';
  const hasCrm = isAdmin || profile?.crmAccess === true;
  const hasMis = isAdmin || profile?.misAccess != null;

  const cards: HubCard[] = [
    { name: 'Pulse Guide (HR)', desc: 'How attendance, leave, claims, payslips and more work — plus the guided tour.', path: '/hrms/guide', icon: <BookOpen size={22} />, color: '#C9A961', show: true },
    { name: 'Learn CRM', desc: 'Customers, leads, meetings, pipeline — and a replayable walkthrough.', path: '/crm/learn', icon: <TrendingUp size={22} />, color: '#5B9BD5', show: hasCrm },
    { name: 'Learn MIS', desc: 'Statements, reconciliation, disputes and payouts explained.', path: '/mis/learn', icon: <BarChart3 size={22} />, color: '#4FB286', show: hasMis },
    { name: 'Training', desc: 'Your enrolled training programmes and certificates.', path: '/hrms/training', icon: <GraduationCap size={22} />, color: '#8B5CF6', show: true },
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
          Learning (LMS)
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>Guides, walkthroughs and training to get faster at Pulse.</p>

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
      </main>
    </div>
  );
}
