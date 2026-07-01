import { Navigate, useNavigate, Link } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { ArrowRight, LogOut, Share2, Search, Star, Clock, BellRing } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import { VideoLogo } from '../../components/ui/VideoLogo';
import { CommandPalette, openCommandPalette, getCommandRecents } from '../../components/ui/CommandPalette';
import { useMyShares } from '../auth/hooks/useMyShares';
import { useUiPrefs } from '../auth/hooks/useUiPrefs';
import { isSuperAdmin } from '../../config/hrmsConfig';
import {
  MODULES, buildNavCtx, resolveNavIcon, nodeByKey, MODULE_ACCENTS,
  type NavNode, type ModuleKey,
} from '../../config/navigation';

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--navy-deep)' }}>
      <VideoLogo size="sm" showText />
    </div>
  );
}

/** A module entry card with the module's own accent. */
function ModuleTile({ moduleKey, name, description, icon, accent, onClick }: {
  moduleKey: ModuleKey; name: string; description: string; icon: string; accent: string; onClick: () => void;
}) {
  const Icon = resolveNavIcon(icon);
  return (
    <button
      onClick={onClick}
      data-module={moduleKey}
      className="group text-left w-full glass-panel glass-card p-7 transition-all duration-200 hover:-translate-y-0.5"
    >
      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
        style={{ backgroundColor: accent + '1F', color: accent }}>
        <Icon size={24} />
      </div>
      <h2 className="text-2xl mb-1.5"
        style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
        {name}
      </h2>
      <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--text-muted)' }}>{description}</p>
      <div className="flex items-center gap-2 text-sm font-semibold transition-all group-hover:gap-3" style={{ color: accent }}>
        Open {name} <ArrowRight size={15} />
      </div>
    </button>
  );
}

/** Quick-access chip (pinned / recent page). */
function QuickChip({ node, pinned, onClick }: { node: NavNode; pinned: boolean; onClick: () => void }) {
  const Icon = resolveNavIcon(node.icon);
  const accent = MODULE_ACCENTS[node.module] ?? '#C9A961';
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl transition-all hover:-translate-y-0.5"
      style={{ backgroundColor: 'var(--glass-panel-bg)', border: '1px solid var(--shell-border)' }}>
      <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: accent + '1F', color: accent }}>
        <Icon size={15} />
      </span>
      <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{node.label}</span>
      {pinned && <Star size={11} fill="#C9A961" style={{ color: '#C9A961' }} className="shrink-0" />}
    </button>
  );
}

export function LauncherPage() {
  const { user, profile, loading, profileLoadFailed } = useAuth();
  const navigate = useNavigate();
  // Phase P — page shares: a shared page makes its module tile visible too.
  const myShares = useMyShares(user?.uid);
  const { pins } = useUiPrefs();

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;

  // Authenticated but the profile couldn't load. Most often this is simply being
  // offline (Pulse needs a connection to load your account + data); otherwise a
  // brief blip. Tailor the message so it's clear, not alarming.
  if (!profile && profileLoadFailed) {
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ backgroundColor: 'var(--navy-deep)' }}>
        <VideoLogo size="sm" showText />
        <h1 className="text-2xl mt-8 mb-2" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
          {offline ? "You're offline" : "We couldn't load your account"}
        </h1>
        <p className="text-sm mb-6 max-w-md" style={{ color: 'var(--text-muted)' }}>
          {offline
            ? 'Pulse needs an internet connection to load your account and data. Reconnect and reload — your data is safe.'
            : 'This is usually a brief connection hiccup. Reload to try again — your data is safe.'}
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

  const isSA = isSuperAdmin(user.uid, profile);
  const { sharesByModule } = myShares;
  const navCtx = buildNavCtx(user, profile);

  // Visible modules — registry access predicate, OR a held share in that module.
  const visibleModules = MODULES.filter((m) => {
    if (m.access(navCtx)) return true;
    if (m.key === 'hrms') return sharesByModule.hrms.length > 0;
    if (m.key === 'crm')  return sharesByModule.crm.length > 0;
    if (m.key === 'mis')  return sharesByModule.mis.length > 0;
    return false;
  });
  const hasAnyModule = visibleModules.some((m) => m.key !== 'lms');

  // Quick access: pins first, then recents (deduped), both filtered to what the
  // user can actually open.
  const accessible = (n: NavNode | undefined): n is NavNode => !!n && n.access(navCtx);
  const pinNodes = pins.map(nodeByKey).filter(accessible);
  const pinKeys = new Set(pinNodes.map((n) => n.key));
  const recentNodes = getCommandRecents().map(nodeByKey).filter(accessible).filter((n) => !pinKeys.has(n.key)).slice(0, 6);
  const quick = [
    ...pinNodes.map((n) => ({ node: n, pinned: true })),
    ...recentNodes.map((n) => ({ node: n, pinned: false })),
  ].slice(0, 8);

  const firstName = profile?.displayName?.split(' ')[0] ?? 'there';
  const tileCount = visibleModules.length;
  const gridClass = tileCount >= 5 ? 'sm:grid-cols-2 lg:grid-cols-3'
    : tileCount === 4 ? 'sm:grid-cols-2'
    : tileCount === 3 ? 'sm:grid-cols-3'
    : tileCount === 2 ? 'sm:grid-cols-2' : 'max-w-sm mx-auto';

  const handleLogout = async () => { await signOut(auth); navigate('/login', { replace: true }); };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'transparent' }}>

      {/* Top bar */}
      <header className="h-16 glass-header flex items-center justify-between px-6 sm:px-8 shrink-0">
        <VideoLogo size="xs" showText />
        <div className="flex items-center gap-3 sm:gap-4">
          {isSA && (
            <Link to="/admin/shares" title="Manage page shares"
              className="hidden sm:inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
              <Share2 size={15} /> <span className="hidden md:inline">Shares</span>
            </Link>
          )}
          {(isSA || profile?.role === 'admin' || profile?.crmRole === 'manager' || profile?.isHrmsManager === true) && (
            <Link to="/crm/admin/notifications" title="Automated notification settings"
              className="hidden sm:inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
              <BellRing size={15} /> <span className="hidden md:inline">Notifications</span>
            </Link>
          )}
          {profile?.photoURL ? (
            <img src={profile.photoURL} alt={profile.displayName} className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
              {profile?.displayName?.[0] ?? '?'}
            </div>
          )}
          <span className="text-sm font-medium hidden sm:block" style={{ color: 'var(--text-primary)' }}>{profile?.displayName}</span>
          <div className="w-px h-5" style={{ backgroundColor: 'var(--shell-border, rgba(255,255,255,0.10))' }} />
          <button onClick={handleLogout} className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-60" style={{ color: 'var(--text-muted)' }}>
            <LogOut size={15} /> <span className="hidden sm:block">Sign out</span>
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 sm:py-16">
        <div className="w-full max-w-3xl">

          <div className="flex justify-center mb-7">
            <VideoLogo size="md" showText />
          </div>

          <div className="mb-8 text-center">
            <h1 className="text-4xl mb-2" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
              Good day, {firstName}.
            </h1>
            <p style={{ color: 'var(--text-muted)' }}>Jump back in, or pick a module.</p>
          </div>

          {/* Global search → command palette */}
          <div className="mb-9 flex justify-center">
            <button onClick={openCommandPalette}
              className="w-full max-w-md flex items-center gap-2.5 px-4 py-3 rounded-xl transition-colors hover:bg-(--shell-hover-soft)"
              style={{ backgroundColor: 'var(--glass-panel-bg)', border: '1px solid var(--shell-border)', color: 'var(--text-muted)' }}>
              <Search size={17} />
              <span className="flex-1 text-left text-sm">Search pages &amp; actions…</span>
              <kbd className="hidden sm:inline text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--text-dim)', border: '1px solid var(--shell-border)' }}>⌘K</kbd>
            </button>
          </div>

          {/* Quick access — pinned + recent pages */}
          {quick.length > 0 && (
            <div className="mb-9">
              <div className="flex items-center gap-1.5 mb-2.5 px-0.5">
                <Clock size={12} style={{ color: 'var(--text-dim)' }} />
                <p className="text-[10px] font-bold uppercase tracking-[0.28em]" style={{ color: 'var(--text-dim)' }}>Quick access</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {quick.map(({ node, pinned }) => (
                  <QuickChip key={node.key} node={node} pinned={pinned} onClick={() => navigate(node.route)} />
                ))}
              </div>
            </div>
          )}

          {/* Module tiles */}
          <div className={`grid gap-5 ${gridClass}`}>
            {visibleModules.map((m) => (
              <ModuleTile
                key={m.key}
                moduleKey={m.key}
                name={m.label}
                description={m.desc}
                icon={m.icon}
                accent={m.accent}
                onClick={() => navigate(m.home)}
              />
            ))}
          </div>

          {/* No access fallback */}
          {!hasAnyModule && (
            <p className="text-sm text-center mt-6" style={{ color: 'var(--text-muted)' }}>
              No modules assigned yet. Contact your admin.
            </p>
          )}
        </div>
      </main>

      {/* Global ⌘K command palette */}
      <CommandPalette />
    </div>
  );
}
