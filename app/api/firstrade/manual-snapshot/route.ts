/**
 * POST /api/firstrade/manual-snapshot
 *
 * Manually trigger a Firstrade position snapshot + trade sync for the current user.
 * Same logic as the market-close-snapshot cron, but:
 *  - Uses live market prices (not closing prices) since this may run intraday.
 *  - Authenticated via Supabase session (not CRON_SECRET).
 *  - Only processes the calling user's Firstrade syncs.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/server/auth'
import { prisma } from '@/lib/prisma'
import { saveTradesAction } from '@/server/database'
import { Trade } from '@/prisma/generated/prisma/client'
import { decryptToken } from '@/lib/token-crypto'

const FT_URL = process.env.FIRSTRADE_SERVICE_URL || 'http://localhost:8100'
const FT_KEY = process.env.FIRSTRADE_SERVICE_API_KEY || ''

function ftHeaders() {
  return { 'Content-Type': 'application/json', 'x-api-key': FT_KEY }
}

async function ftPost(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${FT_URL}${path}`, {
    method: 'POST',
    headers: ftHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  return r.json()
}

// Fetch live market price (intraday) via Yahoo Finance v8
async function fetchLivePrices(symbols: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {}
  await Promise.allSettled(
    symbols.map(async (sym) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1m&includePrePost=false`
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          cache: 'no-store',
        })
        if (!resp.ok) return
        const data = await resp.json()
        const meta = data?.chart?.result?.[0]?.meta
        const price = meta?.regularMarketPrice
        if (price) prices[sym.toUpperCase()] = price
      } catch {
        // skip
      }
    })
  )
  return prices
}

export async function POST(_req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id

    const todayKey = new Date().toISOString().split('T')[0]
    const snapshotDate = new Date(`${todayKey}T12:00:00.000Z`)

    const syncs = await prisma.synchronization.findMany({
      where: { service: 'firstrade', userId },
    })

    if (!syncs.length) {
      return NextResponse.json({ error: 'No Firstrade sync configured' }, { status: 404 })
    }

    type SyncResult = {
      accountId: string
      nav?: number
      positions?: number
      tradesSaved?: number
      error?: string
    }
    const results: SyncResult[] = []

    for (const sync of syncs) {
      if (!sync.token) {
        results.push({ accountId: sync.accountId, error: 'no_session_stored' })
        continue
      }

      let sessionData: { cookies: string; headers: string }
      try {
        sessionData = JSON.parse(decryptToken(sync.token))
      } catch {
        results.push({ accountId: sync.accountId, error: 'invalid_token_json' })
        continue
      }

      const importRes = await ftPost('/session-import', sessionData).catch(() => null)
      if (!importRes?.success || !importRes.session_id) {
        await prisma.synchronization.update({
          where: { id: sync.id },
          data: { needsReauth: true },
        })
        results.push({ accountId: sync.accountId, error: 'session_expired' })
        continue
      }

      const sessionId: string = importRes.session_id

      // Fetch positions
      const posRes = await ftPost('/positions', { session_id: sessionId }).catch(() => null)
      if (!posRes?.success) {
        results.push({ accountId: sync.accountId, error: 'positions_failed' })
        continue
      }

      const acctData = posRes.accounts?.[sync.accountId]
      if (!acctData) {
        results.push({ accountId: sync.accountId, error: 'account_not_in_positions' })
        continue
      }

      const positions: Array<{ symbol: string; quantity: number; market_value: number }> =
        acctData.positions ?? []
      const cash: number = acctData.cash ?? 0

      // Fetch live prices (intraday — not official close)
      const symbols = [...new Set(positions.map((p) => p.symbol))]
      const prices = symbols.length ? await fetchLivePrices(symbols) : {}

      let nav = cash
      for (const pos of positions) {
        const livePrice = prices[pos.symbol.toUpperCase()]
        nav += livePrice !== undefined ? pos.quantity * livePrice : (pos.market_value ?? 0)
      }

      // Upsert DailyEquity
      await prisma.dailyEquity.upsert({
        where: {
          userId_accountNumber_date: {
            userId: sync.userId,
            accountNumber: sync.accountId,
            date: snapshotDate,
          },
        },
        create: { userId: sync.userId, accountNumber: sync.accountId, date: snapshotDate, equity: nav, cash },
        update: { equity: nav, cash },
      })

      // Sync today's trades
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
        console.error('[ManualSnapshot] trade sync error:', err)
      }

      await prisma.synchronization.update({
        where: { id: sync.id },
        data: { lastSyncedAt: new Date(), needsReauth: false },
      })

      results.push({
        accountId: sync.accountId,
        nav: Math.round(nav * 100) / 100,
        positions: positions.length,
        tradesSaved,
      })
    }

    return NextResponse.json({ date: todayKey, results })
  } catch (err) {
    console.error('[ManualSnapshot]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
