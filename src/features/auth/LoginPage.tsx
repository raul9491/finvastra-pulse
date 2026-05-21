import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword, type AuthError } from 'firebase/auth';
import { auth, signInWithGoogle } from '../../lib/firebase';
import { useAuth, SESSION_EXPIRED_KEY } from './AuthContext';
import { VastraLogo } from '../../components/ui/VastraLogo';


function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

// ─── Decorative: faint concentric gold circles ────────────────────────────────
function ConcentricRings() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none select-none"
      aria-hidden
      preserveAspectRatio="xMidYMid slice"
    >
      {[120, 240, 360, 480, 600, 720, 840, 960].map((r) => (
        <circle key={r} cx="50%" cy="50%" r={r} fill="none"
          stroke="rgba(201,169,97,0.04)" strokeWidth="1" />
      ))}
    </svg>
  );
}

// ─── Decorative: gold diamond watermark (top-right) ──────────────────────────
function DiamondWatermark() {
  return (
    <div className="absolute top-8 right-8 w-44 opacity-[0.12] pointer-events-none select-none" aria-hidden>
      <svg viewBox="0 0 120 120" className="w-full h-full">
        <g transform="translate(60,60) scale(1.1)">
          {(['rotate(45 0 -23)', 'rotate(45 0 23)', 'rotate(45 -23 0)', 'rotate(45 23 0)'] as const).map((t, i) => (
            <rect key={i}
              x={['-15','-15','-38','8'][i]} y={['-38','8','-15','-15'][i]}
              width="30" height="30" rx="6"
              fill="none" stroke="#C9A961" strokeWidth="7"
              transform={t}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

const AUTH_ERRORS: Record<string, string> = {
  'auth/invalid-credential':     'Invalid email or password.',
  'auth/user-not-found':         'No account found with this email.',
  'auth/wrong-password':         'Incorrect password.',
  'auth/too-many-requests':      'Too many failed attempts. Try again later.',
  'auth/user-disabled':          'This account is disabled. Contact your admin.',
  'auth/network-request-failed': 'Network error. Check your connection.',
};

export function LoginPage() {
  const { user, loading, authError: domainError } = useAuth();
  const navigate = useNavigate();
  const [email,         setEmail]         = useState('');
  const [password,      setPassword]      = useState('');
  const [emailTouched,  setEmailTouched]  = useState(false);
  const [localError,    setLocalError]    = useState('');
  const [submitting,    setSubmitting]    = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_EXPIRED_KEY)) {
      sessionStorage.removeItem(SESSION_EXPIRED_KEY);
      setSessionExpired(true);
    }
  }, []);

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [user, loading, navigate]);

  if (loading) return null;
  if (user)    return null;

  const emailValid = email.endsWith('@finvastra.com');
  const showDomainWarning = emailTouched && email.length > 0 && !emailValid;
  const displayError = domainError || localError;

  const handleEmailPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailValid) return;
    setLocalError(''); setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      const code = (err as AuthError).code ?? '';
      setLocalError(AUTH_ERRORS[code] ?? 'Sign in failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setLocalError(''); setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      const code = (err as AuthError).code ?? '';
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        setLocalError('Google sign-in failed. Use your @finvastra.com account.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const inp = `w-full px-4 py-3 bg-slate-50 border rounded-xl text-sm outline-none
    transition-colors focus:border-navy focus:ring-2 focus:ring-navy/10`;

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-navy">
      <ConcentricRings />
      <DiamondWatermark />

      <div className="relative z-10 w-full mx-4 max-w-md">
        <div className="bg-white rounded-3xl p-10 shadow-[0_24px_64px_rgba(0,0,0,0.3)]">

          <div className="flex justify-center mb-8">
            <VastraLogo size="lg" />
          </div>

          {sessionExpired && (
            <div className="mb-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
              Session expired. Please sign in again.
            </div>
          )}

          <h1 className="text-2xl font-bold text-ink text-center mb-1"
            style={{ fontFamily: '"Fraunces", Georgia, serif' }}>
            Welcome back
          </h1>
          <p className="text-sm text-center mb-7" style={{ color: '#8B8B85' }}>
            Sign in with your <strong>@finvastra.com</strong> account
          </p>

          {displayError && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
              {displayError}
            </div>
          )}

          <form onSubmit={handleEmailPassword} className="space-y-4" noValidate>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
                Email address
              </label>
              <input
                type="email"
                autoComplete="email"
                placeholder="name@finvastra.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                className={`${inp} ${showDomainWarning ? 'border-amber-400' : 'border-slate-200'}`}
                style={{ color: '#0A0A0A' }}
              />
              {showDomainWarning && (
                <p className="mt-1 text-xs text-amber-600">
                  ⚠ Use your @finvastra.com company email, not your personal Gmail
                </p>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inp} border-slate-200`}
                style={{ color: '#0A0A0A' }}
              />
            </div>

            <button
              type="submit"
              disabled={!emailValid || submitting || googleLoading}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs uppercase tracking-widest" style={{ color: '#8B8B85' }}>or</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          <button
            onClick={handleGoogle}
            disabled={googleLoading || submitting}
            className="w-full flex items-center justify-center gap-3 px-4 py-3
              bg-white border border-slate-200 rounded-xl text-sm font-medium
              hover:bg-slate-50 transition-colors disabled:opacity-60"
            style={{ color: '#0A0A0A' }}
          >
            <GoogleIcon />
            {googleLoading ? 'Signing in…' : 'Continue with Google Workspace'}
          </button>

          <p className="text-center text-xs mt-6" style={{ color: '#8B8B85' }}>
            Access restricted to Finvastra team members only.<br />
            © 2026 Finvastra Financial Services Pvt. Ltd.
          </p>
        </div>
      </div>
    </div>
  );
}
