import { create } from 'zustand'
import type { TradeAnalyticsPoint } from '@/server/trade-analytics'

type TradeAnalyticsStore = {
  analytics: TradeAnalyticsPoint[]
  isLoading: boolean
  loaded: boolean
  setAnalytics: (data: TradeAnalyticsPoint[]) => void
  setIsLoading: (v: boolean) => void
  reset: () => void
}

export const useTradeAnalyticsStore = create<TradeAnalyticsStore>()((set) => ({
  analytics: [],
  isLoading: false,
  loaded:    false,

  setAnalytics: (data) => set({ analytics: data, loaded: true, isLoading: false }),
  setIsLoading: (v)    => set({ isLoading: v }),
  reset:        ()     => set({ analytics: [], loaded: false, isLoading: false }),
}))
