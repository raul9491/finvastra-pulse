import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { BellRing, Loader2 } from 'lucide-react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { isSuperAdmin } from '../../config/hrmsConfig';
import { NOTIFICATION_TOGGLES, NOTIFICATION_GROUPS } from '../../config/notifications';

/**
 * CRM → Admin → Notifications (/crm/admin/notifications) — one place to turn the
 * platform's automated emails + alerts on/off, company-wide. Super admins edit;
 * managers/admins view. Backed by the single doc app_config/notification_settings
 * (a key is stored only when turned OFF). The server checks these switches
 * (notificationsEnabled) before every scheduled send. Renders inside the CRM shell.
 */
export function NotificationSettingsPage() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const canEdit = !!user && isSuperAdmin(user.uid, profile);
  const canView = canEdit
    || profile?.role === 'admin'
    || profile?.crmRole === 'manager'
    || profile?.isHrmsManager === true;

  useEffect(() => {
    return onSnapshot(
      doc(db, 'app_config', 'notification_settings'),
      (snap) => { setSettings((snap.data() ?? {}) as Record<string, boolean>); setLoading(false); },
      () => setLoading(false),
    );
  }, []);

  if (!user) return <Navigate to="/login" replace />;
  if (!canView) return <Navigate to="/" replace />;

  const isOn = (key: string) => settings[key] !== false;   // default ENABLED

  const toggle = async (key: string, label: string) => {
    if (!canEdit || saving) return;
    const next = !isOn(key);
    setSaving(key);
    try {
      await setDoc(
        doc(db, 'app_config', 'notification_settings'),
        { [key]: next, updatedAt: serverTimestamp(), updatedBy: user.uid },
        { merge: true },
      );
      toast.success(`${label} ${next ? 'turned on' : 'turned off'}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'rgba(201,169,97,0.14)' }}>
            <BellRing size={20} style={{ color: '#C9A961' }} />
          </div>
          <h1 className="text-3xl" style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: 'var(--text-primary)' }}>
            Notifications
          </h1>
        </div>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          Turn the platform's automated emails &amp; alerts on or off, company-wide. Changes take
          effect within a minute — no one gets that notification while it's off.
          {!canEdit && ' You can view these; only super admins can change them.'}
        </p>

        {loading ? (
          <div className="glass-panel p-10 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {NOTIFICATION_GROUPS.map((group) => {
              const items = NOTIFICATION_TOGGLES.filter((t) => t.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group} className="glass-panel overflow-hidden">
                  <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--shell-border)', backgroundColor: 'var(--shell-hover-soft)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{group}</p>
                  </div>
                  <div>
                    {items.map((t, i) => {
                      const on = isOn(t.key);
                      return (
                        <div key={t.key}
                          className="flex items-start justify-between gap-4 px-5 py-4"
                          style={{ borderTop: i === 0 ? 'none' : '1px solid var(--shell-border)' }}>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t.label}</p>
                            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{t.description}</p>
                          </div>
                          {/* Toggle switch */}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={on}
                            aria-label={`${t.label} — ${on ? 'on' : 'off'}`}
                            disabled={!canEdit || saving === t.key}
                            onClick={() => toggle(t.key, t.label)}
                            className="shrink-0 mt-0.5 relative rounded-full transition-colors"
                            style={{
                              width: 42, height: 24,
                              backgroundColor: on ? '#C9A961' : 'var(--shell-hover-hard)',
                              cursor: canEdit ? 'pointer' : 'not-allowed',
                              opacity: canEdit ? 1 : 0.7,
                            }}>
                            <span className="absolute rounded-full transition-all"
                              style={{
                                top: 3, left: on ? 21 : 3, width: 18, height: 18,
                                backgroundColor: on ? '#0B1538' : '#FAFAF7',
                              }} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs mt-6" style={{ color: 'var(--text-muted)' }}>
          These are automated/recurring notifications only. One-off action emails (leave, claim
          and attendance approvals, security alerts) always send and aren't listed here.
        </p>
      </div>
    </div>
  );
}
