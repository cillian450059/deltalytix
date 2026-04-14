/**
 * POST /api/firstrade/sync-trades?days=365
 *
 * Sync Firstrade trade history using stored session token (no re-login needed).
 * Uses the same encrypted cookie approach as market-close-snapshot cron.
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
    signal: AbortSignal.timeout(60_000),
  })
  return r.json()
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id

    const { searchParams } = new URL(request.url)
    const days = Math.min(parseInt(searchParams.get('days') ?? '365'), 1825)

    const syncs = await prisma.synchronization.findMany({
      where: { service: 'firstrade', userId },
    })

    if (!syncs.length) {
      return NextResponse.json({ error: 'No Firstrade sync configured' }, { status: 404 })
    }

    type SyncResult = {
      accountId: string
      savedCount?: number
      tradesCount?: number
      error?: string
    }
    const results: SyncResult[] = []

    for (const sync of syncs) {
      if (!sync.token) {
        await prisma.synchronization.update({ where: { id: sync.id }, data: { needsReauth: true } })
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

      // Restore session from stored cookies
      const importRes = await ftPost('/session-import', sessionData).catch(() => null)
      if (!importRes?.success || !importRes.session_id) {
        await prisma.synchronization.update({ where: { id: sync.id }, data: { needsReauth: true } })
        results.push({ accountId: sync.accountId, error: 'session_expired' })
        continue
      }

      const sessionId: string = importRes.session_id

      // Fetch transactions
      const txRes = await ftPost('/transactions', { session_id: sessionId, days }).catch(() => null)
      if (!txRes) {
        results.push({ accountId: sync.accountId, error: 'transactions_failed' })
        continue
      }

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
          userId,
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
          userId,
          tags: ['firstrade', cf.type],
        } as Partial<Trade>
      })

      const allTrades = [...trades, ...cashflows]
      let savedCount = 0
      if (allTrades.length > 0) {
        const saved = await saveTradesAction(allTrades as Trade[])
        savedCount = saved.numberOfTradesAdded
      }

      await prisma.synchronization.update({
        where: { id: sync.id },
        data: { lastSyncedAt: new Date(), needsReauth: false },
      })

      results.push({
        accountId: sync.accountId,
        savedCount,
        tradesCount: allTrades.length,
      })
    }

    return NextResponse.json({ days, results })
  } catch (err) {
    console.error('[SyncTrades]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
