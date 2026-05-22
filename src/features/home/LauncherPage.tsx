import { Navigate, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { Users, TrendingUp, BarChart3, ArrowRight, LogOut } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import { VideoLogo } from '../../components/ui/VideoLogo';

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAFAF7' }}>
      <VideoLogo size="sm" showText={false} />
    </div>
  );
}

interface ModuleTileProps {
  icon: React.ReactNode;
  name: string;
  description: string;
  path: string;
  accentColor: string;
}

function ModuleTile({ icon, name, description, path, accentColor }: ModuleTileProps) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(path)}
      className="group text-left w-full bg-white border border-slate-200 rounded-2xl p-8 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-6"
        style={{ backgroundColor: accentColor + '15', color: accentColor }}
      >
        {icon}
      </div>

      <h2
        className="text-2xl mb-2"
        style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}
      >
        {name}
      </h2>
      <p className="text-sm leading-relaxed mb-8" style={{ color: '#8B8B85' }}>
        {description}
      </p>

      <div
        className="flex items-center gap-2 text-sm font-semibold transition-gap group-hover:gap-3"
        style={{ color: accentColor }}
      >
        Open {name} <ArrowRight size={15} />
      </div>
    </button>
  );
}

export function LauncherPage() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.mustResetPassword) return <Navigate to="/reset-password" replace />;

  const isAdmin = profile?.role === 'admin';
  const showHrms = isAdmin || profile?.hrmsAccess !== false;
  const showCrm  = isAdmin || profile?.crmAccess === true;
  const showMis  = isAdmin || profile?.misAccess != null;

  const firstName = profile?.displayName?.split(' ')[0] ?? 'there';

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#FAFAF7' }}>

      {/* Top bar */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
        <img src="/images/logo-finvastra.png" alt="Finvastra" style={{ height: 44, objectFit: 'contain' }} />
        <div className="flex items-center gap-4">
          {profile?.photoURL ? (
            <img src={profile.photoURL} alt={profile.displayName} className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
            >
              {profile?.displayName?.[0] ?? '?'}
            </div>
          )}
          <span className="text-sm font-medium hidden sm:block" style={{ color: '#2A2A2A' }}>
            {profile?.displayName}
          </span>
          <div className="w-px h-5 bg-slate-200" />
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-60"
            style={{ color: '#8B8B85' }}
          >
            <LogOut size={15} />
            <span className="hidden sm:block">Sign out</span>
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-3xl">

          {/* Brand video — animation only, no text */}
          <div className="flex justify-center mb-8">
            <VideoLogo size="md" showText={false} />
          </div>

          {/* Greeting */}
          <div className="mb-12 text-center">
            <h1
              className="text-4xl mb-2"
              style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}
            >
              Good day, {firstName}.
            </h1>
            <p style={{ color: '#8B8B85' }}>Select a module to get started.</p>
          </div>

          {/* Module tiles */}
          {(() => {
            const tileCount = [showHrms, showCrm, showMis].filter(Boolean).length;
            const gridClass = tileCount >= 3 ? 'md:grid-cols-3' : tileCount === 2 ? 'md:grid-cols-2' : 'max-w-sm';
            return (
              <div className={`grid gap-6 ${gridClass}`}>
                {showHrms && (
                  <ModuleTile
                    icon={<Users size={24} />}
                    name="HR & Operations"
                    description="Employees, attendance, leave, payslips, and holidays for the full team."
                    path="/hrms/dashboard"
                    accentColor="#0B1538"
                  />
                )}
                {showCrm && (
                  <ModuleTile
                    icon={<TrendingUp size={24} />}
                    name="CRM & Leads"
                    description="Lead capture, bank submissions, pipeline tracking, and commission calculations."
                    path="/crm/dashboard"
                    accentColor="#C9A961"
                  />
                )}
                {showMis && (
                  <ModuleTile
                    icon={<BarChart3 size={24} />}
                    name="MIS"
                    description="Commission reconciliation, statement imports, and RM payout management."
                    path="/mis/overview"
                    accentColor="#166534"
                  />
                )}
              </div>
            );
          })()}

          {/* No access fallback */}
          {!showHrms && !showCrm && !showMis && (
            <p className="text-sm" style={{ color: '#8B8B85' }}>
              No modules assigned yet. Contact your admin.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
