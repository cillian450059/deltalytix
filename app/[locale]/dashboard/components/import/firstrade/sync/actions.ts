'use server'

import { prisma } from '@/lib/prisma'
import { getUserId } from '@/server/auth'
import { encryptToken, decryptToken } from '@/lib/token-crypto'
import { saveTradesAction } from '@/server/database'
import { generateDeterministicTradeId } from '@/lib/trade-id-utils'
import { Trade } from '@/prisma/generated/prisma/client'

const FIRSTRADE_SERVICE_URL = process.env.FIRSTRADE_SERVICE_URL || 'http://localhost:8100'
const FIRSTRADE_API_KEY = process.env.FIRSTRADE_SERVICE_API_KEY || ''

// Timeout constants (milliseconds)
const DEFAULT_TIMEOUT = 15_000   // 15s for login/otp/accounts
const SYNC_TIMEOUT = 60_000     // 60s for transaction sync (large date ranges)

function serviceHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': FIRSTRADE_API_KEY,
  }
}

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer))
}

function serviceError(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Request timed out. Firstrade may be slow — try again or reduce the sync range.'
  }
  return fallback
}

// ── Login ────────────────────────────────────────────────────────────────────

export async function loginFirstrade(
  username: string,
  password: string,
  pin?: string,
  email?: string,
  phone?: string
): Promise<{ success: boolean; sessionId?: string; requiresOtp?: boolean; error?: string }> {
  try {
    const response = await fetchWithTimeout(`${FIRSTRADE_SERVICE_URL}/login`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({ username, password, pin: pin || '', email: email || '', phone: phone || '' }),
    }, DEFAULT_TIMEOUT)

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Login failed' }))
      return { success: false, error: err.detail || 'Login failed' }
    }

    const data = await response.json()
    return {
      success: true,
      sessionId: data.session_id,
      requiresOtp: data.requires_otp,
    }
  } catch (error) {
    return { success: false, error: serviceError(error, 'Cannot connect to Firstrade service. Make sure it is running.') }
  }
}

// ── OTP ──────────────────────────────────────────────────────────────────────

export async function submitFirstradeOtp(
  sessionId: string,
  otpCode: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetchWithTimeout(`${FIRSTRADE_SERVICE_URL}/otp`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({ session_id: sessionId, otp_code: otpCode }),
    }, DEFAULT_TIMEOUT)

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'OTP verification failed' }))
      return { success: false, error: err.detail || 'OTP verification failed' }
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: serviceError(error, 'Cannot connect to Firstrade service.') }
  }
}

// ── Get Accounts ─────────────────────────────────────────────────────────────

export async function getFirstradeAccounts(
  sessionId: string
): Promise<{ success: boolean; accounts?: string[]; error?: string }> {
  try {
    const response = await fetchWithTimeout(`${FIRSTRADE_SERVICE_URL}/accounts`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({ session_id: sessionId }),
    }, DEFAULT_TIMEOUT)

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to get accounts' }))
      return { success: false, error: err.detail || 'Failed to get accounts' }
    }

    const data = await response.json()
    return { success: true, accounts: data.accounts }
  } catch (error) {
    return { success: false, error: serviceError(error, 'Cannot connect to Firstrade service.') }
  }
}

// ── Sync Trades ──────────────────────────────────────────────────────────────

interface FirstradeTradeRaw {
  symbol: string
  assetType: string
  side: string
  quantity: number
  entryPrice: number
  closePrice: number
  entryDate: string
  closeDate: string
  pnl: number
  pnlPct: number
  commission: number
  status: string
}

interface FirstradeCashflow {
  type: string       // dividend, deposit, withdrawal, fee, interest, transfer
  date: string
  amount: number
  symbol: string
  description: string
  commission: number
}

export async function syncFirstradeTrades(
  sessionId: string,
  accountId: string,
  days: number = 1825
): Promise<{ success: boolean; savedCount?: number; tradesCount?: number; error?: string }> {
  try {
    const userId = await getUserId()

    // Fetch balances and ensure account record exists
    const balResult = await fetchFirstradeBalances(sessionId)
    await ensureAccountWithBalance(accountId, balResult.balances)

    // Fetch transactions from FastAPI service
    const response = await fetchWithTimeout(`${FIRSTRADE_SERVICE_URL}/transactions`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({ session_id: sessionId, days }),
    }, SYNC_TIMEOUT)

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to fetch transactions' }))
      return { success: false, error: err.detail || 'Failed to fetch transactions' }
    }

    const data = await response.json()
    const rawTrades: FirstradeTradeRaw[] = data.trades || []
    const rawCashflows: FirstradeCashflow[] = data.cashflows || []

    if (rawTrades.length === 0 && rawCashflows.length === 0) {
      await updateSyncTimestamp(userId, accountId)
      return { success: true, savedCount: 0, tradesCount: 0 }
    }

    // Convert FIFO-matched trades to Deltalytix Trade format
    // Dates come as YYYY-MM-DD strings — append T12:00:00Z to avoid timezone shifts
    const trades: Partial<Trade>[] = rawTrades.map((t) => {
      const entryDate = `${t.entryDate}T12:00:00.000Z`
      const closeDate = `${t.closeDate}T12:00:00.000Z`
      const timeInPosition = (new Date(closeDate).getTime() - new Date(entryDate).getTime()) / 1000

      return {
        instrument: t.symbol,
        accountNumber: accountId,
        side: t.side,
        quantity: t.quantity,
        entryPrice: t.entryPrice.toFixed(4),
        closePrice: t.closePrice.toFixed(4),
        entryDate,
        closeDate,
        pnl: t.pnl,
        commission: t.commission,
        timeInPosition,
        userId,
        tags: ['firstrade'],
      } as Partial<Trade>
    })

    // Convert cashflows (dividends, deposits, withdrawals, fees) to Trade format
    const cashflowTrades: Partial<Trade>[] = rawCashflows.map((cf) => {
      const cfDate = `${cf.date}T12:00:00.000Z`
      const tagMap: Record<string, string> = {
        dividend: 'dividend',
        interest: 'interest',
        deposit: 'deposit',
        withdrawal: 'withdrawal',
        fee: 'fee',
        transfer: 'transfer',
        journal: 'journal',
      }

      // Build descriptive instrument name
      let instrument = cf.symbol || cf.type.toUpperCase()
      if (cf.type === 'fee' && cf.description) {
        instrument = cf.description.includes('WIRE') ? 'WIRE FEE' : 'FEE'
      } else if (cf.type === 'withdrawal' && cf.description) {
        instrument = cf.description.includes('WIRE') ? 'WIRE TRANSFER' : 'WITHDRAWAL'
      }

      return {
        instrument,
        accountNumber: accountId,
        side: cf.type,
        quantity: 1,
        entryPrice: '0',
        closePrice: Math.abs(cf.amount).toFixed(4),
        entryDate: cfDate,
        closeDate: cfDate,
        pnl: cf.amount,
        commission: cf.commission,
        timeInPosition: 0,
        userId,
        tags: ['firstrade', tagMap[cf.type] || cf.type],
      } as Partial<Trade>
    })

    const allTrades = [...trades, ...cashflowTrades]

    // Save all to database
    const result = await saveTradesAction(allTrades as Trade[])

    // Save daily equity snapshot
    await saveDailyEquitySnapshot(userId, accountId, balResult.balances)

    // Update sync timestamp
    await updateSyncTimestamp(userId, accountId)

    return {
      success: true,
      savedCount: result.numberOfTradesAdded,
      tradesCount: rawTrades.length + rawCashflows.length,
    }
  } catch (error) {
    console.error('[Firstrade Sync] Error:', error)
    return { success: false, error: serviceError(error, error instanceof Error ? error.message : 'Sync failed') }
  }
}

// ── Balance ──────────────────────────────────────────────────────────────────

export async function fetchFirstradeBalances(
  sessionId: string
): Promise<{ success: boolean; balances?: Record<string, Record<string, number | string>>; error?: string }> {
  try {
    const response = await fetchWithTimeout(`${FIRSTRADE_SERVICE_URL}/balances`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({ session_id: sessionId }),
    }, DEFAULT_TIMEOUT)

    if (!response.ok) {
      return { success: false, error: 'Failed to fetch balances' }
    }

    const data = await response.json()
    return { success: true, balances: data.balances }
  } catch (error) {
    return { success: false, error: serviceError(error, 'Cannot connect to Firstrade service.') }
  }
}

// ── Ensure Account record exists with balance ────────────────────────────────

async function ensureAccountWithBalance(accountId: string, balances: Record<string, Record<string, number | string>> | undefined) {
  const userId = await getUserId()

  // Extract total equity from balance data
  let totalEquity = 0
  if (balances && balances[accountId]) {
    const b = balances[accountId]
    // Look for equity or total value fields
    for (const [key, val] of Object.entries(b)) {
      const k = key.toLowerCase()
      if (k.includes('equity') || k.includes('total') && k.includes('value')) {
        const num = typeof val === 'number' ? val : parseFloat(String(val))
        if (!isNaN(num) && num > totalEquity) {
          totalEquity = num
        }
      }
    }
    // Fallback: try cash + market value
    if (totalEquity === 0) {
      let cash = 0, marketVal = 0
      for (const [key, val] of Object.entries(b)) {
        const k = key.toLowerCase()
        const num = typeof val === 'number' ? val : parseFloat(String(val))
        if (isNaN(num)) continue
        if (k.includes('cash') && !k.includes('avail')) cash = Math.max(cash, num)
        if (k.includes('market') && k.includes('value')) marketVal = Math.max(marketVal, num)
      }
      if (cash > 0 || marketVal > 0) totalEquity = cash + marketVal
    }
    console.log(`[Firstrade] Account ${accountId} equity: ${totalEquity}`)
  }

  // Upsert account record
  const existing = await prisma.account.findFirst({
    where: { number: accountId, userId },
  })

  if (!existing) {
    await prisma.account.create({
      data: {
        number: accountId,
        userId,
        propfirm: 'Firstrade',
        startingBalance: 0,
      },
    })
  }
}

// ── Daily Equity Snapshot ────────────────────────────────────────────────────

async function saveDailyEquitySnapshot(
  userId: string,
  accountId: string,
  balances: Record<string, Record<string, number | string>> | undefined
) {
  if (!balances || !balances[accountId]) return

  const b = balances[accountId]
  let equity = 0
  let cash = 0

  for (const [key, val] of Object.entries(b)) {
    const k = key.toLowerCase()
    const num = typeof val === 'number' ? val : parseFloat(String(val))
    if (isNaN(num)) continue
    if (k.includes('equity') || (k.includes('total') && k.includes('value'))) {
      equity = Math.max(equity, num)
    }
    if (k.includes('cash') && !k.includes('avail')) {
      cash = Math.max(cash, num)
    }
  }

  // Fallback: if no equity field, try cash + market value
  if (equity === 0) {
    let marketVal = 0
    for (const [key, val] of Object.entries(b)) {
      const k = key.toLowerCase()
      const num = typeof val === 'number' ? val : parseFloat(String(val))
      if (isNaN(num)) continue
      if (k.includes('market') && k.includes('value')) marketVal = Math.max(marketVal, num)
    }
    if (cash > 0 || marketVal > 0) equity = cash + marketVal
  }

  if (equity === 0) return

  const today = new Date()
  today.setHours(12, 0, 0, 0) // Noon to avoid timezone issues

  try {
    await prisma.dailyEquity.upsert({
      where: {
        userId_accountNumber_date: {
          userId,
          accountNumber: accountId,
          date: today,
        },
      },
      create: {
        userId,
        accountNumber: accountId,
        date: today,
        equity,
        cash,
      },
      update: {
        equity,
        cash,
      },
    })
    console.log(`[Firstrade] Saved daily equity for ${accountId}: $${equity.toFixed(2)} (cash: $${cash.toFixed(2)})`)
  } catch (error) {
    console.error('[Firstrade] Failed to save daily equity:', error)
  }
}

// ── Standalone Daily Equity Save ─────────────────────────────────────────────

export async function fetchAndSaveDailyEquity(
  sessionId: string
): Promise<{ success: boolean; equity?: number; error?: string }> {
  try {
    const userId = await getUserId()
    const balResult = await fetchFirstradeBalances(sessionId)
    if (!balResult.success || !balResult.balances) {
      return { success: false, error: balResult.error || 'Failed to fetch balances' }
    }

    let savedEquity = 0
    for (const accountId of Object.keys(balResult.balances)) {
      await saveDailyEquitySnapshot(userId, accountId, balResult.balances)
      // Extract equity value for response
      const b = balResult.balances[accountId]
      if (b) {
        for (const [key, val] of Object.entries(b)) {
          const k = key.toLowerCase()
          const num = typeof val === 'number' ? val : parseFloat(String(val))
          if (!isNaN(num) && (k.includes('equity') || (k.includes('total') && k.includes('value')))) {
            savedEquity = Math.max(savedEquity, num)
          }
        }
      }
    }

    return { success: true, equity: savedEquity }
  } catch (error) {
    console.error('[Firstrade] fetchAndSaveDailyEquity error:', error)
    return { success: false, error: 'Failed to save daily equity' }
  }
}

// ── Synchronization CRUD ─────────────────────────────────────────────────────

export async function storeFirstradeSync(
  accountId: string,
  sessionId?: string
): Promise<{ success: boolean; tokenStored?: boolean; error?: string }> {
  try {
    const userId = await getUserId()

    // Export session cookies so the nightly cron can restore without re-login.
    let sessionToken: string | undefined
    let exportError: string | undefined
    if (sessionId) {
      try {
        console.log(`[Firstrade] Exporting session for ${accountId}, sessionId=${sessionId.substring(0, 8)}...`)
        const exportResp = await fetchWithTimeout(`${FIRSTRADE_SERVICE_URL}/session-export`, {
          method: 'POST',
          headers: serviceHeaders(),
          body: JSON.stringify({ session_id: sessionId }),
        }, DEFAULT_TIMEOUT)
        if (exportResp.ok) {
          const exportData = await exportResp.json()
          console.log(`[Firstrade] session-export response: success=${exportData.success}, hasCookies=${!!exportData.cookies}, hasHeaders=${!!exportData.headers}`)
          if (exportData.success && exportData.cookies) {
            sessionToken = JSON.stringify({ cookies: exportData.cookies, headers: exportData.headers })
            console.log(`[Firstrade] Session token built, length=${sessionToken.length}`)
          } else {
            exportError = `session-export returned success=${exportData.success}, hasCookies=${!!exportData.cookies}`
          }
        } else {
          const errBody = await exportResp.text().catch(() => '')
          exportError = `session-export HTTP ${exportResp.status}: ${errBody.substring(0, 200)}`
        }
      } catch (err) {
        exportError = err instanceof Error ? err.message : 'Unknown export error'
      }
      if (exportError) {
        console.error(`[Firstrade] Session export failed for ${accountId}: ${exportError}`)
      }
    }

    const tokenOk = !!sessionToken && sessionToken.length > 0
    console.log(`[Firstrade] storeSync ${accountId}: tokenOk=${tokenOk}`)

    // Encrypt before storing — protects session cookies in case of DB breach
    const encryptedToken = tokenOk ? encryptToken(sessionToken!) : ''

    await prisma.synchronization.upsert({
      where: {
        userId_service_accountId: {
          userId,
          service: 'firstrade',
          accountId,
        },
      },
      create: {
        userId,
        service: 'firstrade',
        accountId,
        token: encryptedToken,
        lastSyncedAt: new Date(),
        needsReauth: !tokenOk,
      },
      update: {
        lastSyncedAt: new Date(),
        token: encryptedToken,
        needsReauth: !tokenOk,
      },
    })

    return { success: true, tokenStored: tokenOk }
  } catch (error) {
    console.error('[Firstrade] storeSync error:', error)
    return { success: false, error: 'Failed to store sync configuration' }
  }
}

export async function getFirstradeSynchronizations(): Promise<{
  synchronizations?: any[]
  error?: string
}> {
  try {
    const userId = await getUserId()

    const syncs = await prisma.synchronization.findMany({
      where: { userId, service: 'firstrade' },
    })

    return { synchronizations: syncs }
  } catch (error) {
    console.error('[Firstrade] getSynchronizations error:', error)
    return { error: 'Failed to fetch synchronizations' }
  }
}

export async function removeFirstradeSync(accountId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = await getUserId()

    await prisma.synchronization.delete({
      where: {
        userId_service_accountId: {
          userId,
          service: 'firstrade',
          accountId,
        },
      },
    })

    return { success: true }
  } catch (error) {
    console.error('[Firstrade] removeSync error:', error)
    return { success: false, error: 'Failed to remove synchronization' }
  }
}

export async function updateFirstradeDailySyncTimeAction(
  accountId: string,
  dailySyncTime: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = await getUserId()

    await prisma.synchronization.update({
      where: {
        userId_service_accountId: {
          userId,
          service: 'firstrade',
          accountId,
        },
      },
      data: {
        dailySyncTime: dailySyncTime ? new Date(dailySyncTime) : null,
      },
    })

    return { success: true }
  } catch (error) {
    console.error('[Firstrade] updateDailySyncTime error:', error)
    return { success: false, error: 'Failed to update daily sync time' }
  }
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

async function updateSyncTimestamp(userId: string, accountId: string) {
  try {
    await prisma.synchronization.update({
      where: {
        userId_service_accountId: {
          userId,
          service: 'firstrade',
          accountId,
        },
      },
      data: { lastSyncedAt: new Date() },
    })
  } catch {
    // Sync record may not exist yet, ignore
  }
}
