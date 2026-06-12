import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, addDoc, updateDoc, collection, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import type { UserProfile } from '../../types';

// ─── Session timeout ──────────────────────────────────────────────────────────
// 30 minutes of inactivity → automatic sign-out.
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_EXPIRED_KEY = '__finvastra_session_expired';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string;
  // True when the user is authenticated but their profile could not be loaded
  // after retries (transient network, DB outage, etc.). Lets the UI show a clear
  // "couldn't load your account — retry" screen instead of a confusing half-app.
  profileLoadFailed?: boolean;
}

// Retry a Firestore read a few times before giving up — smooths transient blips.
async function getDocWithRetry(ref: Parameters<typeof getDoc>[0], attempts = 3) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await getDoc(ref); }
    catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
  }
  throw lastErr;
}

const AuthContext = createContext<AuthState | null>(null);

// ─── Device fingerprint + login history ──────────────────────────────────────

async function computeDeviceFingerprint(): Promise<string> {
  // Combine stable browser characteristics into a short hash.
  // Not cryptographically identifying — used only to detect "new vs known" device.
  const raw = [
    navigator.userAgent,
    screen.width + 'x' + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
  ].join('|');
  const msgBuffer = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

async function recordLoginEvent(userId: string, user: User): Promise<void> {
  const fingerprint = await computeDeviceFingerprint();
  const now = serverTimestamp();
  const userAgent = navigator.userAgent;

  // Write to login history (last 50 retained — trimmed server-side in Phase 6)
  const historyRef = collection(db, 'users', userId, 'login_history');
  await addDoc(historyRef, {
    signedInAt: now,
    userAgent,
    deviceFingerprint: fingerprint,
  });

  // Check if device is new
  const devicesRef = collection(db, 'users', userId, 'known_devices');
  const deviceDocRef = doc(devicesRef, fingerprint);
  const existingDevice = await getDoc(deviceDocRef);

  if (!existingDevice.exists()) {
    // New device — register it and fire an alert email via the server
    await setDoc(deviceDocRef, {
      firstSeenAt: now,
      lastSeenAt: now,
      userAgent,
    });
    const token = await user.getIdToken();
    fetch('/api/auth/login-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userAgent, isNewDevice: true }),
    }).catch(() => {}); // fire-and-forget; must not block the auth flow
  } else {
    // Known device — update lastSeen only
    await updateDoc(deviceDocRef, { lastSeenAt: now });
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, profile: null, loading: true, authError: '' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Holds the onSnapshot unsubscribe for the logged-in user's profile doc.
  // Cancelled whenever the user signs out or a new auth event fires.
  const profileUnsubRef = useRef<(() => void) | null>(null);

  // ── Idle session timeout ──────────────────────────────────────────────────
  useEffect(() => {
    if (!state.user) return; // Only arm the timer when a user is signed in.

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        sessionStorage.setItem(SESSION_EXPIRED_KEY, '1');
        await signOut(auth);
        // onAuthStateChanged fires with null → router redirects to /login.
      }, SESSION_TIMEOUT_MS);
    }

    const EVENTS = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'] as const;
    EVENTS.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer(); // Arm on sign-in.

    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.user]);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      // Cancel any previous profile listener from a prior sign-in.
      if (profileUnsubRef.current) {
        profileUnsubRef.current();
        profileUnsubRef.current = null;
      }

      if (!user) {
        setState({ user: null, profile: null, loading: false, authError: '' });
        return;
      }

      // Hard domain gate — only @finvastra.com accounts may access this app.
      if (!user.email?.endsWith('@finvastra.com')) {
        // Log the blocked attempt (fire-and-forget, must not throw)
        addDoc(collection(db, 'access_logs'), {
          action: 'blocked_non_domain_login',
          email: user.email ?? 'unknown',
          at: serverTimestamp(),
        }).catch(() => {});
        await signOut(auth);
        setState({
          user: null, profile: null, loading: false,
          authError: 'Only @finvastra.com accounts are permitted. Use your official company email.',
        });
        return;
      }

      const ADMIN_EMAILS = ['rahulv@finvastra.com'];
      const shouldBeAdmin = ADMIN_EMAILS.includes(user.email ?? '');

      try {
        const ref = doc(db, 'users', user.uid);
        const snap = await getDocWithRetry(ref);

        if (!snap.exists()) {
          // First sign-in: create profile. Admin email gets role='admin' (allowlisted in rules).
          const newProfile: UserProfile = {
            userId: user.uid,
            email: user.email ?? '',
            displayName: user.displayName ?? user.email?.split('@')[0] ?? 'User',
            role: shouldBeAdmin ? 'admin' : 'employee',
            photoURL:
              user.photoURL ??
              `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(user.email ?? 'U')}`,
            hrmsAccess: true,
            crmAccess: shouldBeAdmin,
            createdAt: serverTimestamp() as unknown as import('firebase/firestore').Timestamp,
          };
          await setDoc(ref, newProfile);
          setState({ user, profile: newProfile, loading: false, authError: '' });
        } else {
          const existing = snap.data() as UserProfile;

          // Profile exists but role is wrong — promote via server (Admin SDK bypasses rules).
          if (shouldBeAdmin && existing.role !== 'admin') {
            const token = await user.getIdToken();
            await fetch('/api/dev/bootstrap-admin', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            }).catch(() => {});
            // Re-read after promotion
            const refreshed = await getDoc(ref);
            setState({ user, profile: refreshed.exists() ? (refreshed.data() as UserProfile) : existing, loading: false, authError: '' });
          } else {
            setState({ user, profile: existing, loading: false, authError: '' });
          }
        }

        // Live profile listener — picks up any change to the user doc (photoURL,
        // role, permissions, etc.) without requiring a page reload.
        let lastClaimsRefresh: number | null = null;
        profileUnsubRef.current = onSnapshot(ref, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile & { claimsRefreshedAt?: { toMillis?: () => number } };
            // Claims-staleness fix: sync-claims stamps claimsRefreshedAt after
            // updating custom claims. Force-refresh the ID token when it changes
            // so revoked roles/perms take effect immediately (not after the ≤1h
            // token rotation). Baseline on first snapshot — no refresh loop.
            const ts = data.claimsRefreshedAt?.toMillis?.() ?? null;
            if (ts !== null) {
              if (lastClaimsRefresh !== null && ts > lastClaimsRefresh) {
                auth.currentUser?.getIdToken(true).catch(() => {});
              }
              lastClaimsRefresh = ts;
            }
            setState((prev) =>
              prev.user ? { ...prev, profile: data } : prev,
            );
          }
        }, () => { /* ignore listener errors — initial load already succeeded */ });

      } catch {
        // Firestore read/write failed after retries (offline, transient network, a
        // DB/rules outage). The user IS authenticated — never strand them on a blank
        // page. Resolve loading and flag the failure so the UI can show a clear
        // "couldn't load your account — retry" screen instead of a confusing half-app.
        setState({ user, profile: null, loading: false, authError: '', profileLoadFailed: true });
      }

      // Non-blocking: track login history and detect new devices.
      // Failures here must never interrupt the auth flow.
      recordLoginEvent(user.uid, user).catch(() => {});
    });

    return () => {
      unsubAuth();
      if (profileUnsubRef.current) {
        profileUnsubRef.current();
        profileUnsubRef.current = null;
      }
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export { SESSION_EXPIRED_KEY };

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
