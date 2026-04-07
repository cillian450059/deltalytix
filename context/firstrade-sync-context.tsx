'use client'

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { useData } from '@/context/data-provider'
import { toast } from 'sonner'
import { useI18n } from '@/locales/client'

export interface FirstradeSyncAccount {
  id: string
  userId: string
  service: string
  accountId: string
  hasToken: boolean
  lastSyncedAt: Date
  dailySyncTime: Date | null
  createdAt: Date
  updatedAt: Date
}

interface FirstradeSyncContextType {
  performSyncForAccount: (accountId: string, sessionId: string) => Promise<{ success: boolean; message: string } | undefined>
  performSyncForAllAccounts: (sessionId: string) => Promise<void>
  fetchDailyBalance: (sessionId: string) => Promise<void>
  isAutoSyncing: boolean
  accounts: FirstradeSyncAccount[]
  loadAccounts: () => Promise<void>
  deleteAccount: (accountId: string) => Promise<void>
  sessionId: string | null
  setSessionId: (id: string | null) => void
}

const FirstradeSyncContext = createContext<FirstradeSyncContextType | undefined>(undefined)

export function FirstradeSyncContextProvider({ children }: { children: ReactNode }) {
  const [isAutoSyncing, setIsAutoSyncing] = useState(false)
  const [accounts, setAccounts] = useState<FirstradeSyncAccount[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)

  const t = useI18n()
  const { refreshTradesOnly } = useData()

  const normalizeSynchronization = useCallback(
    (sync: any): FirstradeSyncAccount => ({
      id: sync.id,
      userId: sync.userId,
      service: sync.service,
      accountId: sync.accountId,
      hasToken: !!sync.hasToken,
      lastSyncedAt: sync?.lastSyncedAt ? new Date(sync.lastSyncedAt) : new Date(),
      dailySyncTime: sync?.dailySyncTime ? new Date(sync.dailySyncTime) : null,
      createdAt: sync?.createdAt ? new Date(sync.createdAt) : new Date(),
      updatedAt: sync?.updatedAt ? new Date(sync.updatedAt) : new Date(),
    }),
    [],
  )

  const loadAccounts = useCallback(async () => {
    try {
      const response = await fetch('/api/firstrade/synchronizations', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch Firstrade synchronizations')
      }

      const result = await response.json()
      const data = Array.isArray(result.data) ? result.data : []
      setAccounts(data.map(normalizeSynchronization))
    } catch (error) {
      console.warn('Failed to load Firstrade accounts:', error)
    }
  }, [normalizeSynchronization])

  const deleteAccount = useCallback(async (accountId: string) => {
    setAccounts((prev) => prev.filter((acc) => acc.accountId !== accountId))
    await fetch('/api/firstrade/synchronizations', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    })
  }, [])

  const performSyncForAccount = useCallback(
    async (accountId: string, sessionId: string) => {
      try {
        const runSync = async () => {
          const response = await fetch('/api/firstrade/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, accountId }),
          })

          const payload = await response.json()

          if (payload?.message === 'DUPLICATE_TRADES') {
            return 'All trades already imported'
          }

          if (response.status === 401 || (payload?.message && /session.*expired/i.test(payload.message))) {
            throw new Error('Session expired. Please reconnect your Firstrade account.')
          }

          if (response.status === 429) {
            throw new Error('Too many requests. Please wait a moment before syncing again.')
          }

          if (!response.ok || !payload?.success) {
            throw new Error(payload?.message || `Sync error for account ${accountId}`)
          }

          const savedCount = payload.savedCount || 0
          const tradesCount = payload.tradesCount || 0

          let successMessage: string
          if (savedCount > 0) {
            successMessage = `Synced ${savedCount} new trades (${tradesCount} total) for account ${accountId}`
          } else if (tradesCount > 0) {
            successMessage = `No new trades found (${tradesCount} already imported) for account ${accountId}`
          } else {
            successMessage = `No trades found for account ${accountId}`
          }

          await loadAccounts()
          await refreshTradesOnly({ force: true })

          return successMessage
        }

        const promise = runSync()
        toast.promise(promise, {
          loading: `Syncing Firstrade account ${accountId}...`,
          success: (msg: string) => msg,
          error: (e) => `Sync failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
        })
        const message: string = await promise
        return { success: true, message }
      } catch (error) {
        const errorMsg = `Sync error for account ${accountId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
        console.error('Sync error:', error)
        return { success: false, message: errorMsg }
      }
    },
    [refreshTradesOnly, loadAccounts],
  )

  const fetchDailyBalance = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch('/api/firstrade/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const payload = await response.json()
      if (payload?.success && payload?.equity) {
        console.log(`[Firstrade] Daily equity saved: $${payload.equity}`)
      }
    } catch (error) {
      console.warn('[Firstrade] Failed to save daily balance:', error)
    }
  }, [])

  const performSyncForAllAccounts = useCallback(
    async (sessionId: string) => {
      if (isAutoSyncing) return

      setIsAutoSyncing(true)

      try {
        const validAccounts = accounts.filter((acc) => acc.hasToken)
        if (validAccounts.length === 0) return

        for (const account of validAccounts) {
          await performSyncForAccount(account.accountId, sessionId)
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
        // Save today's portfolio value after all accounts synced
        await fetchDailyBalance(sessionId)
      } catch (error) {
        console.error('Error during bulk sync:', error)
      } finally {
        setIsAutoSyncing(false)
      }
    },
    [isAutoSyncing, accounts, performSyncForAccount],
  )

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  return (
    <FirstradeSyncContext.Provider
      value={{
        performSyncForAccount,
        performSyncForAllAccounts,
        fetchDailyBalance,
        isAutoSyncing,
        accounts,
        loadAccounts,
        deleteAccount,
        sessionId,
        setSessionId,
      }}
    >
      {children}
    </FirstradeSyncContext.Provider>
  )
}

export function useFirstradeSyncContext() {
  const context = useContext(FirstradeSyncContext)
  if (context === undefined) {
    throw new Error('useFirstradeSyncContext must be used within a FirstradeSyncContextProvider')
  }
  return context
}
