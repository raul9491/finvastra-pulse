import { Navigate, useNavigate, Link } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { Users, TrendingUp, BarChart3, ArrowRight, LogOut, Command, Share2 } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import { VideoLogo } from '../../components/ui/VideoLogo';
import { useMyShares } from '../auth/hooks/useMyShares';
import { isSuperAdmin } from '../../config/hrmsConfig';
import { InstallPrompt } from '../../components/ui/InstallPrompt';

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--navy-deep)' }}>
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
      className="group text-left w-full glass-panel glass-card p-8 transition-all duration-200 hover:-translate-y-0.5"
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-6"
        style={{ backgroundColor: 'rgba(201,169,97,0.12)', color: '#C9A961' }}
      >
        {icon}
      </div>

      <h2
        className="text-2xl mb-2"
        style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}
      >
        {name}
      </h2>
      <p className="text-sm leading-relaxed mb-8" style={{ color: 'var(--text-muted)' }}>
        {description}
      </p>

      <div
        className="flex items-center gap-2 text-sm font-semibold transition-gap group-hover:gap-3"
        style={{ color: accentColor === '#C9A961' ? '#C9A961' : '#C9A961' }}
      >
        Open {name} <ArrowRight size={15} />
      </div>
    </button>
  );
}

export function LauncherPage() {
  const { user, profile, loading, profileLoadFailed } = useAuth();
  const navigate = useNavigate();
  // Phase P — page shares: a shared page makes its module tile visible too.
  const myShares = useMyShares(user?.uid);

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;

  // Authenticated but the profile couldn't load (transient blip / DB outage).
  // Show an honest, actionable screen rather than a confusing modules-missing launcher.
  if (!profile && profileLoadFailed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ backgroundColor: 'var(--navy-deep)' }}>
        <VideoLogo size="sm" showText={false} />
        <h1 className="text-2xl mt-8 mb-2" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          We couldn't load your account
        </h1>
        <p className="text-sm mb-6 max-w-md" style={{ color: 'var(--text-muted)' }}>
          This is usually a brief connection hiccup. Reload to try again — your data is safe.
        </p>
        <div className="flex gap-3">
          <button onClick={() => window.location.reload()}
            className="px-6 py-2.5 rounded-lg text-sm font-semibold" style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
            Reload
          </button>
          <button onClick={async () => { await signOut(auth); navigate('/login', { replace: true }); }}
            className="px-6 py-2.5 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--shell-border, rgba(255,255,255,0.15))', color: 'var(--text-muted)' }}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (profile?.mustResetPassword) return <Navigate to="/reset-password" replace />;

  const isAdmin = profile?.role === 'admin';
  const isSA = isSuperAdmin(user.uid, profile);
  // Phase P — a tile also shows when the user holds ≥1 active share in that module
  const { sharesByModule } = myShares;
  const showHrms = isAdmin || profile?.hrmsAccess !== false || sharesByModule.hrms.length > 0;
  const showCrm  = isAdmin || profile?.crmAccess === true   || sharesByModule.crm.length > 0;
  const showMis  = isAdmin || profile?.misAccess != null    || sharesByModule.mis.length > 0;
  const showCommand = isAdmin || profile?.commandCentreAccess === true;

  const firstName = profile?.displayName?.split(' ')[0] ?? 'there';

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'transparent' }}>

      {/* Top bar */}
      <header className="h-16 glass-header flex items-center justify-between px-8 shrink-0">
        <img src="/images/logo-finvastra.png" alt="Finvastra" style={{ height: 44, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.75 }} />
        <div className="flex items-center gap-4">
          {profile?.photoURL ? (
            <img src={profile.photoURL} alt={profile.displayName} className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}
            >
              {profile?.displayName?.[0] ?? '?'}
            </div>
          )}
          <span className="text-sm font-medium hidden sm:block" style={{ color: 'var(--text-primary)' }}>
            {profile?.displayName}
          </span>
          <div className="w-px h-5" style={{ backgroundColor: 'var(--shell-border, rgba(255,255,255,0.10))' }} />
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-60"
            style={{ color: 'var(--text-muted)' }}
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
              style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}
            >
              Good day, {firstName}.
            </h1>
            <p style={{ color: 'var(--text-muted)' }}>Select a module to get started.</p>
          </div>

          {/* Module tiles */}
          {(() => {
            const tileCount = [showCommand, showHrms, showCrm, showMis].filter(Boolean).length;
            const gridClass = tileCount >= 4 ? 'md:grid-cols-2' : tileCount === 3 ? 'md:grid-cols-3' : tileCount === 2 ? 'md:grid-cols-2' : 'max-w-sm';
            return (
              <div className={`grid gap-6 ${gridClass}`}>
                {showCommand && (
                  <ModuleTile
                    icon={<Command size={24} />}
                    name="Command Centre"
                    description="Team overview + pending actions across HR, CRM, and MIS."
                    path="/crm/command-centre"
                    accentColor="#C9A961"
                  />
                )}
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
          {!showCommand && !showHrms && !showCrm && !showMis && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No modules assigned yet. Contact your admin.
            </p>
          )}

          {/* Phase P — PWA install nudge (after 3rd open, dismissible forever) */}
          <InstallPrompt />

          {/* Phase P — super-admin console for page shares */}
          {isSA && (
            <div className="mt-8 flex justify-center">
              <Link to="/admin/shares"
                className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl transition-opacity hover:opacity-80"
                style={{ color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' }}>
                <Share2 size={15} /> Manage Shares <ArrowRight size={14} />
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
