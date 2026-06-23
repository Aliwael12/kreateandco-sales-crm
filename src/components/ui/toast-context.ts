import { createContext, useContext } from 'react'

export interface ToastContextValue {
  show: (message: string) => void
}

// Context + hook live in this non-component module so Toast.tsx can export
// ONLY the provider component (react-refresh/only-export-components).
export const ToastContext = createContext<ToastContextValue | undefined>(
  undefined,
)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be inside <ToastProvider>')
  return ctx
}
