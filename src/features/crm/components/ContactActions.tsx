import type { MouseEvent } from 'react';
import { Phone, Mail } from 'lucide-react';

/** WhatsApp brand glyph (lucide has no brand icons; the old 💬 emoji looked
    like a generic SMS bubble and misled users). */
function WhatsAppIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

// ─── Contact actions — telecaller field ops ───────────────────────────────────
// Anywhere a customer's number shows, these give one-tap Call (default dialer
// via tel:), WhatsApp (wa.me deep link → app on mobile, web on desktop) and
// Email (mailto:). Plain anchors, no JS dialing — the OS handles the rest.

function normalizePhone(phone: string): string {
  // Strip spaces/dashes/+91 → bare 10-digit Indian mobile for wa.me;
  // tel: tolerates either but keep it consistent.
  const digits = phone.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function telHref(phone: string): string {
  return `tel:+91${normalizePhone(phone)}`;
}

export function waHref(phone: string, name?: string): string {
  const greeting = name ? `Hello ${name.split(' ')[0]}, ` : '';
  return `https://wa.me/91${normalizePhone(phone)}?text=${encodeURIComponent(greeting)}`;
}

const stop = (e: MouseEvent) => e.stopPropagation();

/**
 * Clickable phone number — tapping it opens the device's default dialer.
 * Use wherever a customer number is displayed (tables, queue rows, cards).
 */
export function PhoneLink({ phone, className, mono = true }: { phone: string; className?: string; mono?: boolean }) {
  if (!phone) return null;
  return (
    <a
      href={telHref(phone)}
      onClick={stop}
      className={`no-underline hover:underline ${mono ? 'font-mono' : ''} ${className ?? ''}`}
      style={{ color: 'var(--text-primary)' }}
      title="Call from your phone"
    >
      {phone}
    </a>
  );
}

/**
 * Compact icon-button row: Call · WhatsApp · Email (email only when present).
 * 40px tap targets for mobile thumbs; stopPropagation so it works inside
 * clickable rows/cards without triggering navigation.
 */
export function ContactActions({
  phone,
  email,
  name,
  size = 'md',
}: {
  phone: string;
  email?: string | null;
  name?: string;
  size?: 'sm' | 'md';
}) {
  if (!phone && !email) return null;
  const dim = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  const icon = size === 'sm' ? 15 : 18;
  const btn = `${dim} inline-flex items-center justify-center rounded-lg border no-underline transition-colors hover:bg-(--shell-hover-soft)`;

  return (
    <span className="inline-flex items-center gap-1.5" onClick={stop}>
      {phone && (
        <a href={telHref(phone)} className={btn} title="Call" aria-label="Call"
          style={{ borderColor: 'rgba(201,169,97,0.4)', color: '#C9A961' }}>
          <Phone size={icon} />
        </a>
      )}
      {phone && (
        <a href={waHref(phone, name)} target="_blank" rel="noreferrer" className={btn} title="WhatsApp" aria-label="WhatsApp"
          style={{ borderColor: 'rgba(37,211,102,0.4)', color: '#25D366' }}>
          <WhatsAppIcon size={icon} />
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className={btn} title="Email" aria-label="Email"
          style={{ borderColor: 'var(--shell-border-mid)', color: 'var(--text-muted)' }}>
          <Mail size={icon} />
        </a>
      )}
    </span>
  );
}
