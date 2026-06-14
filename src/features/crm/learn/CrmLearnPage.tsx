import { LearnView } from '../../learn/LearnView';
import { CRM_SECTIONS } from '../../learn/content/crm';

export function CrmLearnPage() {
  return (
    <LearnView
      module="crm"
      title="Learn the CRM"
      intro="What each tool does and how to work faster."
      quickLinks={[
        { label: 'My Queue',  href: '/crm/my-queue', color: '#3B82F6' },
        { label: 'Customers', href: '/crm/leads',    color: '#C9A961' },
        { label: 'Meetings',  href: '/crm/meetings',  color: '#8B5CF6' },
        { label: 'Pipeline',  href: '/crm/pipeline',  color: '#06B6D4' },
      ]}
      sections={CRM_SECTIONS}
    />
  );
}
