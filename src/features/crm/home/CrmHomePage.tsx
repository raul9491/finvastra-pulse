/**
 * CrmHomePage — the role-based CRM landing at /crm/dashboard (2026-07-03
 * simplification; replaces CrmDashboardPage). This component calls NO data
 * hooks itself: it branches on persona and mounts exactly ONE child, so each
 * child's hooks are unconditional within itself and no persona pays for
 * another persona's listeners.
 *
 *   admin / super-admin        → BusinessPulseHome
 *   crmRole === 'manager'      → TeamPulseHome
 *   everyone else (crmAccess)  → MyDayHome
 */
import { useAuth } from '../../auth/AuthContext';
import { isSuperAdmin } from '../../../config/hrmsConfig';
import { MyDayHome } from './MyDayHome';
import { TeamPulseHome } from './TeamPulseHome';
import { BusinessPulseHome } from './BusinessPulseHome';

export function CrmHomePage() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || (user ? isSuperAdmin(user.uid, profile) : false);
  const isManager = profile?.crmRole === 'manager';

  if (isAdmin) return <BusinessPulseHome />;
  if (isManager) return <TeamPulseHome />;
  return <MyDayHome />;
}
