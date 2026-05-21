import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';

const DEPARTMENTS = [
  'BD & Client Relations', 'Management', 'Digital Marketing',
  'HR', 'Admin', 'Tech', 'Consultant', 'Housekeeping', 'Other',
];

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

export function RequestAccessPage() {
  const [fullName,       setFullName]       = useState('');
  const [personalEmail,  setPersonalEmail]  = useState('');
  const [mobileNumber,   setMobileNumber]   = useState('');
  const [department,     setDepartment]     = useState('');
  const [designation,    setDesignation]    = useState('');
  const [message,        setMessage]        = useState('');
  const [submitting,     setSubmitting]     = useState(false);
  const [error,          setError]          = useState('');
  const [submitted,      setSubmitted]      = useState(false);

  const emailValid   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail);
  const mobileValid  = /^[6-9]\d{9}$/.test(mobileNumber);
  const canSubmit    = fullName.trim() && emailValid && mobileValid &&
                       department && designation.trim() && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(''); setSubmitting(true);
    try {
      await addDoc(collection(db, 'access_requests'), {
        fullName:      fullName.trim(),
        personalEmail: personalEmail.trim().toLowerCase(),
        mobileNumber:  mobileNumber.trim(),
        department,
        designation:   designation.trim(),
        message:       message.trim(),
        status:        'pending',
        submittedAt:   serverTimestamp(),
        reviewedBy:    null,
        reviewedAt:    null,
        rejectionReason: null,
        createdUid:    null,
      });
      setSubmitted(true);
    } catch (err) {
      console.error('[RequestAccessPage] submit error:', err);
      setError('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inp = `w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none
    transition-colors focus:border-navy focus:ring-2 focus:ring-navy/10`;

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-navy py-10">
      <ConcentricRings />

      {/* Video logo — top-left */}
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

          {submitted ? (
            /* ── Success screen ── */
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
                style={{ backgroundColor: '#D1FAE5' }}>
                <span className="text-2xl">✓</span>
              </div>
              <h2 className="text-2xl font-bold mb-3"
                style={{ fontFamily: '"Fraunces", Georgia, serif', color: '#0A0A0A' }}>
                Request submitted
              </h2>
              <p className="text-sm leading-relaxed" style={{ color: '#8B8B85' }}>
                Your access request has been sent to the Finvastra admin team.
                Once your account is created you will receive login credentials
                on your official <strong>@finvastra.com</strong> email.
              </p>
            </div>
          ) : (
            /* ── Request form ── */
            <>
              <h1 className="text-2xl font-bold text-center mb-1"
                style={{ fontFamily: '"Fraunces", Georgia, serif', color: '#0A0A0A' }}>
                Request access
              </h1>
              <p className="text-sm text-center mb-7" style={{ color: '#8B8B85' }}>
                Fill in your details and the admin team will create your account.
              </p>

              {error && (
                <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                {/* Full Name */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5"
                    style={{ color: '#8B8B85' }}>Full Name *</label>
                  <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                    placeholder="As per Aadhaar / PAN" className={inp} style={{ color: '#0A0A0A' }} />
                </div>

                {/* Personal Email */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5"
                    style={{ color: '#8B8B85' }}>Personal Email *</label>
                  <input type="email" value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)}
                    placeholder="For contact only — not used for login"
                    className={inp} style={{ color: '#0A0A0A' }} />
                  {personalEmail.length > 0 && !emailValid && (
                    <p className="mt-1 text-xs text-red-500">Enter a valid email address</p>
                  )}
                </div>

                {/* Mobile */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5"
                    style={{ color: '#8B8B85' }}>Mobile Number *</label>
                  <input type="tel" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)}
                    placeholder="10-digit Indian mobile" maxLength={10}
                    className={inp} style={{ color: '#0A0A0A' }} />
                  {mobileNumber.length > 0 && !mobileValid && (
                    <p className="mt-1 text-xs text-red-500">Enter a valid 10-digit Indian mobile number</p>
                  )}
                </div>

                {/* Department */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5"
                    style={{ color: '#8B8B85' }}>Department *</label>
                  <select value={department} onChange={(e) => setDepartment(e.target.value)}
                    className={inp} style={{ color: department ? '#0A0A0A' : '#8B8B85' }}>
                    <option value="">Select department…</option>
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                {/* Designation */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5"
                    style={{ color: '#8B8B85' }}>Designation *</label>
                  <input type="text" value={designation} onChange={(e) => setDesignation(e.target.value)}
                    placeholder="Your job title" className={inp} style={{ color: '#0A0A0A' }} />
                </div>

                {/* Message */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5"
                    style={{ color: '#8B8B85' }}>Message to Admin
                    <span className="ml-1 font-normal normal-case tracking-normal">
                      (optional, {200 - message.length} chars left)
                    </span>
                  </label>
                  <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 200))}
                    rows={3} placeholder="Any additional context for your access request…"
                    className={`${inp} resize-none`} style={{ color: '#0A0A0A' }} />
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 mt-2"
                  style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
                >
                  {submitting ? 'Submitting…' : 'Submit request'}
                </button>
              </form>

              <p className="text-center text-xs mt-5" style={{ color: '#8B8B85' }}>
                Already have an account?{' '}
                <Link to="/login" className="font-semibold hover:underline" style={{ color: '#0B1538' }}>
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
