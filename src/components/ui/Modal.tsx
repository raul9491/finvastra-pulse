import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({ isOpen, onClose, title, children, size = 'md', footer }: ModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1000] glass-modal-overlay"
            onClick={onClose}
          />
          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 20 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={`fixed z-[1001] inset-x-4 top-1/2 -translate-y-1/2 mx-auto w-full ${sizeClasses[size]} glass-modal-panel flex flex-col overflow-hidden`}
            style={{ maxHeight: '90vh' }}
          >
            {/* Header */}
            <div className="glass-modal-header flex items-center justify-between px-8 py-6 shrink-0">
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors hover:bg-white/10"
                style={{ color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
              {children}
            </div>

            {/* Footer */}
            {footer && (
              <div className="px-8 py-5 flex justify-end gap-3 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                {footer}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
