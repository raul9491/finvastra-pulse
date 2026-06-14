import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, ExternalLink, PlayCircle } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { isSuperAdmin } from '../../config/hrmsConfig';
import { useTour } from './useTour';
import { TOUR_LABEL } from './tourSteps';
import type { LearnModule } from '../../types';
import type { LearnSection, QuickLinkDef } from './types';

function AccordionSection({ section }: { section: LearnSection }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [openItems, setOpenItems] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setOpenItems((prev) => {
    const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next;
  });

  return (
    <div className="bg-(--glass-panel-bg) border border-(--shell-border) rounded-2xl overflow-hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-5 hover:bg-(--glass-panel-bg)/60 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: section.color + '15', color: section.color }}>
            {section.icon}
          </div>
          <span className="text-sm font-semibold text-(--text-primary) text-left">{section.title}</span>
          <span className="text-xs text-(--text-muted) hidden sm:inline">{section.items.length} topic{section.items.length !== 1 ? 's' : ''}</span>
        </div>
        {open ? <ChevronDown size={16} className="text-(--text-muted) shrink-0" /> : <ChevronRight size={16} className="text-(--text-muted) shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-(--shell-border) divide-y divide-(--shell-border)">
          {section.items.map((item, i) => (
            <div key={i} className="px-5">
              <button onClick={() => toggle(i)} className="w-full flex items-center justify-between py-3.5 text-left gap-3">
                <span className="text-sm text-(--text-primary) font-medium flex-1">{item.q}</span>
                {openItems.has(i) ? <ChevronDown size={14} className="text-(--text-muted) shrink-0" /> : <ChevronRight size={14} className="text-(--text-muted) shrink-0" />}
              </button>
              {openItems.has(i) && (
                <div className="pb-4 space-y-3">
                  <div className="text-sm text-(--text-primary) leading-relaxed">{item.a}</div>
                  {item.link && (
                    <button onClick={() => navigate(item.link!)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                      style={{ backgroundColor: section.color + '12', color: section.color }}>
                      <ExternalLink size={12} />{item.linkLabel ?? 'Open'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickLink({ label, href, color }: QuickLinkDef) {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(href)}
      className="px-3 py-3 text-xs font-semibold rounded-xl border transition-all hover:shadow-sm text-center"
      style={{ borderColor: color + '30', color, backgroundColor: color + '08' }}>
      {label}
    </button>
  );
}

/**
 * LearnView — the reusable "Learn" tab for any module. Header + a prominent
 * "Take the guided tour" button (replays the spotlight coachmarks) + quick
 * links + searchable accordion. Content is passed in per module.
 */
export function LearnView({ module, title, intro, quickLinks = [], sections }: {
  module: LearnModule;
  title: string;
  intro?: string;
  quickLinks?: QuickLinkDef[];
  sections: LearnSection[];
}) {
  const { profile, user } = useAuth();
  const { startTour } = useTour();
  const [search, setSearch] = useState('');

  const ctx = {
    isAdmin: profile?.role === 'admin',
    isManager: profile?.crmRole === 'manager' || profile?.role === 'admin',
    isHrmsManager: profile?.isHrmsManager === true || profile?.role === 'admin'
      || isSuperAdmin(user?.uid ?? '', profile ?? undefined),
  };

  const visible = sections.filter((s) => !s.show || s.show(ctx));
  const query = search.toLowerCase().trim();
  const filtered = query
    ? visible.map((s) => ({
        ...s,
        items: s.items.filter((it) =>
          it.q.toLowerCase().includes(query) || (typeof it.a === 'string' && it.a.toLowerCase().includes(query))),
      })).filter((s) => s.items.length > 0)
    : visible;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl mb-1 text-(--text-primary)"
            style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300 }}>
            {title}
          </h2>
          <p className="text-sm text-(--text-muted)">
            {intro ?? 'Learn what each tool does and how to use Pulse efficiently.'}
            {profile?.displayName && ` Hi, ${profile.displayName.split(' ')[0]}!`}
          </p>
        </div>
        <button onClick={() => startTour(module)}
          data-tour="learn"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shrink-0 transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#C9A961', color: '#0B1538' }}>
          <PlayCircle size={16} /> Take the guided tour
        </button>
      </div>

      {quickLinks.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quickLinks.map((q) => <QuickLink key={q.href} {...q} />)}
        </div>
      )}

      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder={`Search ${TOUR_LABEL[module]} topics…`}
        className="w-full px-4 py-3 text-sm border border-(--shell-border) rounded-xl outline-none focus:ring-2 bg-(--glass-panel-bg)" />

      <div className="space-y-3">
        {filtered.length === 0
          ? <p className="text-sm text-(--text-muted) text-center py-8">No topics match “{search}”. Try a different keyword.</p>
          : filtered.map((s) => <AccordionSection key={s.id} section={s} />)}
      </div>
    </div>
  );
}
