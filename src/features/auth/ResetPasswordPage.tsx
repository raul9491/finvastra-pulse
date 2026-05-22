import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { updatePassword, signOut } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { Eye, EyeOff, CheckCircle2, Circle, LogOut } from 'lucide-react';
import { VideoLogo } from '../../components/ui/VideoLogo';
import { auth, db } from '../../lib/firebase';
import { useAuth } from './AuthContext';
import { useToast } from '../../components/ui/Toast';

// ─── Decorative rings (reused from LoginPage) ─────────────────────────────────
function ConcentricRings() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none select-none"
      aria-hidden preserveAspectRatio="xMidYMid slice">
      {[120, 240, 360, 480, 600, 720, 840, 960].map((r) => (
        <circle key={r} cx="50%" cy="50%" r={r} fill="none"
          stroke="rgba(201,169,97,0.04)" strokeWidth="1" />
      ))}
    </svg>
  );
}

// ─── Password rule row ────────────────────────────────────────────────────────
function Rule({ met, label }: { met: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {met
        ? <CheckCircle2 size={13} style={{ color: '#065F46' }} />
        : <Circle       size={13} style={{ color: '#8B8B85' }} />}
      <span className="text-xs" style={{ color: met ? '#065F46' : '#8B8B85' }}>{label}</span>
    </div>
  );
}

// ─── ResetPasswordPage ────────────────────────────────────────────────────────
export function ResetPasswordPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const toast    = useToast();

  const [newPwd,      setNewPwd]      = useState('');
  const [confirmPwd,  setConfirmPwd]  = useState('');
  const [showNew,     setShowNew]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);

  const handleSignOutRetry = async () => {
    await signOut(auth);
    navigate('/login', { replace: true });
  };

  const rules = {
    minLength:   newPwd.length >= 8,
    hasUpper:    /[A-Z]/.test(newPwd),
    hasNumber:   /[0-9]/.test(newPwd),
  };
  const allRulesMet = Object.values(rules).every(Boolean);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!allRulesMet) { setError('Password does not meet all requirements.'); return; }
    if (newPwd !== confirmPwd) { setError('Passwords do not match.'); return; }
    if (!user) { setError('Not authenticated.'); return; }

    setSubmitting(true);
    try {
      await updatePassword(user, newPwd);
      await updateDoc(doc(db, 'users', user.uid), { mustResetPassword: false });
      toast.success('Password updated successfully');
      navigate('/', { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Password update failed';
      if (msg.includes('requires-recent-login')) {
        setNeedsReauth(true);
        setError('For security, please sign out and sign in again to set your password.');
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const inp = `w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none
    transition-colors focus:border-navy focus:ring-2 focus:ring-navy/10 pr-11`;

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-navy">
      <ConcentricRings />

      {/* Video logo — top-left */}
      <div className="absolute top-6 left-6 z-20">
        <VideoLogo size="sm" showText={true} />
      </div>

      <div className="relative z-10 w-full mx-4 max-w-md">
        <div className="bg-white rounded-3xl p-10 shadow-[0_24px_64px_rgba(0,0,0,0.3)]">

          <h1 className="text-2xl font-bold text-ink text-center mb-2"
            style={{ fontFamily: '"Fraunces", Georgia, serif' }}>
            Set your password
          </h1>
          <p className="text-sm text-center mb-7" style={{ color: '#8B8B85' }}>
            You must set a new password before you can access Finvastra Pulse.
            {profile?.displayName && (
              <span className="block mt-1 font-medium" style={{ color: '#0A0A0A' }}>
                {profile.displayName}
              </span>
            )}
          </p>

          {error && (
            <div className="mb-4 space-y-3">
              <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                {error}
              </div>
              {needsReauth && (
                <button
                  type="button"
                  onClick={handleSignOutRetry}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-colors"
                  style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
                >
                  <LogOut size={15} />
                  Sign out and sign in again
                </button>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* New password */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5"
                style={{ color: '#8B8B85' }}>
                New password
              </label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  autoComplete="new-password"
                  className={inp}
                  style={{ color: '#0A0A0A' }}
                />
                <button type="button" tabIndex={-1}
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {/* Live rules */}
              {newPwd.length > 0 && (
                <div className="mt-2 space-y-1 pl-1">
                  <Rule met={rules.minLength} label="Minimum 8 characters" />
                  <Rule met={rules.hasUpper}  label="At least one uppercase letter" />
                  <Rule met={rules.hasNumber} label="At least one number" />
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5"
                style={{ color: '#8B8B85' }}>
                Confirm password
              </label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  autoComplete="new-password"
                  className={inp}
                  style={{ color: '#0A0A0A' }}
                />
                <button type="button" tabIndex={-1}
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {confirmPwd.length > 0 && newPwd !== confirmPwd && (
                <p className="mt-1 text-xs text-red-500">Passwords do not match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={!allRulesMet || newPwd !== confirmPwd || submitting}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 mt-2"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
            >
              {submitting ? 'Saving…' : 'Set password & continue'}
            </button>
          </form>

          <p className="text-center text-xs mt-6" style={{ color: '#8B8B85' }}>
            This step cannot be skipped.
          </p>
          <p className="text-center text-xs mt-3" style={{ color: '#8B8B85' }}>
            Having trouble?{' '}
            <button
              type="button"
              onClick={handleSignOutRetry}
              className="underline hover:opacity-70 transition-opacity"
              style={{ color: '#8B8B85' }}
            >
              Sign out
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
