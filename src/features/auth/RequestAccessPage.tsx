import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { VideoLogo } from '../../components/ui/VideoLogo';
import { MercuryBackground } from '../../components/ui/MercuryBackground';

const DEPARTMENTS = [
  'BD & Client Relations', 'Management', 'Digital Marketing',
  'HR', 'Admin', 'Tech', 'Consultant', 'Housekeeping', 'Other',
];


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

  const emailValid  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail);
  const mobileValid = /^[6-9]\d{9}$/.test(mobileNumber);
  const canSubmit   = fullName.trim() && emailValid && mobileValid &&
                      department && designation.trim() && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(''); setSubmitting(true);
    try {
      await addDoc(collection(db, 'access_requests'), {
        fullName:        fullName.trim(),
        personalEmail:   personalEmail.trim().toLowerCase(),
        mobileNumber:    mobileNumber.trim(),
        department,
        designation:     designation.trim(),
        message:         message.trim(),
        status:          'pending',
        submittedAt:     serverTimestamp(),
        reviewedBy:      null,
        reviewedAt:      null,
        rejectionReason: null,
        createdUid:      null,
      });
      setSubmitted(true);
    } catch (err) {
      console.error('[RequestAccessPage] submit error:', err);
      setError('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inp = [
    'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none',
    'transition-all duration-200',
    'focus:border-[#C9A961] focus:ring-2 focus:ring-[#C9A961]/10',
  ].join(' ');

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'transparent', paddingTop: 40, paddingBottom: 40 }}>

      {/* ── WebGL Mercury background ── */}
      <MercuryBackground />

      {/* ── Video logo — top-left ── */}
      <div style={{ position: 'absolute', top: 24, left: 24, zIndex: 2 }}>
        <VideoLogo size="sm" showText={true} />
      </div>

      {/* ── Card ── */}
      <div style={{ position: 'relative', zIndex: 2, width: '100%', maxWidth: 440, margin: '0 16px' }}>
        <div style={{
          background:     'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(8px)',
          borderRadius:   28,
          padding:        40,
          boxShadow:      '0 32px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08)',
          animation:      'fadeUp 0.6s ease 0.1s both',
        }}>

          {submitted ? (
            /* ── Success screen ── */
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                backgroundColor: '#D1FAE5',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 20px',
                fontSize: 24,
              }}>✓</div>
              <h2 style={{ fontFamily: '"Fraunces", Georgia, serif', fontSize: 24, fontWeight: 700, color: '#0A0A0A', marginBottom: 12 }}>
                Request submitted
              </h2>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: '#8B8B85' }}>
                Your access request has been sent to the Finvastra admin team.
                Once your account is created you will receive login credentials
                on your official <strong>@finvastra.com</strong> email.
              </p>
            </div>
          ) : (
            /* ── Request form ── */
            <>
              <h1 style={{ fontFamily: '"Fraunces", Georgia, serif', fontSize: 24, fontWeight: 700, color: '#0A0A0A', textAlign: 'center', marginBottom: 4 }}>
                Request access
              </h1>
              <p style={{ fontSize: 14, textAlign: 'center', color: '#8B8B85', marginBottom: 28 }}>
                Fill in your details and the admin team will create your account.
              </p>

              {error && (
                <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Full Name *</label>
                  <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                    placeholder="As per Aadhaar / PAN" className={inp} style={{ color: '#0A0A0A' }} />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Personal Email *</label>
                  <input type="email" value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)}
                    placeholder="For contact only — not used for login"
                    className={inp} style={{ color: '#0A0A0A' }} />
                  {personalEmail.length > 0 && !emailValid && (
                    <p className="mt-1 text-xs text-red-500">Enter a valid email address</p>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Mobile Number *</label>
                  <input type="tel" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)}
                    placeholder="10-digit Indian mobile" maxLength={10}
                    className={inp} style={{ color: '#0A0A0A' }} />
                  {mobileNumber.length > 0 && !mobileValid && (
                    <p className="mt-1 text-xs text-red-500">Enter a valid 10-digit Indian mobile number</p>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Department *</label>
                  <select value={department} onChange={(e) => setDepartment(e.target.value)}
                    className={inp} style={{ color: department ? '#0A0A0A' : '#8B8B85' }}>
                    <option value="">Select department…</option>
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>Designation *</label>
                  <input type="text" value={designation} onChange={(e) => setDesignation(e.target.value)}
                    placeholder="Your job title" className={inp} style={{ color: '#0A0A0A' }} />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#8B8B85' }}>
                    Message to Admin
                    <span className="ml-1 font-normal normal-case tracking-normal" style={{ color: '#8B8B85' }}>
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
                  style={{
                    width:        '100%',
                    padding:      '12px',
                    borderRadius: 12,
                    fontSize:     14,
                    fontWeight:   600,
                    color:        '#C9A961',
                    background:   'linear-gradient(135deg, #0B1538, #1B2A4E)',
                    border:       'none',
                    cursor:       !canSubmit ? 'not-allowed' : 'pointer',
                    opacity:      !canSubmit ? 0.5 : 1,
                    transition:   'all 0.2s ease',
                    marginTop:    8,
                  }}
                >
                  {submitting ? 'Submitting…' : 'Submit request'}
                </button>
              </form>

              <p style={{ textAlign: 'center', fontSize: 13, marginTop: 20, color: '#8B8B85' }}>
                Already have an account?{' '}
                <Link to="/login" style={{ color: '#C9A961', fontWeight: 600, textDecoration: 'none' }}>
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
