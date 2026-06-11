import { NavLink, useLocation } from 'react-router-dom';
import { pageIcon, type PageKey } from '../../config/shareablePages';
import type { PageShare } from '../../types';

/**
 * "SHARED WITH ME" sidebar section — Phase P.
 * Rendered by all three shells: as the ONLY nav for share-only users, or
 * appended at the bottom for full-access users who also hold shares.
 */
export function SharedNavSection({ shares }: { shares: PageShare[] }) {
  const location = useLocation();
  if (shares.length === 0) return null;

  return (
    <>
      <div className="px-3 pt-4 pb-2">
        <p className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: '#C9A961' }}>
          Shared with me
        </p>
      </div>
      {shares.map((s) => {
        const Icon = pageIcon(s.pageKey as PageKey);
        const [routePath, routeQuery] = s.pageRoute.split('?');
        const params = new URLSearchParams(routeQuery ?? '');
        let isActive = location.pathname === routePath;
        if (isActive && routeQuery) {
          const current = new URLSearchParams(location.search);
          params.forEach((v, k) => { if (current.get(k) !== v) isActive = false; });
        }
        return (
          <NavLink
            key={s.id}
            to={s.pageRoute}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors nav-item-hover"
            style={{
              color: isActive ? '#C9A961' : 'var(--shell-text-secondary)',
              backgroundColor: isActive ? 'rgba(201,169,97,0.12)' : 'transparent',
              borderLeft: isActive ? '2px solid #C9A961' : '2px solid transparent',
            }}
          >
            <Icon size={15} className="shrink-0" />
            <span className="truncate">{s.pageTitle}</span>
          </NavLink>
        );
      })}
    </>
  );
}

/**
 * Is the current location covered by one of the user's shares?
 * Exact registry-key match OR a drill-down under a shared route
 * (e.g. share of /crm/leads also covers /crm/leads/{id}) — detail pages would
 * otherwise be dead ends; module-level data access already permits the reads.
 */
export function locationCoveredByShares(
  shares: PageShare[],
  resolvedKey: string | null,
  pathname: string,
): boolean {
  if (resolvedKey && shares.some((s) => s.pageKey === resolvedKey)) return true;
  const path = pathname.replace(/\/+$/, '');
  return shares.some((s) => {
    const route = s.pageRoute.split('?')[0].replace(/\/+$/, '');
    return path === route || path.startsWith(route + '/');
  });
}
