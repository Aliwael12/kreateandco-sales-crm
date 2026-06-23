import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { ToastContext } from './toast-context'

interface ToastState {
  id: number
  message: string
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)

  const show = useCallback((message: string) => {
    setToast({ id: Date.now(), message })
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div className="pointer-events-none fixed bottom-5 right-5 z-[9999]">
          <div className="flex items-center gap-2 rounded-[10px] bg-navy px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_8px_24px_rgba(11,31,75,.3)]">
            <Check size={16} className="text-ok" />
            <span>{toast.message}</span>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}
