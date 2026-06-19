import React, { createContext, useContext, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, XCircle, AlertCircle, Info, X } from 'lucide-react';
import type { Toast, ToastType } from '../../types';

// ─── Context ───────────────────────────────────────────────────────────────

interface ToastContextValue {
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

// ─── Visual Config ──────────────────────────────────────────────────────────

const CONFIG: Record<ToastType, { icon: React.ReactNode; bg: string; border: string; title: string }> = {
  success: {
    icon: <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />,
    bg: 'bg-(--ss-bg)',
    border: 'border-l-4 border-emerald-500',
    title: 'text-emerald-600',
  },
  error: {
    icon: <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />,
    bg: 'bg-(--ss-bg)',
    border: 'border-l-4 border-red-500',
    title: 'text-red-600',
  },
  info: {
    icon: <Info className="w-5 h-5 text-blue-500 flex-shrink-0" />,
    bg: 'bg-(--ss-bg)',
    border: 'border-l-4 border-blue-500',
    title: 'text-blue-600',
  },
  warning: {
    icon: <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />,
    bg: 'bg-(--ss-bg)',
    border: 'border-l-4 border-amber-500',
    title: 'text-amber-600',
  },
};

// ─── Individual Toast ───────────────────────────────────────────────────────

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const cfg = CONFIG[toast.type];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`flex items-start gap-3 w-80 p-4 rounded-2xl shadow-xl ${cfg.bg} ${cfg.border} border border-(--shell-border)`}
    >
      {cfg.icon}
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p className={`text-xs font-bold uppercase tracking-widest mb-0.5 ${cfg.title}`}>
            {toast.title}
          </p>
        )}
        <p className="text-sm font-medium text-(--text-primary) leading-snug">{toast.message}</p>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="p-1 text-(--text-muted) hover:text-(--text-muted) transition-colors flex-shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

// ─── Provider ───────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string, title?: string, duration = 4000) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev.slice(-4), { id, type, message, title, duration }]);
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  const ctx: ToastContextValue = {
    success: (msg, title) => addToast('success', msg, title),
    error: (msg, title) => addToast('error', msg, title, 6000),
    info: (msg, title) => addToast('info', msg, title),
    warning: (msg, title) => addToast('warning', msg, title),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {/* Portal-like fixed container */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto">
              <ToastItem toast={t} onDismiss={dismiss} />
            </div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
