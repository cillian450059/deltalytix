/**
 * Fetch official 4 PM ET closing prices from Yahoo Finance.
 *
 * Uses range=1d&interval=1d&includePrePost=false so the `close` value in the
 * OHLC bar is always the official market-close price, unaffected by AH trading.
 *
 * Call this AFTER 4:05 PM ET (21:05 UTC) so Yahoo has published the close bar.
 */

const YF_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'

/**
 * Fetch closing prices for one symbol.
 * Returns null if the market was closed today (holiday / no data).
 */
async function fetchOneClose(symbol: string): Promise<number | null> {
  const url = `${YF_BASE}/${encodeURIComponent(symbol)}?range=1d&interval=1d&includePrePost=false`
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store', // always fresh — cron job, not user-facing
    })
    if (!resp.ok) return null

    const data = await resp.json()
    const result = data?.chart?.result?.[0]
    if (!result) return null

    // Walk the OHLC close array in reverse to find the last non-null value.
    // This is the official 4 PM close — includePrePost=false ensures no AH bar.
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] !== null && closes[i] !== undefined) return closes[i] as number
    }
    return null
  } catch {
    return null
  }
}

/**
 * Batch-fetch closing prices for multiple symbols.
 * Missing / errored symbols are omitted from the returned record.
 *
 * @param symbols  Array of ticker symbols, e.g. ['AAPL', 'MSFT', 'NVDA']
 * @returns        Map of symbol → official close price
 */
export async function fetchClosingPrices(
  symbols: string[]
): Promise<Record<string, number>> {
  if (!symbols.length) return {}

  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))]

  const results = await Promise.allSettled(
    unique.map(async (sym) => {
      const price = await fetchOneClose(sym)
      return { sym, price }
    })
  )

  const prices: Record<string, number> = {}
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.price !== null) {
      prices[r.value.sym] = r.value.price
    }
  }
  return prices
}
