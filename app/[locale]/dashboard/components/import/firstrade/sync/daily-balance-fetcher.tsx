"use client"

import { useEffect, useRef } from "react"
import { useFirstradeSyncContext } from "@/context/firstrade-sync-context"

/**
 * Fetches and saves today's Firstrade portfolio balance to DailyEquity.
 *
 * Runs once per calendar day whenever the user opens the dashboard.
 * The Vercel cron (market-close-snapshot) captures official closing prices;
 * this component captures a live intraday snapshot so the calendar always
 * has *something* for today, even if the cron hasn't fired yet.
 */
export function DailyBalanceFetcher() {
  const { sessionId, fetchDailyBalance } = useFirstradeSyncContext()
  const hasFetchedRef = useRef(false)

  useEffect(() => {
    if (!sessionId || hasFetchedRef.current) return

    // Only once per calendar day
    const todayKey = new Date().toISOString().split("T")[0]
    const lastFetch = localStorage.getItem("ft_balance_fetch_date")
    if (lastFetch === todayKey) return

    hasFetchedRef.current = true
    fetchDailyBalance(sessionId)
      .then(() => {
        localStorage.setItem("ft_balance_fetch_date", todayKey)
      })
      .catch((err) => {
        // Allow retry on next mount if fetch failed
        hasFetchedRef.current = false
        console.warn("[DailyBalanceFetcher] Failed:", err)
      })
  }, [sessionId, fetchDailyBalance])

  return null
}
