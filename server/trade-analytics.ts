'use server'

import { prisma } from '@/lib/prisma'
import { getUserId } from '@/server/auth'

export interface TradeAnalyticsPoint {
  tradeId:         string
  mae:             number   // Max Adverse Excursion — price points against position
  mfe:             number   // Max Favorable Excursion — price points in favor
  riskRewardRatio: number | null
  efficiency:      number | null  // pnl / mfe × 100  (how much of the favorable move was captured)
  // Joined from Trade
  instrument: string
  entryDate:  string   // ISO date string
  pnl:        number
  side:       string
}

/**
 * Fetch all computed MFE/MAE analytics for the current user's trades.
 *
 * Only returns rows where both mae > 0 and mfe > 0 (i.e. successfully computed).
 * The caller is responsible for intersecting with formattedTrades to respect
 * dashboard filters (date range, account, instrument, tags, etc.).
 */
export async function getTradeAnalyticsAction(): Promise<TradeAnalyticsPoint[]> {
  const userId = await getUserId()

  // Use a raw JOIN query — TradeAnalytics has no explicit Prisma relation to Trade,
  // and this avoids a large IN clause over thousands of trade IDs.
  const rows = await prisma.$queryRaw<Array<{
    tradeId:         string
    mae:             number | string
    mfe:             number | string
    riskRewardRatio: number | string | null
    efficiency:      number | string | null
    instrument:      string
    entryDate:       string
    pnl:             number | string
    side:            string
  }>>`
    SELECT
      ta."tradeId",
      ta.mae,
      ta.mfe,
      ta."riskRewardRatio",
      ta.efficiency,
      t.instrument,
      t."entryDate"::text AS "entryDate",
      t.pnl,
      t.side
    FROM "TradeAnalytics" ta
    JOIN "Trade"           t  ON t.id = ta."tradeId"
    WHERE t."userId" = ${userId}
      AND ta.mae > 0
      AND ta.mfe > 0
    ORDER BY t."entryDate" ASC
  `

  return rows.map(r => ({
    tradeId:         r.tradeId,
    mae:             Number(r.mae),
    mfe:             Number(r.mfe),
    riskRewardRatio: r.riskRewardRatio !== null ? Number(r.riskRewardRatio) : null,
    efficiency:      r.efficiency      !== null ? Number(r.efficiency)      : null,
    instrument:      r.instrument,
    entryDate:       String(r.entryDate).split('T')[0],
    pnl:             Number(r.pnl),
    side:            r.side,
  }))
}
