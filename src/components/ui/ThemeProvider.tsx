import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Sun, Moon } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggle: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem('fv-theme');
      return stored === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  // Apply / remove the `light-mode` class on <body> whenever theme changes.
  // All CSS overrides in glass.css are gated on `body.light-mode`.
  useEffect(() => {
    document.body.classList.toggle('light-mode', theme === 'light');

    // Keep the mobile browser chrome (address bar / status bar) in sync with
    // the app theme — without this, dark mode shows a white bar on phones.
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = theme === 'light' ? '#FAFAF7' : '#050d1f';

    try {
      localStorage.setItem('fv-theme', theme);
    } catch {
      /* storage unavailable — fine, just don't persist */
    }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

// ─── Toggle button (placed in shell headers) ──────────────────────────────────

export function ThemeToggle() {
  const { theme, toggle } = useTheme();

  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggle}
      className="btn-glass-icon"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark
        ? <Sun  size={15} style={{ color: 'var(--text-muted)' }} />
        : <Moon size={15} style={{ color: 'rgba(10,10,10,0.60)' }} />
      }
    </button>
  );
}
