/**
 * SocialShell — shell for the Social Media module (/social/*). First channel:
 * WhatsApp inbox. Mirrors MisShell (header + ModuleSidebar + command palette +
 * mobile tabs) but gated on `socialAccess` (admins always have it). The module is
 * designed to grow channel-by-channel (FB/IG Messenger, comments, content).
 */

import { useState, useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { AnimatePresence, motion } from 'motion/react';
import { MessageCircle, LogOut, Menu, X, User } from 'lucide-react';
import { MobileTabBar } from '../ui/MobileTabBar';
import { auth } from '../../lib/firebase';
import { useAuth } from '../../features/auth/AuthContext';
import { VideoLogo } from '../ui/VideoLogo';
import { ThemeToggle, useTheme } from '../ui/ThemeProvider';
import { UserMenu } from '../ui/UserMenu';
import { AppsMenu } from '../ui/AppsMenu';
import { CommandPalette, CommandSearchButton } from '../ui/CommandPalette';
import { ModuleSidebar } from './ModuleSidebar';
import { buildNavCtx } from '../../config/navigation';

const PAGE_TITLES: Record<string, string> = {
  '/social/inbox': 'WhatsApp Inbox',
};

function resolveSocialTitle(pathname: string): string {
  return PAGE_TITLES[pathname] ?? 'Social Media';
}

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--navy-deep)' }}>
      <VideoLogo size="sm" showText />
    </div>
  );
}

export function SocialShell() {
  const { user, profile, loading } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.mustResetPassword) return <Navigate to="/reset-password" replace />;

  const canAccess = profile?.role === 'admin' || profile?.socialAccess === true;
  if (!canAccess) return <Navigate to="/" replace />;

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login', { replace: true });
  };

  const pageTitle = resolveSocialTitle(location.pathname);
  const navCtx = buildNavCtx(user, profile);
  const initials = profile?.displayName
    ? profile.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  const navBody = (
    <div className="flex-1 px-2 space-y-0.5 overflow-y-auto pb-4">
      <ModuleSidebar module="social" navCtx={navCtx} pathname={location.pathname} />
    </div>
  );

  const userFooter = (
    <div className="p-4 shrink-0" style={{ borderTop: '1px solid var(--shell-border)' }}>
      <div className="flex items-center gap-3">
        {profile?.photoURL ? (
          <img src={profile.photoURL} alt={profile.displayName} className="w-8 h-8 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{profile?.displayName}</p>
          <p className="text-[10px] uppercase tracking-widest truncate" style={{ color: 'var(--shell-text-dim)' }}>{profile?.role}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--navy-deep)' }}>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex md:flex-col w-60 shrink-0 glass-sidebar">
        <div className="h-16 flex items-center px-4 shrink-0" style={{ borderBottom: '1px solid var(--shell-border)' }}>
          <VideoLogo size="xs" showText dark={theme === 'light'} />
        </div>
        <div className="px-5 pt-5 pb-3">
          <p className="glass-module-label font-bold">Social Media</p>
        </div>
        {navBody}
        {userFooter}
      </nav>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileNavOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileNavOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 w-60 z-50 md:hidden flex flex-col glass-sidebar"
              initial={{ x: -240 }} animate={{ x: 0 }} exit={{ x: -240 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <div className="h-16 flex items-center justify-between px-4 shrink-0" style={{ borderBottom: '1px solid var(--shell-border)' }}>
                <VideoLogo size="xs" showText dark={theme === 'light'} />
                <button onClick={() => setMobileNavOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-(--shell-hover-hard) transition-colors" aria-label="Close navigation menu">
                  <X size={18} style={{ color: 'var(--shell-text-secondary)' }} />
                </button>
              </div>
              <div className="px-5 pt-5 pb-3">
                <p className="glass-module-label font-bold">Social Media</p>
              </div>
              {navBody}
              {userFooter}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-16 glass-header flex items-center justify-between px-4 sm:px-6 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button className="md:hidden p-2 -ml-1 rounded-lg hover:bg-(--shell-hover-hard) transition-colors shrink-0"
              onClick={() => setMobileNavOpen(true)} aria-label="Open navigation menu">
              <Menu size={20} style={{ color: 'var(--shell-text-icon)' }} />
            </button>
            <AppsMenu profile={profile} currentModule="social" />
            <div className="w-px h-4 hidden sm:block shrink-0" style={{ backgroundColor: 'var(--shell-border-mid)' }} />
            <h1 className="text-base font-semibold truncate min-w-0" style={{ color: 'var(--text-primary)' }}>{pageTitle}</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <CommandSearchButton />
            <ThemeToggle />
            <UserMenu
              displayName={profile?.displayName ?? ''}
              photoURL={profile?.photoURL}
              initials={initials}
              roleLabel={profile?.role === 'admin' ? 'Admin' : 'Agent'}
              links={[{ label: 'My HR Profile', path: `/hrms/employees/${user?.uid}`, Icon: User }]}
              onLogout={handleLogout}
            />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 pb-24 md:p-8" style={{ backgroundColor: 'transparent' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <MobileTabBar
        tabs={[{ label: 'Inbox', path: '/social/inbox', Icon: MessageCircle, end: true }]}
        onMenu={() => setMobileNavOpen(true)}
      />
      <CommandPalette />
    </div>
  );
}
