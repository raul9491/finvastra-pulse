// ─── UiPrefsCloudSync (Phase 6) ───────────────────────────────────────────────
// Mirrors the local UI prefs (pinned pages + open sidebar sections) to
// /users/{uid}.uiPrefs so they follow the user across devices. localStorage stays
// the instant, offline-safe primary; this only adds a best-effort cloud mirror.
// Mounted once inside AuthProvider. Renders nothing.

import { useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from './AuthContext';
import { registerUiPrefsCloud, hydrateUiPrefsFromCloud } from './hooks/useUiPrefs';

export function UiPrefsCloudSync() {
  const { user, profile } = useAuth();

  // Register the Firestore writer while signed in (best-effort; never throws).
  useEffect(() => {
    if (!user) { registerUiPrefsCloud(null); return; }
    registerUiPrefsCloud((p) => { updateDoc(doc(db, 'users', user.uid), { uiPrefs: p }).catch(() => {}); });
    return () => registerUiPrefsCloud(null);
  }, [user?.uid]);

  // Adopt cloud prefs on first load + whenever another device changes them. The
  // JSON-equality guard in hydrateUiPrefsFromCloud makes this loop-safe (our own
  // write comes back via the profile snapshot equal → no-op).
  useEffect(() => {
    hydrateUiPrefsFromCloud(profile?.uiPrefs);
  }, [profile?.uiPrefs]);

  return null;
}
