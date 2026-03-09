import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { CheckCircle, Trash2, Download, Plus, AlertCircle, X, Info } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

type SnackbarVariant = 'success' | 'error' | 'info' | 'warning';

interface SnackbarItem {
  id: string;
  message: string;
  variant: SnackbarVariant;
  icon?: React.ReactNode;
  duration?: number;
  exiting?: boolean;
}

interface SnackbarContextType {
  showSnackbar: (message: string, variant?: SnackbarVariant, icon?: React.ReactNode, duration?: number) => void;
}

const SnackbarContext = createContext<SnackbarContextType | undefined>(undefined);

// ─── Provider ───────────────────────────────────────────────────────────────

export const SnackbarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<SnackbarItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    // Start exit animation
    setItems(prev => prev.map(item => item.id === id ? { ...item, exiting: true } : item));
    // Remove after animation
    setTimeout(() => {
      setItems(prev => prev.filter(item => item.id !== id));
    }, 300);
  }, []);

  const showSnackbar = useCallback((
    message: string,
    variant: SnackbarVariant = 'success',
    icon?: React.ReactNode,
    duration: number = 3000
  ) => {
    const id = `snack-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    
    setItems(prev => {
      // Cap at 5 visible toasts
      const trimmed = prev.length >= 5 ? prev.slice(1) : prev;
      return [...trimmed, { id, message, variant, icon, duration }];
    });

    // Auto-dismiss
    if (duration > 0) {
      const timer = setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, timer);
    }
  }, [dismiss]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer));
    };
  }, []);

  return (
    <SnackbarContext.Provider value={{ showSnackbar }}>
      {children}
      <SnackbarContainer items={items} onDismiss={dismiss} />
    </SnackbarContext.Provider>
  );
};

// ─── Hook ───────────────────────────────────────────────────────────────────

export const useSnackbar = () => {
  const context = useContext(SnackbarContext);
  if (context === undefined) {
    throw new Error('useSnackbar must be used within a SnackbarProvider');
  }
  return context;
};

// ─── Snackbar Container (renders all active toasts) ────────────────────────

const defaultIcons: Record<SnackbarVariant, React.ReactNode> = {
  success: <CheckCircle size={18} />,
  error: <AlertCircle size={18} />,
  info: <Info size={18} />,
  warning: <AlertCircle size={18} />,
};

const variantStyles: Record<SnackbarVariant, { bg: string; border: string; text: string; icon: string }> = {
  success: {
    bg: 'bg-emerald-500/10 dark:bg-emerald-500/15',
    border: 'border-emerald-500/30 dark:border-emerald-400/20',
    text: 'text-emerald-800 dark:text-emerald-300',
    icon: 'text-emerald-600 dark:text-emerald-400',
  },
  error: {
    bg: 'bg-red-500/10 dark:bg-red-500/15',
    border: 'border-red-500/30 dark:border-red-400/20',
    text: 'text-red-800 dark:text-red-300',
    icon: 'text-red-600 dark:text-red-400',
  },
  info: {
    bg: 'bg-blue-500/10 dark:bg-blue-500/15',
    border: 'border-blue-500/30 dark:border-blue-400/20',
    text: 'text-blue-800 dark:text-blue-300',
    icon: 'text-blue-600 dark:text-blue-400',
  },
  warning: {
    bg: 'bg-amber-500/10 dark:bg-amber-500/15',
    border: 'border-amber-500/30 dark:border-amber-400/20',
    text: 'text-amber-800 dark:text-amber-300',
    icon: 'text-amber-600 dark:text-amber-400',
  },
};

const SnackbarContainer: React.FC<{ items: SnackbarItem[]; onDismiss: (id: string) => void }> = ({ items, onDismiss }) => {
  if (items.length === 0) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 z-[9999] flex flex-col-reverse items-center gap-2 pointer-events-none"
      style={{ transform: 'translateX(-50%)' }}
    >
      {items.map((item) => {
        const styles = variantStyles[item.variant];
        const icon = item.icon || defaultIcons[item.variant];

        return (
          <div
            key={item.id}
            className={`
              pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl
              shadow-lg shadow-black/10 dark:shadow-black/30
              min-w-[280px] max-w-[420px]
              ${styles.bg} ${styles.border}
              ${item.exiting ? 'animate-snackbar-exit' : 'animate-snackbar-enter'}
            `}
            style={{
              animationDuration: '300ms',
              animationFillMode: 'forwards',
            }}
          >
            <span className={`shrink-0 ${styles.icon}`}>{icon}</span>
            <span className={`text-sm font-medium flex-1 ${styles.text}`}>{item.message}</span>
            <button
              onClick={() => onDismiss(item.id)}
              className={`shrink-0 p-0.5 rounded-md opacity-60 hover:opacity-100 transition-opacity ${styles.text}`}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
