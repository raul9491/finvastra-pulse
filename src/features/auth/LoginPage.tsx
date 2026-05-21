import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signInWithEmailAndPassword, type AuthError } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { useAuth, SESSION_EXPIRED_KEY } from './AuthContext';
import { VastraLogo } from '../../components/ui/VastraLogo';

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

  const handleSubmit = async (e: React.FormEvent) => {
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

  const inp = `w-full px-4 py-3 bg-slate-50 border rounded-xl text-sm outline-none
    transition-colors focus:border-navy focus:ring-2 focus:ring-navy/10`;

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-navy">
      <ConcentricRings />
      <DiamondWatermark />

      {/* ── Video logo — top-left corner ── */}
      <div className="absolute top-6 left-6 z-20 flex flex-col items-start gap-1.5">
        <video autoPlay loop muted playsInline style={{ width: 140 }}>
          <source src="/video/logo-transparent.webm" type="video/webm" />
        </video>
        <span style={{
          fontFamily: '"Fraunces", Georgia, serif',
          fontWeight: 700, fontSize: 13,
          letterSpacing: '0.05em', color: '#FFFFFF',
        }}>
          Finvastra Pulse
        </span>
      </div>

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

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
                  ⚠ Use your @finvastra.com company email
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
              disabled={!emailValid || submitting}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
              style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-xs mt-5" style={{ color: '#8B8B85' }}>
            Don't have an account?{' '}
            <Link to="/request-access" className="font-semibold hover:underline" style={{ color: '#0B1538' }}>
              Request access
            </Link>
          </p>

          <p className="text-center text-xs mt-4" style={{ color: '#8B8B85' }}>
            Access restricted to Finvastra team members only.<br />
            © 2026 Finvastra Financial Services Pvt. Ltd.
          </p>
        </div>
      </div>
    </div>
  );
}
