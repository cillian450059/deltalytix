/**
 * Monte Carlo simulation engine for trading equity curves.
 *
 * Algorithm:
 *   For each simulation, randomly resample (bootstrap) the historical P&L
 *   sequence, build an equity curve, and record key risk metrics.
 *   Percentile bands over all simulations give a forward-looking confidence
 *   envelope.
 */

export interface MonteCarloParams {
  /** Number of simulation runs (default 5000) */
  nSimulations: number
  /** Trades per simulation (default = historical trade count) */
  nTrades: number
  /** Ruin threshold as fraction of initial capital, e.g. -0.5 = –50% */
  ruinThreshold: number
  /** bootstrap = sample with replacement; reshuffle = random permutation */
  method: 'bootstrap' | 'reshuffle'
  /** Starting portfolio value in USD */
  initialCapital: number
}

export interface PercentileStats {
  mean: number
  p5: number
  p25: number
  p50: number
  p75: number
  p95: number
}

export interface MonteCarloResult {
  // ── Equity curve bands ──────────────────────────────────────────────────
  /** x-axis values (trade indices, sampled at CURVE_RESOLUTION intervals) */
  tradeIndices: number[]
  equityP5: number[]
  equityP25: number[]
  equityP50: number[]
  equityP75: number[]
  equityP95: number[]
  /** Equity curve built from the original historical sequence */
  originalCurve: number[]

  // ── Final-return distribution (all simulations) ─────────────────────────
  /** Final return % for every simulation (for histogram) */
  finalReturns: number[]
  finalReturnStats: PercentileStats

  // ── Max-drawdown distribution ───────────────────────────────────────────
  /** Max drawdown % for every simulation */
  maxDrawdowns: number[]
  maxDrawdownStats: PercentileStats

  // ── Risk summary ────────────────────────────────────────────────────────
  /** Fraction (0–100) of simulations that hit the ruin threshold */
  ruinProbability: number

  // ── Metadata ────────────────────────────────────────────────────────────
  nSimulations: number
  nTrades: number
  initialCapital: number
  durationMs: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Return the p-th percentile of a **sorted** array (0–100). */
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[idx]
}

function buildStats(values: number[]): PercentileStats {
  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  return { mean, p5: pct(sorted, 5), p25: pct(sorted, 25), p50: pct(sorted, 50), p75: pct(sorted, 75), p95: pct(sorted, 95) }
}

/** Build a Fisher-Yates shuffle of indices 0..n-1 */
function shuffle(n: number): Uint32Array {
  const arr = new Uint32Array(n)
  for (let i = 0; i < n; i++) arr[i] = i
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
  }
  return arr
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Run a full Monte Carlo simulation on a set of historical trade P&L values.
 *
 * @param pnls          Array of per-trade net P&L in dollars (closed trades only).
 * @param params        Simulation parameters.
 */
export function runMonteCarloSimulation(
  pnls: number[],
  params: MonteCarloParams,
): MonteCarloResult {
  const t0 = performance.now()
  const { nSimulations, nTrades, ruinThreshold, method, initialCapital } = params
  const ruinLevel = initialCapital * (1 + ruinThreshold) // e.g. 50 000 for -50%
  const n = pnls.length

  // Typed array for fast random access
  const pnlBuf = new Float64Array(pnls)

  // Resolution: max 200 points on the equity curve axis
  const CURVE_RES = Math.min(200, nTrades)
  const step = Math.max(1, Math.floor(nTrades / CURVE_RES))
  const curveLen = Math.ceil(nTrades / step) + 1 // +1 for t=0

  // Allocate curve storage: [sim][t]
  // Flat array: allCurves[sim * curveLen + t]
  const allCurves = new Float64Array(nSimulations * curveLen)

  const finalEquities = new Float64Array(nSimulations)
  const maxDrawdownsFrac = new Float64Array(nSimulations) // 0–1
  let ruinCount = 0

  for (let sim = 0; sim < nSimulations; sim++) {
    const base = sim * curveLen
    allCurves[base] = initialCapital

    let equity = initialCapital
    let peak = initialCapital
    let maxDD = 0
    let ruined = false
    let curveIdx = 1

    if (method === 'bootstrap') {
      // With replacement
      for (let i = 0; i < nTrades; i++) {
        equity += pnlBuf[Math.floor(Math.random() * n)]
        if (equity > peak) peak = equity
        const dd = peak > 0 ? (peak - equity) / peak : 0
        if (dd > maxDD) maxDD = dd
        if (!ruined && equity <= ruinLevel) { ruined = true; ruinCount++ }
        if ((i + 1) % step === 0 || i === nTrades - 1) {
          allCurves[base + curveIdx++] = equity
        }
      }
    } else {
      // Without replacement (reshuffle) — repeat cycles if nTrades > n
      let remaining = nTrades
      let tradeCount = 0
      while (remaining > 0) {
        const batchSize = Math.min(remaining, n)
        const order = shuffle(n)
        for (let k = 0; k < batchSize; k++) {
          equity += pnlBuf[order[k]]
          if (equity > peak) peak = equity
          const dd = peak > 0 ? (peak - equity) / peak : 0
          if (dd > maxDD) maxDD = dd
          if (!ruined && equity <= ruinLevel) { ruined = true; ruinCount++ }
          tradeCount++
          if (tradeCount % step === 0 || tradeCount === nTrades) {
            allCurves[base + curveIdx++] = equity
          }
        }
        remaining -= batchSize
      }
    }

    finalEquities[sim] = equity
    maxDrawdownsFrac[sim] = maxDD
  }

  // ── Build original curve from historical sequence ──────────────────────
  const originalCurve: number[] = [initialCapital]
  {
    let eq = initialCapital
    const limit = Math.min(nTrades, n)
    for (let i = 0; i < limit; i++) {
      eq += pnlBuf[i]
      if ((i + 1) % step === 0 || i === limit - 1) originalCurve.push(eq)
    }
  }

  // ── Compute percentile bands ────────────────────────────────────────────
  const equityP5: number[] = []
  const equityP25: number[] = []
  const equityP50: number[] = []
  const equityP75: number[] = []
  const equityP95: number[] = []
  const tradeIndices: number[] = []

  const colBuf = new Float64Array(nSimulations)
  for (let t = 0; t < curveLen; t++) {
    for (let sim = 0; sim < nSimulations; sim++) colBuf[sim] = allCurves[sim * curveLen + t]
    const sorted = Array.from(colBuf).sort((a, b) => a - b)
    equityP5.push(pct(sorted, 5))
    equityP25.push(pct(sorted, 25))
    equityP50.push(pct(sorted, 50))
    equityP75.push(pct(sorted, 75))
    equityP95.push(pct(sorted, 95))
    tradeIndices.push(t * step)
  }

  // ── Final return stats (%) ─────────────────────────────────────────────
  const finalReturns = Array.from(finalEquities).map(v => ((v - initialCapital) / initialCapital) * 100)
  const finalReturnStats = buildStats(finalReturns)

  // ── Max drawdown stats (%) ─────────────────────────────────────────────
  const maxDrawdowns = Array.from(maxDrawdownsFrac).map(v => v * 100)
  const maxDrawdownStats = buildStats(maxDrawdowns)

  return {
    tradeIndices,
    equityP5,
    equityP25,
    equityP50,
    equityP75,
    equityP95,
    originalCurve,
    finalReturns,
    finalReturnStats,
    maxDrawdowns,
    maxDrawdownStats,
    ruinProbability: (ruinCount / nSimulations) * 100,
    nSimulations,
    nTrades,
    initialCapital,
    durationMs: performance.now() - t0,
  }
}

/** Bucket an array of values into N histogram bins. */
export function buildHistogram(
  values: number[],
  nBins = 50,
): { x: number; count: number; pct: number }[] {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const binSize = range / nBins

  const bins = Array.from({ length: nBins }, (_, i) => ({
    x: min + (i + 0.5) * binSize,
    lo: min + i * binSize,
    hi: min + (i + 1) * binSize,
    count: 0,
    pct: 0,
  }))

  for (const v of values) {
    const idx = Math.min(nBins - 1, Math.floor((v - min) / binSize))
    bins[idx].count++
  }

  const total = values.length
  for (const b of bins) b.pct = (b.count / total) * 100

  return bins
}
