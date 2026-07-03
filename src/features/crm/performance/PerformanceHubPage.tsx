/**
 * PerformanceHubPage — /crm/performance — ONE home for all performance views
 * (2026-07-03 simplification). Consolidates the four scattered surfaces:
 *
 *   ?tab=me    → My Activity (everyone)          — was /crm/my-activity
 *   ?tab=team  → Team + All Teams (manager/admin) — was /crm/team
 *   ?tab=data  → Import performance (manager/admin/importer)
 *   ?tab=aging → Lead aging (manager/admin)       — was /crm/reports/aging
 *
 * The old routes redirect here with their query params preserved. Tabs the
 * user can't open are OMITTED (never disabled — "NOTHING LOCKED"). The heavy
 * existing pages are reused as tab bodies via their `embedded` prop.
 */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { isSuperAdmin } from '../../../config/hrmsConfig';
import { PageHeader } from '../../../components/ui/primitives';
import { MyActivityPage } from '../activity/MyActivityPage';
import { TeamPerformancePage } from '../team/TeamPerformancePage';
import { LeadAgingPage } from '../reports/LeadAgingPage';
import { ImportPerformanceSection } from '../import/ImportHistoryPage';

type HubTab = 'me' | 'team' | 'data' | 'aging';

const TAB_META: Record<HubTab, { label: string; subtitle: string }> = {
  me:    { label: 'My Activity',  subtitle: 'Your calls, statuses and untouched customers — tagged → attempted → outcome.' },
  team:  { label: 'Team',         subtitle: 'Every member\'s numbers, flags and reassignment — who to appreciate, who needs help.' },
  data:  { label: 'Data Sources', subtitle: 'Which import files produced business and which went cold.' },
  aging: { label: 'Lead Aging',   subtitle: 'How long leads have sat since creation — fresh, active, aging, stale.' },
};

export function PerformanceHubPage() {
  const { user, profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const isAdmin = profile?.role === 'admin' || (user ? isSuperAdmin(user.uid, profile) : false);
  const isManager = profile?.crmRole === 'manager';
  const canTeam = isAdmin || isManager;
  const canData = canTeam || profile?.crmCanImport === true;

  const tabs = useMemo(() => {
    const t: HubTab[] = ['me'];
    if (canTeam) t.push('team');
    if (canData) t.push('data');
    if (canTeam) t.push('aging');
    return t;
  }, [canTeam, canData]);

  const requested = (searchParams.get('tab') ?? 'me') as HubTab;
  const tab: HubTab = tabs.includes(requested) ? requested : 'me';
  // Seed the Team tab's picker ONCE from ?uid= (deep links from Home cards).
  const initialTeamUid = searchParams.get('uid') ?? undefined;

  const switchTab = (t: HubTab) => {
    const p = new URLSearchParams(searchParams);
    p.set('tab', t);
    p.delete('uid'); // a uid deep-link belongs to the tab it arrived on
    p.delete('view');
    setSearchParams(p, { replace: true });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Performance"
        subtitle={TAB_META[tab].subtitle}
        pinKey="crm.performance"
      />

      {/* Tab pills — same pattern as TasksPage */}
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button key={t} onClick={() => switchTab(t)}
            className="text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors"
            style={tab === t
              ? { backgroundColor: '#0B1538', color: '#E5C97C' }
              : { backgroundColor: 'var(--shell-hover-hard)', color: 'var(--text-secondary)' }}>
            {TAB_META[t].label}
          </button>
        ))}
      </div>

      <div className="pt-1">
        {tab === 'me' && <MyActivityPage embedded />}
        {tab === 'team' && <TeamPerformancePage key={initialTeamUid ?? 'own'} embedded initialViewUid={initialTeamUid} />}
        {tab === 'data' && <ImportPerformanceSection />}
        {tab === 'aging' && <LeadAgingPage embedded />}
      </div>
    </div>
  );
}
