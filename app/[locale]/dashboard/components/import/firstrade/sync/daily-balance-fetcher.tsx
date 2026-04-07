"use client"

import { useEffect, useRef } from "react"
import { useFirstradeSyncContext } from "@/context/firstrade-sync-context"

/**
 * Fetches and saves today's Firstrade portfolio balance to DailyEquity.
 * Only runs during the US market close window (ET 4:00 PM – 6:30 PM, weekdays)
 * to capture official closing prices, not after-hours prices.
 */
function isWithinMarketCloseWindow(): boolean {
  const now = new Date()

  // Check weekday in ET
  const etFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  })
  const parts = etFormatter.formatToParts(now)
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? ""
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10)
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10)

  // Only Mon–Fri
  if (["Sat", "Sun"].includes(weekday)) return false

  // ET 16:00 (4 PM) to 18:30 (6:30 PM)
  const totalMinutes = hour * 60 + minute
  return totalMinutes >= 16 * 60 && totalMinutes < 18 * 60 + 30
}

export function DailyBalanceFetcher() {
  const { sessionId, fetchDailyBalance } = useFirstradeSyncContext()
  const hasFetchedRef = useRef(false)

  useEffect(() => {
    if (!sessionId || hasFetchedRef.current) return
    if (!isWithinMarketCloseWindow()) return

    // Only once per calendar day
    const todayKey = new Date().toISOString().split("T")[0]
    const lastFetch = localStorage.getItem("ft_balance_fetch_date")
    if (lastFetch === todayKey) return

    hasFetchedRef.current = true
    fetchDailyBalance(sessionId).then(() => {
      localStorage.setItem("ft_balance_fetch_date", todayKey)
    })
  }, [sessionId, fetchDailyBalance])

  return null
}
