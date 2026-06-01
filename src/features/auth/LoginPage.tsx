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
  const [resetState,     setResetState]     = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resetError,     setResetError]     = useState('');

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

  const handleForgotPassword = async () => {
    if (!emailValid) {
      setResetError('Enter your @finvastra.com email above first.');
      return;
    }
    setResetState('sending');
    setResetError('');
    try {
      // Server generates the branded Gmail email via Google Workspace (DWD).
      // Always returns { ok: true } even if the email doesn't exist — prevents enumeration.
      await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      });
      setResetState('sent');
    } catch {
      setResetState('error');
      setResetError('Could not send reset email. Try again or contact your admin.');
    }
  };

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

  // inp kept for legacy reference; replaced by glass-inp class in the form
  const inp = [
    'w-full px-4 py-3 bg-slate-50 border rounded-xl text-sm outline-none',
    'transition-all duration-200',
    'focus:border-[#C9A961] focus:ring-2 focus:ring-[#C9A961]/10',
  ].join(' ');

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'transparent' }}>

      {/* ── WebGL Mercury background ── */}
      <MercuryBackground />

      {/* ── Finvastra logo — top-right ── */}
      <div style={{
        position:      'absolute',
        top:           24, right: 32,
        zIndex:        1,
        pointerEvents: 'none',
      }}>
        <img
          src="/images/logo-finvastra.png"
          alt="Finvastra"
          style={{ width: 180, opacity: 0.75, mixBlendMode: 'screen' }}
        />
      </div>

      {/* ── Video logo — top-left ── */}
      <div style={{ position: 'absolute', top: 24, left: 24, zIndex: 2 }}>
        <VideoLogo size="sm" showText={true} />
      </div>

      {/* ── Login card ── */}
      <div style={{ position: 'relative', zIndex: 2, width: '100%', maxWidth: 440, margin: '0 16px' }}>
        <div className="glass-login-card" style={{
          padding:   40,
          boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
          animation: 'fadeUp 0.6s ease 0.1s both',
        }}>

          {/* Logo inside card */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
            <img src="/favicon.png" alt="Finvastra" style={{ width: 88, height: 88, objectFit: 'contain' }} />
          </div>

          {sessionExpired && (
            <div className="mb-5 px-4 py-3 rounded-xl text-sm" style={{ backgroundColor: 'rgba(201,169,97,0.12)', border: '1px solid rgba(201,169,97,0.25)', color: '#C9A961' }}>
              Session expired. Please sign in again.
            </div>
          )}

          <h1 style={{
            fontFamily:  '"Fraunces", Georgia, serif',
            fontSize:     24,
            fontWeight:   700,
            color:        'var(--text-primary)',
            textAlign:    'center',
            marginBottom: 4,
          }}>
            Welcome back
          </h1>
          <p style={{ fontSize: 14, textAlign: 'center', color: 'var(--text-muted)', marginBottom: 28 }}>
            Sign in with your <strong style={{ color: '#C9A961' }}>@finvastra.com</strong> account
          </p>

          {displayError && (
            <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ backgroundColor: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171' }}>
              {displayError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Email address
              </label>
              <input
                type="email"
                autoComplete="email"
                placeholder="name@finvastra.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                className="glass-inp w-full text-sm"
                style={{
                  borderColor: showDomainWarning ? 'rgba(201,169,97,0.50)' : undefined,
                }}
              />
              {showDomainWarning && (
                <p className="mt-1 text-xs" style={{ color: '#C9A961' }}>
                  ⚠ Use your @finvastra.com company email
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                  Password
                </label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={resetState === 'sending' || resetState === 'sent'}
                  className="text-[11px] font-medium transition-opacity hover:opacity-70 disabled:opacity-40"
                  style={{ color: '#C9A961' }}
                >
                  {resetState === 'sending' ? 'Sending…' : resetState === 'sent' ? 'Email sent ✓' : 'Forgot password?'}
                </button>
              </div>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="glass-inp w-full text-sm"
              />
              {resetState === 'sent' && (
                <p className="mt-1.5 text-xs rounded-lg px-3 py-2" style={{ backgroundColor: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.20)', color: '#34d399' }}>
                  Password reset link sent to <strong>{email}</strong>. Check your inbox.
                </p>
              )}
              {(resetError || resetState === 'error') && (
                <p className="mt-1.5 text-xs" style={{ color: '#f87171' }}>{resetError}</p>
              )}
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
                fontWeight:   700,
                color:        '#0B1538',
                background:   'linear-gradient(135deg, rgba(201,169,97,0.90), rgba(154,126,63,0.90))',
                border:       '1px solid rgba(201,169,97,0.40)',
                boxShadow:    btnHover && !submitting ? '0 8px 28px rgba(201,169,97,0.35)' : '0 4px 20px rgba(201,169,97,0.20)',
                transition:   'all 0.2s ease',
                cursor:       (!emailValid || submitting) ? 'not-allowed' : 'pointer',
                opacity:      (!emailValid || submitting) ? 0.5 : 1,
              }}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 13, marginTop: 20, color: 'var(--text-muted)' }}>
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

          <p style={{ textAlign: 'center', fontSize: 11, marginTop: 16, color: 'var(--text-dim)' }}>
            Access restricted to Finvastra team members only.<br />
            © 2026 Finvastra Advisors Private Limited
          </p>
        </div>
      </div>
    </div>
  );
}
