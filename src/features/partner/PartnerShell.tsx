/**
 * PartnerShell — the connector (channel-partner) area at /partner/*.
 *
 * Deliberately NOT built on ModuleSidebar / AppsMenu / CommandPalette: those
 * surface every other module, and the entire point of this area is that a partner
 * sees their own work and nothing else. Four links, no module switcher, no search
 * across the app. Keeping the surface small keeps the attack surface small —
 * firestore.rules is still the real boundary (see the "Connector isolation"
 * section of CLAUDE.md and .qa/connector-isolation-gate.mjs).
 *
 * Gate: `profile.connectorId`. Staff who wander here are sent to the launcher.
 */
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { AnimatePresence, motion } from 'motion/react';
import { Home, Inbox, Briefcase, Wallet, User } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import { VideoLogo } from '../../components/ui/VideoLogo';
import { ThemeToggle, useTheme } from '../../components/ui/ThemeProvider';

const NAV = [
  { to: '/partner/home',    label: 'Home',      Icon: Home },
  { to: '/partner/leads',   label: 'My Leads',  Icon: Inbox },
  { to: '/partner/cases',   label: 'My Cases',  Icon: Briefcase },
  { to: '/partner/payouts', label: 'My Payouts', Icon: Wallet },
  { to: '/partner/profile', label: 'My Details', Icon: User },
];

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--navy-deep)' }}>
      <VideoLogo size="sm" showText />
    </div>
  );
}

export function PartnerShell() {
  const { user, profile, loading } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  // Staff never belong here; partners never belong anywhere else.
  if (!profile?.connectorId) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--app-bg)' }}>
      {/* Header */}
      <header className="sticky top-0 z-30 glass-header">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <VideoLogo size="sm" showText dark={theme === 'light'} />
            <span className="hidden sm:inline text-xs font-semibold px-2 py-1 rounded-md shrink-0"
              style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
              Partner
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:block text-xs truncate max-w-[190px]" style={{ color: 'var(--text-muted)' }}>
              {profile.displayName ?? user.email}
            </span>
            <ThemeToggle />
            <button onClick={() => signOut(auth)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ border: '1px solid var(--shell-border)', color: 'var(--text-secondary)' }}>
              Sign out
            </button>
          </div>
        </div>

        {/* Nav — scrolls horizontally on a phone rather than wrapping */}
        <nav className="max-w-5xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto pb-2">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors"
              style={({ isActive }) => (isActive
                ? { backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961', border: '1px solid rgba(201,169,97,0.35)' }
                : { color: 'var(--text-muted)', border: '1px solid transparent' })}>
              <Icon size={15} /> {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 overflow-x-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={location.pathname}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}>
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
