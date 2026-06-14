import { LearnView } from '../../learn/LearnView';
import { MIS_SECTIONS } from '../../learn/content/mis';

export function MisLearnPage() {
  return (
    <LearnView
      module="mis"
      title="Learn MIS"
      intro="Import, reconcile, resolve and pay — how the back-office works."
      quickLinks={[
        { label: 'Overview',       href: '/mis/overview',        color: 'var(--text-primary)' },
        { label: 'Statements',     href: '/mis/statements',      color: '#C9A961' },
        { label: 'Reconciliation', href: '/mis/reconciliation',  color: '#3B82F6' },
        { label: 'Disputes',       href: '/mis/disputes',        color: '#f87171' },
      ]}
      sections={MIS_SECTIONS}
    />
  );
}
