import type { ReactNode } from 'react';

export interface LearnItem {
  q: string;                 // question / "how do I…"
  a: ReactNode;              // answer (string filters in search; JSX also allowed)
  link?: string;             // optional route to the tool
  linkLabel?: string;
}

export interface LearnSection {
  id: string;
  icon: ReactNode;
  title: string;
  color: string;             // accent (theme var or hex)
  items: LearnItem[];
  /** Optional gate — hide admin-only sections from users who can't use them. */
  show?: (ctx: LearnGateCtx) => boolean;
}

export interface LearnGateCtx {
  isAdmin: boolean;
  isManager: boolean;
  isHrmsManager: boolean;
}

export interface QuickLinkDef { label: string; href: string; color: string; }
