import { createContext, useContext } from 'react'

export interface MerchantDetailCtx {
  open: (merchantId: string) => void
}

// The context object and its hook live here (a non-component module) so the
// provider file can export ONLY components — required for React Fast Refresh
// (react-refresh/only-export-components).
export const MerchantDetailContext = createContext<
  MerchantDetailCtx | undefined
>(undefined)

export function useMerchantDetail() {
  const ctx = useContext(MerchantDetailContext)
  if (!ctx)
    throw new Error(
      'useMerchantDetail must be inside <MerchantDetailProvider>',
    )
  return ctx
}
