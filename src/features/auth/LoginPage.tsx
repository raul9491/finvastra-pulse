import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signInWithEmailAndPassword, type AuthError } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { useAuth, SESSION_EXPIRED_KEY } from './AuthContext';
import { VideoLogo } from '../../components/ui/VideoLogo';
import { MercuryBackground } from '../../components/ui/MercuryBackground';

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

  const [email,          setEmail]          = useState('');
  const [password,       setPassword]       = useState('');
  const [emailTouched,   setEmailTouched]   = useState(false);
  const [localError,     setLocalError]     = useState('');
  const [submitting,     setSubmitting]     = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [btnHover,       setBtnHover]       = useState(false);

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

  const emailValid        = email.endsWith('@finvastra.com');
  const showDomainWarning = emailTouched && email.length > 0 && !emailValid;
  const displayError      = domainError || localError;

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

  const inp = [
    'w-full px-4 py-3 bg-slate-50 border rounded-xl text-sm outline-none',
    'transition-all duration-200',
    'focus:border-[#C9A961] focus:ring-2 focus:ring-[#C9A961]/10',
  ].join(' ');

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'transparent' }}>

      {/* ── WebGL Mercury background ── */}
      <MercuryBackground />

      {/* ── Rotating gold diamond (top-right decoration) ── */}
      <div style={{
        position:      'absolute',
        top:           32, right: 32,
        width:         200, height: 200,
        opacity:       0.15,
        zIndex:        1,
        animation:     'rotateSlow 30s linear infinite',
        pointerEvents: 'none',
      }}>
        <svg viewBox="0 0 120 120" width="200" height="200">
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

      {/* ── Video logo — top-left ── */}
      <div style={{ position: 'absolute', top: 24, left: 24, zIndex: 2 }}>
        <VideoLogo size="sm" showText={true} />
      </div>

      {/* ── Login card ── */}
      <div style={{ position: 'relative', zIndex: 2, width: '100%', maxWidth: 440, margin: '0 16px' }}>
        <div style={{
          background:      'rgba(255,255,255,0.97)',
          backdropFilter:  'blur(8px)',
          borderRadius:    28,
          padding:         40,
          boxShadow:       '0 32px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08)',
          animation:       'fadeUp 0.6s ease 0.1s both',
        }}>

          {/* Logo inside card */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
            <VideoLogo size="md" showText={false} />
          </div>

          {sessionExpired && (
            <div className="mb-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
              Session expired. Please sign in again.
            </div>
          )}

          <h1 style={{
            fontFamily:  '"Fraunces", Georgia, serif',
            fontSize:     24,
            fontWeight:   700,
            color:        '#0A0A0A',
            textAlign:    'center',
            marginBottom: 4,
          }}>
            Welcome back
          </h1>
          <p style={{ fontSize: 14, textAlign: 'center', color: '#8B8B85', marginBottom: 28 }}>
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
              onMouseEnter={() => setBtnHover(true)}
              onMouseLeave={() => setBtnHover(false)}
              style={{
                width:        '100%',
                padding:      '12px',
                borderRadius: 12,
                fontSize:     14,
                fontWeight:   600,
                color:        '#C9A961',
                background:   'linear-gradient(135deg, #0B1538, #1B2A4E)',
                boxShadow:    btnHover && !submitting ? '0 8px 24px rgba(11,21,56,0.4)' : 'none',
                filter:       btnHover && !submitting ? 'brightness(1.15)' : 'none',
                transition:   'all 0.2s ease',
                border:       'none',
                cursor:       (!emailValid || submitting) ? 'not-allowed' : 'pointer',
                opacity:      (!emailValid || submitting) ? 0.5 : 1,
              }}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 13, marginTop: 20, color: '#8B8B85' }}>
            Don't have an account?{' '}
            <Link
              to="/request-access"
              style={{ color: '#C9A961', fontWeight: 600, textDecoration: 'none' }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
            >
              Request access
            </Link>
          </p>

          <p style={{ textAlign: 'center', fontSize: 11, marginTop: 16, color: '#8B8B85' }}>
            Access restricted to Finvastra team members only.<br />
            © 2026 Finvastra Financial Services Pvt. Ltd.
          </p>
        </div>
      </div>
    </div>
  );
}
