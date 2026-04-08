'use client'

import React, { useState, useEffect, useCallback, useRef } from "react"
import { useMediaQuery } from "@/hooks/use-media-query"
import MobileCalendarPnl from "./mobile-calendar"
import DesktopCalendarPnl from "./desktop-calendar"
import { useData } from "@/context/data-provider"
import { Button } from "@/components/ui/button"
import { RefreshCw, Link2Off } from "lucide-react"
import { toast } from "sonner"
import { DailyEquityRecord } from "@/app/[locale]/dashboard/types/calendar"

// Fetch DailyEquity for a rolling window (covers any month the user might view)
async function fetchDailyEquity(months: number = 3): Promise<DailyEquityRecord[]> {
  const to = new Date()
  const from = new Date()
  from.setMonth(from.getMonth() - months)
  const params = new URLSearchParams({
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  })
  const resp = await fetch(`/api/daily-equity?${params}`)
  if (!resp.ok) return []
  return resp.json()
}

// Build a map keyed by YYYY-MM-DD -> summed equity across accounts for that day
function buildEquityMap(records: DailyEquityRecord[]): Record<string, { equity: number; cash: number }> {
  const map: Record<string, { equity: number; cash: number }> = {}
  for (const r of records) {
    if (!map[r.date]) {
      map[r.date] = { equity: 0, cash: 0 }
    }
    map[r.date].equity += r.equity
    map[r.date].cash += r.cash
  }
  return map
}

// Trigger manual snapshot and return parsed results
async function triggerSnapshot(): Promise<{ ok: boolean; data: any }> {
  const resp = await fetch('/api/firstrade/manual-snapshot', { method: 'POST' })
  const data = await resp.json()
  return { ok: resp.ok, data }
}

const RECONNECT_ERRORS = new Set(['session_expired', 'no_session_stored'])

// Returns { errors, needsReconnect }
function parseSnapshotResults(results: any[]): { errors: string[]; needsReconnect: boolean } {
  const errors = results
    .filter((r: any) => r.error)
    .map((r: any) => {
      if (r.error === 'session_expired') return `帳號 ${r.accountId} 連線已過期`
      if (r.error === 'no_session_stored') return `帳號 ${r.accountId} 尚未設定連線`
      return `帳號 ${r.accountId}: ${r.error}`
    })
  const needsReconnect = results.some((r: any) => RECONNECT_ERRORS.has(r.error))
  return { errors, needsReconnect }
}

export default function CalendarPnl() {
  const { calendarData, refreshAllData } = useData()
  const isMobile = useMediaQuery("(max-width: 640px)")
  const [equityMap, setEquityMap] = useState<Record<string, { equity: number; cash: number }>>({})
  const [isSyncing, setIsSyncing] = useState(false)
  const [hasFirstrade, setHasFirstrade] = useState(false)
  const [needsReconnect, setNeedsReconnect] = useState(false)
  const autoSyncAttempted = useRef(false)

  // Load DailyEquity on mount; also check if Firstrade sync is configured
  const loadEquity = useCallback(async () => {
    const records = await fetchDailyEquity(3)
    const map = buildEquityMap(records)
    setEquityMap(map)
    setHasFirstrade(records.length > 0)
    return map
  }, [])

  // Check if Firstrade sync is configured (even if no DailyEquity records yet)
  useEffect(() => {
    fetch('/api/firstrade/synchronizations')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.data?.length > 0) setHasFirstrade(true)
      })
      .catch(() => {})
  }, [])

  // Auto-sync: if user has Firstrade data but today's equity is missing, sync automatically
  useEffect(() => {
    if (autoSyncAttempted.current) return
    loadEquity().then(async (map) => {
      const todayKey = new Date().toISOString().split('T')[0]
      if (map[todayKey]) return // Today already has equity

      autoSyncAttempted.current = true
      try {
        const { ok, data } = await triggerSnapshot()
        if (ok) {
          const { errors, needsReconnect: reconnect } = parseSnapshotResults(data.results ?? [])
          if (reconnect) {
            setNeedsReconnect(true)
          } else if (errors.length > 0) {
            toast.error('自動同步失敗', { description: errors[0] })
          } else {
            await loadEquity()
            await refreshAllData()
          }
        }
      } catch {
        // Silent fail for auto-sync — user can retry manually
      }
    })
  }, [loadEquity, refreshAllData])

  // Manual sync: trigger Firstrade snapshot + reload data
  const handleSync = useCallback(async () => {
    setIsSyncing(true)
    try {
      const { ok, data } = await triggerSnapshot()

      if (!ok) {
        toast.error('同步失敗', { description: data.error || '請確認 Firstrade 連線狀態' })
        return
      }

      const { errors, needsReconnect: reconnect } = parseSnapshotResults(data.results ?? [])
      if (reconnect) {
        setNeedsReconnect(true)
        toast.error('需要重新連線', { description: '請前往匯入設定重新登入 Firstrade' })
        return
      }
      if (errors.length > 0) {
        toast.error('同步失敗', { description: errors[0] })
        return
      }

      setNeedsReconnect(false)
      await Promise.all([loadEquity(), refreshAllData()])
      const saved = data.results?.reduce((sum: number, r: any) => sum + (r.tradesSaved ?? 0), 0) ?? 0
      toast.success('同步完成', {
        description: `已更新淨值，今日新增 ${saved} 筆交易`,
      })
    } catch {
      toast.error('同步失敗', { description: '網路錯誤，請稍後再試' })
    } finally {
      setIsSyncing(false)
    }
  }, [loadEquity, refreshAllData])

  return (
    <div className="h-full flex flex-col">
      {/* Sync / reconnect button */}
      {hasFirstrade && (
        <div className="flex justify-end px-4 pt-2 pb-0 shrink-0">
          {needsReconnect ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-orange-500 gap-1"
              onClick={() => toast.info('請點擊頂部「匯入」按鈕，選擇 Firstrade Sync 重新登入', { duration: 6000 })}
            >
              <Link2Off className="h-3 w-3" />
              重新連線 Firstrade
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground gap-1"
              disabled={isSyncing}
              onClick={handleSync}
            >
              <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? '同步中...' : '立即同步'}
            </Button>
          )}
        </div>
      )}
      <div className="flex-1 min-h-0">
        {isMobile ? (
          <MobileCalendarPnl calendarData={calendarData} />
        ) : (
          <DesktopCalendarPnl calendarData={calendarData} equityMap={equityMap} />
        )}
      </div>
    </div>
  )
}
