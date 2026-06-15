/**
 * UserMenu — avatar + name trigger that opens a dropdown.
 * Used in all three module shells (HRMS, CRM, MIS).
 *
 * Replaces the flat avatar + name + sign-out button in the top header.
 * The dropdown contains contextual quick links, a module switcher, and sign out.
 */

import { useState, useRef, useEffect, type ElementType } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Download, type LucideProps } from 'lucide-react';
import { canInstall, subscribeInstall } from '../../lib/pwaInstall';

export interface UserMenuLink {
  label:    string;
  path:     string;
  Icon:     ElementType<LucideProps>;
  external?: boolean;   // navigate outside current module (full path)
}

interface UserMenuProps {
  displayName:  string;
  photoURL?:    string | null;
  initials:     string;
  roleLabel:    string;    // "★ Super Admin", "admin", "employee", etc.
  isSA?:        boolean;   // gold label colour
  links:        UserMenuLink[];
  onLogout:     () => void;
}

export function UserMenu({
  displayName, photoURL, initials, roleLabel, isSA = false, links, onLogout,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref   = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Show "Install app" only when the browser can install (or iOS) and not already installed.
  const [installable, setInstallable] = useState(canInstall());
  useEffect(() => subscribeInstall(() => setInstallable(canInstall())), []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const avatar = photoURL ? (
    <img src={photoURL} alt={displayName} className="w-8 h-8 rounded-full object-cover shrink-0" />
  ) : (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
      style={{ backgroundColor: 'rgba(201,169,97,0.15)', color: '#C9A961' }}>
      {initials}
    </div>
  );

  return (
    <div ref={ref} className="relative shrink-0">
      {/* ── Trigger ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-xl transition-colors hover:bg-(--shell-hover-hard)"
        aria-haspopup="true"
        aria-expanded={open}
      >
        {avatar}
        <span className="text-sm font-medium hidden sm:block max-w-[120px] truncate"
          style={{ color: 'var(--text-primary)' }}>
          {displayName}
        </span>
        <ChevronDown
          size={13}
          style={{
            color: 'var(--shell-text-dim)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.18s ease',
          }}
          className="shrink-0 hidden sm:block"
        />
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-56 z-50 rounded-2xl overflow-hidden glass-panel"
          // Solid surface — the translucent panel let page text bleed through,
          // making the menu unreadable over busy content.
          style={{ minWidth: 220, backgroundColor: 'var(--ss-bg)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}
        >
          {/* User identity header */}
          <div className="px-4 py-3.5" style={{ borderBottom: '1px solid var(--shell-border)' }}>
            <div className="flex items-center gap-3">
              {avatar}
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {displayName}
                </p>
                <p className="text-[10px] uppercase tracking-widest truncate"
                  style={{ color: isSA ? '#C9A961' : 'var(--shell-text-dim)' }}>
                  {roleLabel}
                </p>
              </div>
            </div>
          </div>

          {/* Quick links */}
          <div className="py-1.5">
            {links.map(({ label, path, Icon }) => (
              <button
                key={path}
                onClick={() => { navigate(path); setOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors nav-item-hover text-left"
                style={{ color: 'var(--shell-text-secondary)' }}
              >
                <Icon size={15} className="shrink-0" />
                {label}
              </button>
            ))}
          </div>

          {/* Install app (PWA) — only when installable */}
          {installable && (
            <div style={{ borderTop: '1px solid var(--shell-border)' }} className="py-1.5">
              <button
                onClick={() => { window.dispatchEvent(new Event('fv:install')); setOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors nav-item-hover text-left"
                style={{ color: '#C9A961' }}
              >
                <Download size={15} className="shrink-0" />
                Install app
              </button>
            </div>
          )}

          {/* Sign out */}
          <div style={{ borderTop: '1px solid var(--shell-border)' }} className="py-1.5">
            <button
              onClick={() => { onLogout(); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-opacity hover:opacity-70 text-left"
              style={{ color: '#f87171' }}
            >
              <LogOut size={15} className="shrink-0" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
