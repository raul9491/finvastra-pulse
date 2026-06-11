import type { MouseEvent } from 'react';

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
  const dim = size === 'sm' ? 'w-8 h-8 text-sm' : 'w-10 h-10 text-base';
  const btn = `${dim} inline-flex items-center justify-center rounded-lg border no-underline transition-colors hover:bg-(--shell-hover-soft)`;
  const style = { borderColor: 'var(--shell-border-mid)' } as const;

  return (
    <span className="inline-flex items-center gap-1.5" onClick={stop}>
      {phone && (
        <a href={telHref(phone)} className={btn} style={style} title="Call" aria-label="Call">
          📞
        </a>
      )}
      {phone && (
        <a href={waHref(phone, name)} target="_blank" rel="noreferrer" className={btn} style={style} title="WhatsApp" aria-label="WhatsApp">
          💬
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className={btn} style={style} title="Email" aria-label="Email">
          ✉️
        </a>
      )}
    </span>
  );
}
