/**
 * Cron: Market-Close Snapshot  (runs Mon–Fri at 21:05 UTC = 4:05 PM ET)
 *
 * For every user with a stored Firstrade session:
 *   1. Restore session from saved cookies (no re-login needed).
 *   2. Fetch open positions (symbol + quantity) via FastAPI /positions.
 *   3. Fetch today's official 4 PM close prices from Yahoo Finance.
 *   4. NAV = Σ(shares × close_price) + cash.
 *   5. Upsert DailyEquity — dashboard equity chart reflects closing value.
 *   6. Also sync today's trades so the trade list is up to date.
 *
 * Prices use includePrePost=false, so after-hours quotes never pollute the NAV.
 * If a session has expired the sync is flagged needsReauth=true so the UI can
 * prompt the user to log in again.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchClosingPrices } from '@/lib/closing-prices'
import { saveTradesAction } from '@/server/database'
import { generateDeterministicTradeId } from '@/lib/trade-id-utils'
import { Trade } from '@/prisma/generated/prisma/client'

const FT_URL = process.env.FIRSTRADE_SERVICE_URL || 'http://localhost:8100'
const FT_KEY = process.env.FIRSTRADE_SERVICE_API_KEY || ''
const CRON_SECRET = process.env.CRON_SECRET || ''

function ftHeaders() {
  return { 'Content-Type': 'application/json', 'x-api-key': FT_KEY }
}

async function ftPost(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${FT_URL}${path}`, {
    method: 'POST',
    headers: ftHeaders(),
    body: JSON.stringify(body),
    // 20 s timeout via AbortSignal
    signal: AbortSignal.timeout(20_000),
  })
  return r.json()
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!auth || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Date key at 4 PM ET (20:00 UTC covers EDT; 21:00 UTC covers EST).
  // We store noon UTC so the unique index [userId, accountNumber, date] is stable.
  const todayKey = new Date().toISOString().split('T')[0]
  const snapshotDate = new Date(`${todayKey}T12:00:00.000Z`)

  const syncs = await prisma.synchronization.findMany({
    where: { service: 'firstrade' },
  })

  if (!syncs.length) {
    return NextResponse.json({ message: 'No Firstrade syncs', processed: 0 })
  }

  type SyncResult = {
    userId: string
    accountId: string
    nav?: number
    positions?: number
    tradesSaved?: number
    error?: string
  }
  const results: SyncResult[] = []

  for (const sync of syncs) {
    // ── 1. Restore session ──────────────────────────────────────────────────
    if (!sync.token) {
      await prisma.synchronization.update({
        where: { id: sync.id },
        data: { needsReauth: true },
      })
      results.push({ userId: sync.userId, accountId: sync.accountId, error: 'no_session_stored' })
      continue
    }

    let sessionData: { cookies: string; headers: string }
    try {
      sessionData = JSON.parse(sync.token)
    } catch {
      results.push({ userId: sync.userId, accountId: sync.accountId, error: 'invalid_token_json' })
      continue
    }

    const importRes = await ftPost('/session-import', sessionData).catch(() => null)
    if (!importRes?.success || !importRes.session_id) {
      await prisma.synchronization.update({
        where: { id: sync.id },
        data: { needsReauth: true },
      })
      results.push({ userId: sync.userId, accountId: sync.accountId, error: 'session_expired' })
      continue
    }

    const sessionId: string = importRes.session_id

    // ── 2. Fetch positions ──────────────────────────────────────────────────
    const posRes = await ftPost('/positions', { session_id: sessionId }).catch(() => null)
    if (!posRes?.success) {
      results.push({ userId: sync.userId, accountId: sync.accountId, error: 'positions_failed' })
      continue
    }

    const acctData = posRes.accounts?.[sync.accountId]
    if (!acctData) {
      results.push({ userId: sync.userId, accountId: sync.accountId, error: 'account_not_in_positions' })
      continue
    }

    const positions: Array<{ symbol: string; quantity: number; market_value: number }> =
      acctData.positions ?? []
    const cash: number = acctData.cash ?? 0

    // ── 3. Fetch official close prices ──────────────────────────────────────
    const symbols = [...new Set(positions.map((p) => p.symbol))]
    const prices = symbols.length ? await fetchClosingPrices(symbols) : {}

    // ── 4. Calculate NAV at close ───────────────────────────────────────────
    let nav = cash
    for (const pos of positions) {
      const closePrice = prices[pos.symbol]
      if (closePrice !== undefined) {
        nav += pos.quantity * closePrice
      } else {
        // Symbol had no price (e.g. market holiday, option, OTC) — fall back to
        // Firstrade's last-known market_value for this position.
        nav += pos.market_value ?? 0
      }
    }

    // ── 5. Upsert DailyEquity ───────────────────────────────────────────────
    await prisma.dailyEquity.upsert({
      where: {
        userId_accountNumber_date: {
          userId: sync.userId,
          accountNumber: sync.accountId,
          date: snapshotDate,
        },
      },
      create: {
        userId: sync.userId,
        accountNumber: sync.accountId,
        date: snapshotDate,
        equity: nav,
        cash,
      },
      update: { equity: nav, cash },
    })

    // ── 6. Sync today's trades ──────────────────────────────────────────────
    let tradesSaved = 0
    try {
      const txRes = await ftPost('/transactions', { session_id: sessionId, days: 1 })
      const rawTrades = txRes?.trades ?? []
      const rawCashflows = txRes?.cashflows ?? []

      const trades: Partial<Trade>[] = rawTrades.map((t: any) => {
        const entryDate = `${t.entryDate}T12:00:00.000Z`
        const closeDate = `${t.closeDate}T12:00:00.000Z`
        return {
          instrument: t.symbol,
          accountNumber: sync.accountId,
          side: t.side,
          quantity: t.quantity,
          entryPrice: t.entryPrice.toFixed(4),
          closePrice: t.closePrice.toFixed(4),
          entryDate,
          closeDate,
          pnl: t.pnl,
          commission: t.commission,
          timeInPosition: (new Date(closeDate).getTime() - new Date(entryDate).getTime()) / 1000,
          userId: sync.userId,
          tags: ['firstrade'],
        } as Partial<Trade>
      })

      const cashflows: Partial<Trade>[] = rawCashflows.map((cf: any) => {
        const cfDate = `${cf.date}T12:00:00.000Z`
        return {
          instrument: cf.symbol || cf.type.toUpperCase(),
          accountNumber: sync.accountId,
          side: cf.type,
          quantity: 1,
          entryPrice: '0',
          closePrice: Math.abs(cf.amount).toFixed(4),
          entryDate: cfDate,
          closeDate: cfDate,
          pnl: cf.amount,
          commission: cf.commission,
          timeInPosition: 0,
          userId: sync.userId,
          tags: ['firstrade', cf.type],
        } as Partial<Trade>
      })

      if (trades.length + cashflows.length > 0) {
        const saved = await saveTradesAction([...trades, ...cashflows] as Trade[])
        tradesSaved = saved.numberOfTradesAdded
      }
    } catch (err) {
      console.error('[MarketCloseSnapshot] trade sync error:', err)
    }

    // ── Mark sync healthy ───────────────────────────────────────────────────
    await prisma.synchronization.update({
      where: { id: sync.id },
      data: { lastSyncedAt: new Date(), needsReauth: false },
    })

    results.push({
      userId: sync.userId,
      accountId: sync.accountId,
      nav: Math.round(nav * 100) / 100,
      positions: positions.length,
      tradesSaved,
    })
  }

  console.log('[MarketCloseSnapshot]', todayKey, JSON.stringify(results))
  return NextResponse.json({ date: todayKey, results })
}
