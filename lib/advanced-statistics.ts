/**
 * Advanced trading statistics — extends the basic StatisticsProps with
 * deeper analytical metrics: Expectancy, Sharpe, Sortino, Max Drawdown,
 * streak analysis, rolling windows, and group-by breakdowns.
 *
 * All functions are pure (no side effects) and accept the already-filtered
 * formattedTrades array from DataContext, so every existing filter
 * (date range, account, tag, weekday…) automatically applies.
 */

import type { Trade } from "@/prisma/generated/prisma/client"

// ── Core advanced stats object ────────────────────────────────────────────────

export interface AdvancedStatistics {
  // Per-trade expected value (net of commission)
  expectancy: number        // $ per trade = winRate × avgWin − lossRate × avgLoss

  // Risk-adjusted return ratios (per-trade, not annualised)
  sharpeRatio: number       // avgNetReturn / stdDev
  sortinoRatio: number      // avgNetReturn / downside stdDev

  // Drawdown (on cumulative net P&L series)
  maxDrawdown: number       // $ peak-to-trough
  maxDrawdownPct: number    // % of peak

  // Streak analysis
  maxConsecutiveWins: number
  maxConsecutiveLosses: number
  currentWinStreak: number   // trailing wins right now
  currentLossStreak: number  // trailing losses right now

  // Per-trade net averages
  avgWinNet: number          // avg winning trade net P&L ($)
  avgLossNet: number         // avg losing trade absolute net P&L ($, positive)
  avgTradeNet: number        // avg P&L per trade net of commission

  // Daily aggregates (calendar-day level)
  profitableDays: number
  unprofitableDays: number
  avgProfitableDay: number   // avg net P&L on profitable days
  avgUnprofitableDay: number // avg absolute net P&L on unprofitable days (positive)
}

export function calculateAdvancedStatistics(trades: Trade[]): AdvancedStatistics {
  const empty: AdvancedStatistics = {
    expectancy: 0, sharpeRatio: 0, sortinoRatio: 0,
    maxDrawdown: 0, maxDrawdownPct: 0,
    maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
    currentWinStreak: 0, currentLossStreak: 0,
    avgWinNet: 0, avgLossNet: 0, avgTradeNet: 0,
    profitableDays: 0, unprofitableDays: 0,
    avgProfitableDay: 0, avgUnprofitableDay: 0,
  }
  if (!trades.length) return empty

  // Net return per trade (P&L minus commission)
  const returns = trades.map(t => t.pnl - t.commission)

  // ── Win / loss buckets ───────────────────────────────────────────────────
  const wins  = returns.filter(r => r > 0)
  const losses = returns.filter(r => r < 0)

  const avgWinNet  = wins.length  ? wins.reduce((s, r) => s + r, 0) / wins.length  : 0
  const avgLossNet = losses.length
    ? Math.abs(losses.reduce((s, r) => s + r, 0) / losses.length)
    : 0
  const avgTradeNet = returns.reduce((s, r) => s + r, 0) / returns.length

  // ── Expectancy ───────────────────────────────────────────────────────────
  const winRate  = wins.length  / returns.length
  const lossRate = losses.length / returns.length
  const expectancy = winRate * avgWinNet - lossRate * avgLossNet

  // ── Sharpe (per-trade, raw) ──────────────────────────────────────────────
  const variance = returns.reduce((s, r) => s + Math.pow(r - avgTradeNet, 2), 0) / returns.length
  const stdDev = Math.sqrt(variance)
  const sharpeRatio = stdDev > 0 ? avgTradeNet / stdDev : 0

  // ── Sortino (downside deviation only) ───────────────────────────────────
  const downsideVariance = losses.length
    ? losses.reduce((s, r) => s + Math.pow(r, 2), 0) / losses.length
    : 0
  const downsideDev = Math.sqrt(downsideVariance)
  const sortinoRatio = downsideDev > 0 ? avgTradeNet / downsideDev : 0

  // ── Max Drawdown on cumulative net P&L ──────────────────────────────────
  let running = 0
  let peak = 0
  let maxDrawdown = 0
  for (const r of returns) {
    running += r
    if (running > peak) peak = running
    const dd = peak - running
    if (dd > maxDrawdown) maxDrawdown = dd
  }
  const maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0

  // ── Streaks ──────────────────────────────────────────────────────────────
  let maxConsecutiveWins = 0
  let maxConsecutiveLosses = 0
  let cw = 0
  let cl = 0
  for (const r of returns) {
    if (r > 0) {
      cw++; cl = 0
      if (cw > maxConsecutiveWins) maxConsecutiveWins = cw
    } else if (r < 0) {
      cl++; cw = 0
      if (cl > maxConsecutiveLosses) maxConsecutiveLosses = cl
    }
  }

  // Trailing streaks (from the end of the series)
  let currentWinStreak = 0
  let currentLossStreak = 0
  for (let i = returns.length - 1; i >= 0; i--) {
    if (returns[i] > 0) currentWinStreak++
    else break
  }
  for (let i = returns.length - 1; i >= 0; i--) {
    if (returns[i] < 0) currentLossStreak++
    else break
  }

  // ── Daily aggregates ─────────────────────────────────────────────────────
  const byDay = new Map<string, number>()
  for (let i = 0; i < trades.length; i++) {
    const day = String(trades[i].entryDate).split('T')[0]
    byDay.set(day, (byDay.get(day) ?? 0) + returns[i])
  }
  const dayVals = [...byDay.values()]
  const profDays = dayVals.filter(v => v > 0)
  const lossDays = dayVals.filter(v => v < 0)
  const profitableDays   = profDays.length
  const unprofitableDays = lossDays.length
  const avgProfitableDay   = profDays.length
    ? profDays.reduce((s, v) => s + v, 0) / profDays.length
    : 0
  const avgUnprofitableDay = lossDays.length
    ? Math.abs(lossDays.reduce((s, v) => s + v, 0) / lossDays.length)
    : 0

  return {
    expectancy:        Math.round(expectancy * 100) / 100,
    sharpeRatio:       Math.round(sharpeRatio * 1000) / 1000,
    sortinoRatio:      Math.round(sortinoRatio * 1000) / 1000,
    maxDrawdown:       Math.round(maxDrawdown * 100) / 100,
    maxDrawdownPct:    Math.round(maxDrawdownPct * 100) / 100,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    currentWinStreak,
    currentLossStreak,
    avgWinNet:         Math.round(avgWinNet * 100) / 100,
    avgLossNet:        Math.round(avgLossNet * 100) / 100,
    avgTradeNet:       Math.round(avgTradeNet * 100) / 100,
    profitableDays,
    unprofitableDays,
    avgProfitableDay:   Math.round(avgProfitableDay * 100) / 100,
    avgUnprofitableDay: Math.round(avgUnprofitableDay * 100) / 100,
  }
}

// ── Rolling statistics ────────────────────────────────────────────────────────

export interface RollingDataPoint {
  date: string
  tradeIndex: number
  rollingWinRate: number        // %   (0–100)
  rollingExpectancy: number     // $ per trade
  rollingProfitFactor: number
  rollingSharpe: number
}

/**
 * Compute rolling statistics over a sliding window of `windowSize` trades.
 * Returns one data point per trade starting from trade #windowSize.
 */
export function calculateRollingStatistics(
  trades: Trade[],
  windowSize: number = 20
): RollingDataPoint[] {
  if (trades.length < windowSize) return []

  const points: RollingDataPoint[] = []

  for (let i = windowSize - 1; i < trades.length; i++) {
    const slice   = trades.slice(i - windowSize + 1, i + 1)
    const rets    = slice.map(t => t.pnl - t.commission)
    const wins    = rets.filter(r => r > 0)
    const losses  = rets.filter(r => r < 0)
    const grossW  = wins.reduce((s, r) => s + r, 0)
    const grossL  = Math.abs(losses.reduce((s, r) => s + r, 0))
    const avgW    = wins.length   ? grossW / wins.length   : 0
    const avgL    = losses.length ? grossL / losses.length : 0
    const wRate   = wins.length   / rets.length
    const lRate   = losses.length / rets.length
    const avg     = rets.reduce((s, r) => s + r, 0) / rets.length
    const std     = Math.sqrt(rets.reduce((s, r) => s + Math.pow(r - avg, 2), 0) / rets.length)

    points.push({
      date:                String(trades[i].entryDate).split('T')[0],
      tradeIndex:          i,
      rollingWinRate:      Math.round(wRate * 1000) / 10,
      rollingExpectancy:   Math.round((wRate * avgW - lRate * avgL) * 100) / 100,
      rollingProfitFactor: grossL > 0
        ? Math.round((grossW / grossL) * 100) / 100
        : grossW > 0 ? 99.99 : 1,
      rollingSharpe:       std > 0 ? Math.round((avg / std) * 1000) / 1000 : 0,
    })
  }

  return points
}

// ── Group-by statistics ───────────────────────────────────────────────────────

export interface GroupStatistics {
  groupName: string
  nbTrades: number
  winRate: number        // %
  expectancy: number     // $ per trade
  profitFactor: number
  netPnl: number         // total net P&L for this group
  avgWin: number         // $ (positive)
  avgLoss: number        // $ (positive, absolute value)
  sharpe: number
}

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** System tags that should be excluded from user-facing tag breakdown */
const SYSTEM_TAGS = new Set(['firstrade', 'dividend', 'deposit', 'withdrawal', 'fee', 'transfer', 'journal', 'interest'])

/**
 * Group trades and compute full statistics per group.
 * For 'tag': a trade with multiple tags appears in every relevant group.
 */
export function calculateGroupStatistics(
  trades: Trade[],
  groupBy: 'tag' | 'instrument' | 'weekday' | 'hour'
): GroupStatistics[] {
  const groups = new Map<string, Trade[]>()

  for (const trade of trades) {
    let keys: string[]

    if (groupBy === 'tag') {
      const userTags = (trade.tags ?? []).filter(t => !SYSTEM_TAGS.has(t))
      keys = userTags.length ? userTags : ['(no tag)']
    } else if (groupBy === 'instrument') {
      keys = [trade.instrument]
    } else if (groupBy === 'weekday') {
      keys = [WEEKDAY_LABELS[new Date(trade.entryDate).getDay()]]
    } else {
      const h = new Date(trade.entryDate).getHours()
      keys = [`${String(h).padStart(2, '0')}:00`]
    }

    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(trade)
    }
  }

  return [...groups.entries()]
    .map(([groupName, groupTrades]): GroupStatistics => {
      const rets   = groupTrades.map(t => t.pnl - t.commission)
      const wins   = rets.filter(r => r > 0)
      const losses = rets.filter(r => r < 0)
      const grossW = wins.reduce((s, r) => s + r, 0)
      const grossL = Math.abs(losses.reduce((s, r) => s + r, 0))
      const avgWin  = wins.length   ? grossW / wins.length   : 0
      const avgLoss = losses.length ? grossL / losses.length : 0
      const wRate   = wins.length   / rets.length
      const lRate   = losses.length / rets.length
      const avg     = rets.reduce((s, r) => s + r, 0) / rets.length
      const std     = Math.sqrt(rets.reduce((s, r) => s + Math.pow(r - avg, 2), 0) / rets.length)

      return {
        groupName,
        nbTrades:    groupTrades.length,
        winRate:     Math.round(wRate * 1000) / 10,
        expectancy:  Math.round((wRate * avgWin - lRate * avgLoss) * 100) / 100,
        profitFactor: grossL > 0
          ? Math.round((grossW / grossL) * 100) / 100
          : grossW > 0 ? 99.99 : 1,
        netPnl:  Math.round(rets.reduce((s, r) => s + r, 0) * 100) / 100,
        avgWin:  Math.round(avgWin  * 100) / 100,
        avgLoss: Math.round(avgLoss * 100) / 100,
        sharpe:  std > 0 ? Math.round((avg / std) * 1000) / 1000 : 0,
      }
    })
    .sort((a, b) => b.netPnl - a.netPnl)
}
