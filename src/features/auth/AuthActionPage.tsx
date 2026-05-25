import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';
import { Eye, EyeOff, CheckCircle2, Circle, ShieldCheck } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { VideoLogo } from '../../components/ui/VideoLogo';

// ─── Decorative rings (same as ResetPasswordPage) ─────────────────────────────
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

// ─── Password strength rule row ───────────────────────────────────────────────
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

// ─── Page steps ───────────────────────────────────────────────────────────────
type Step = 'loading' | 'invalid' | 'dob' | 'password' | 'success';

// ─── AuthActionPage ───────────────────────────────────────────────────────────
// Handles the custom password-reset flow:
//   /auth-action?mode=resetPassword&oobCode=xxx
//
// Step 1 (dob)      — employee verifies their date of birth
// Step 2 (password) — employee sets a new password
// Step 3 (success)  — done, link back to /login
export function AuthActionPage() {
  const [searchParams] = useSearchParams();

  const mode    = searchParams.get('mode');
  const oobCode = searchParams.get('oobCode') ?? '';

  const [step,  setStep]  = useState<Step>('loading');
  const [email, setEmail] = useState('');

  // Step 1 state
  const [dob,        setDob]        = useState('');
  const [dobError,   setDobError]   = useState('');
  const [dobLoading, setDobLoading] = useState(false);

  // Step 2 state
  const [newPwd,      setNewPwd]      = useState('');
  const [confirmPwd,  setConfirmPwd]  = useState('');
  const [showNew,     setShowNew]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwdError,    setPwdError]    = useState('');
  const [pwdLoading,  setPwdLoading]  = useState(false);

  // On mount: validate the oobCode with Firebase and retrieve the email it's bound to
  useEffect(() => {
    if (mode !== 'resetPassword' || !oobCode) {
      setStep('invalid');
      return;
    }
    verifyPasswordResetCode(auth, oobCode)
      .then((resolvedEmail) => {
        setEmail(resolvedEmail);
        setStep('dob');
      })
      .catch(() => setStep('invalid'));
  }, [mode, oobCode]);

  // ── Step 1: DOB verification ──────────────────────────────────────────────
  const handleDobSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dob) { setDobError('Please enter your date of birth.'); return; }
    setDobLoading(true);
    setDobError('');
    try {
      const res  = await fetch('/api/auth/verify-reset-dob', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, dob }),
      });
      const data = await res.json() as { ok?: boolean; dobRequired?: boolean; error?: string };
      if (!res.ok) {
        setDobError(data.error ?? 'Date of birth does not match our records.');
        return;
      }
      // { ok: true } or { dobRequired: false } — both proceed to password step
      setStep('password');
    } catch {
      setDobError('Network error. Please try again.');
    } finally {
      setDobLoading(false);
    }
  };

  // ── Step 2: Set new password ──────────────────────────────────────────────
  const rules = {
    minLength: newPwd.length >= 8,
    hasUpper:  /[A-Z]/.test(newPwd),
    hasNumber: /[0-9]/.test(newPwd),
  };
  const allRulesMet = Object.values(rules).every(Boolean);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError('');
    if (!allRulesMet)           { setPwdError('Password does not meet all requirements.'); return; }
    if (newPwd !== confirmPwd)  { setPwdError('Passwords do not match.'); return; }
    setPwdLoading(true);
    try {
      await confirmPasswordReset(auth, oobCode, newPwd);
      setStep('success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('expired') || msg.includes('invalid')) {
        setPwdError('This reset link has expired. Please request a new one from the login page.');
      } else {
        setPwdError('Failed to update password. Please try again.');
      }
    } finally {
      setPwdLoading(false);
    }
  };

  const inp = [
    'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none',
    'transition-colors focus:border-navy focus:ring-2 focus:ring-navy/10',
  ].join(' ');

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-navy">
      <ConcentricRings />

      {/* Logo */}
      <div className="absolute top-6 left-6 z-20">
        <VideoLogo size="sm" showText={true} />
      </div>

      <div className="relative z-10 w-full mx-4 max-w-md">
        <div className="bg-white rounded-3xl p-10 shadow-[0_24px_64px_rgba(0,0,0,0.3)]">

          {/* ── Loading ── */}
          {step === 'loading' && (
            <p className="text-center text-sm py-4" style={{ color: '#8B8B85' }}>
              Verifying link…
            </p>
          )}

          {/* ── Invalid / expired link ── */}
          {step === 'invalid' && (
            <div className="text-center space-y-5">
              <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center"
                style={{ backgroundColor: '#FEF2F2' }}>
                <span className="text-2xl">⚠️</span>
              </div>
              <div>
                <h1 className="text-xl font-bold mb-2"
                  style={{ fontFamily: '"Fraunces", Georgia, serif', color: '#0A0A0A' }}>
                  Link expired or invalid
                </h1>
                <p className="text-sm" style={{ color: '#8B8B85' }}>
                  This reset link has expired or already been used. Request a new one from the sign-in page.
                </p>
              </div>
              <Link to="/login"
                className="block w-full py-3 rounded-xl text-sm font-semibold text-center transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                Back to sign in
              </Link>
            </div>
          )}

          {/* ── Step 1: DOB verification ── */}
          {step === 'dob' && (
            <>
              <div className="flex justify-center mb-5">
                <div className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: '#EFF6FF' }}>
                  <ShieldCheck size={22} style={{ color: '#1D4ED8' }} />
                </div>
              </div>

              <h1 className="text-2xl font-bold text-center mb-1"
                style={{ fontFamily: '"Fraunces", Georgia, serif', color: '#0A0A0A' }}>
                Verify your identity
              </h1>
              <p className="text-sm text-center mb-1" style={{ color: '#8B8B85' }}>
                Resetting password for
              </p>
              <p className="text-sm font-semibold text-center mb-7" style={{ color: '#0A0A0A' }}>
                {email}
              </p>

              {dobError && (
                <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  {dobError}
                </div>
              )}

              <form onSubmit={handleDobSubmit} className="space-y-4" noValidate>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5"
                    style={{ color: '#8B8B85' }}>
                    Date of birth
                  </label>
                  <input
                    type="date"
                    className={inp}
                    style={{ color: '#0A0A0A' }}
                    value={dob}
                    onChange={(e) => { setDob(e.target.value); setDobError(''); }}
                    max={new Date().toISOString().split('T')[0]}
                  />
                </div>
                <button type="submit" disabled={dobLoading || !dob}
                  className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity"
                  style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                  {dobLoading ? 'Verifying…' : 'Continue →'}
                </button>
              </form>

              <p className="text-center text-xs mt-5" style={{ color: '#8B8B85' }}>
                Wrong account?{' '}
                <Link to="/login" className="underline hover:opacity-70" style={{ color: '#8B8B85' }}>
                  Back to sign in
                </Link>
              </p>
            </>
          )}

          {/* ── Step 2: New password ── */}
          {step === 'password' && (
            <>
              <h1 className="text-2xl font-bold text-center mb-2"
                style={{ fontFamily: '"Fraunces", Georgia, serif', color: '#0A0A0A' }}>
                Set new password
              </h1>
              <p className="text-sm text-center mb-7" style={{ color: '#8B8B85' }}>
                {email}
              </p>

              {pwdError && (
                <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  {pwdError}
                </div>
              )}

              <form onSubmit={handlePasswordSubmit} className="space-y-4" noValidate>
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
                      className={`${inp} pr-11`}
                      style={{ color: '#0A0A0A' }}
                    />
                    <button type="button" tabIndex={-1}
                      onClick={() => setShowNew((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
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
                      className={`${inp} pr-11`}
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
                  disabled={!allRulesMet || newPwd !== confirmPwd || pwdLoading}
                  className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity mt-2"
                  style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                  {pwdLoading ? 'Saving…' : 'Set password'}
                </button>
              </form>
            </>
          )}

          {/* ── Step 3: Success ── */}
          {step === 'success' && (
            <div className="text-center space-y-5">
              <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center"
                style={{ backgroundColor: '#D1FAE5' }}>
                <CheckCircle2 size={28} style={{ color: '#065F46' }} />
              </div>
              <div>
                <h1 className="text-xl font-bold mb-2"
                  style={{ fontFamily: '"Fraunces", Georgia, serif', color: '#0A0A0A' }}>
                  Password updated ✓
                </h1>
                <p className="text-sm" style={{ color: '#8B8B85' }}>
                  Your password has been changed. Sign in with your new password.
                </p>
              </div>
              <Link to="/login"
                className="block w-full py-3 rounded-xl text-sm font-semibold text-center transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#0B1538', color: '#C9A961' }}>
                Sign in →
              </Link>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
