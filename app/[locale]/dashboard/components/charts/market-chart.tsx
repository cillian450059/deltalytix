"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"

// Market index symbols
const INDICES = [
  { symbol: "SPY", label: "S&P 500", color: "#22c55e" },
  { symbol: "QQQ", label: "NASDAQ", color: "#3b82f6" },
  { symbol: "SOXX", label: "SOX", color: "#eab308" },
] as const

type TimeRange = "1D" | "5D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y"

const TIME_RANGES: { key: TimeRange; label: string }[] = [
  { key: "1D", label: "1D" },
  { key: "5D", label: "5D" },
  { key: "1M", label: "1M" },
  { key: "3M", label: "3M" },
  { key: "6M", label: "6M" },
  { key: "YTD", label: "YTD" },
  { key: "1Y", label: "1Y" },
  { key: "5Y", label: "5Y" },
]

interface ChartPoint {
  date: string
  timestamp: number
  [key: string]: number | string
}

interface QuoteData {
  price: number
  change: number
  changePct: number
}

function getYahooRange(range: TimeRange): { range: string; interval: string } {
  switch (range) {
    case "1D": return { range: "1d", interval: "5m" }
    case "5D": return { range: "5d", interval: "15m" }
    case "1M": return { range: "1mo", interval: "1d" }
    case "3M": return { range: "3mo", interval: "1d" }
    case "6M": return { range: "6mo", interval: "1d" }
    case "YTD": return { range: "ytd", interval: "1d" }
    case "1Y": return { range: "1y", interval: "1wk" }
    case "5Y": return { range: "5y", interval: "1mo" }
  }
}

export default function MarketChart({ size }: { size?: string }) {
  const [timeRange, setTimeRange] = useState<TimeRange>("1M")
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visible, setVisible] = useState<Record<string, boolean>>({
    SPY: true,
    QQQ: true,
    SOXX: true,
  })

  const toggleVisibility = (symbol: string) => {
    setVisible((prev) => ({ ...prev, [symbol]: !prev[symbol] }))
  }

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const { range, interval } = getYahooRange(timeRange)
      const allData: ChartPoint[] = []
      const newQuotes: Record<string, QuoteData> = {}

      // Fetch all indices
      for (const idx of INDICES) {
        try {
          const url = `/api/market?symbol=${idx.symbol}&range=${range}&interval=${interval}`
          const resp = await fetch(url)
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const json = await resp.json()
          const result = json.chart?.result?.[0]
          if (!result) continue

          const timestamps = result.timestamp || []
          const closes = result.indicators?.quote?.[0]?.close || []
          const meta = result.meta || {}

          // Quote data
          const prevClose = meta.chartPreviousClose || meta.previousClose || closes[0] || 0
          const currentPrice = meta.regularMarketPrice || closes[closes.length - 1] || 0
          newQuotes[idx.symbol] = {
            price: currentPrice,
            change: currentPrice - prevClose,
            changePct: prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0,
          }

          // Normalize to percentage change from first close for multi-index chart
          const firstClose = closes.find((c: number | null) => c != null) || 1

          timestamps.forEach((ts: number, i: number) => {
            const close = closes[i]
            if (close == null) return
            const dateStr = timeRange === "1D" || timeRange === "5D"
              ? new Date(ts * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
              : new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })

            let point = allData.find((d) => d.timestamp === ts)
            if (!point) {
              point = { date: dateStr, timestamp: ts } as ChartPoint
              allData.push(point)
            }
            // Store raw price and normalized index (base 100)
            point[idx.symbol] = close
            point[`${idx.symbol}_idx`] = (close / firstClose) * 100
          })
        } catch (e) {
          console.error(`[MarketChart] Failed to fetch ${idx.symbol}:`, e)
        }
      }

      allData.sort((a, b) => a.timestamp - b.timestamp)
      setChartData(allData)
      setQuotes(newQuotes)
    } catch (e) {
      setError("Failed to load market data")
      console.error("[MarketChart] Error:", e)
    } finally {
      setIsLoading(false)
    }
  }, [timeRange])

  useEffect(() => {
    fetchData()
    if (timeRange === "1D" || timeRange === "5D") {
      const timer = setInterval(fetchData, 60_000)
      return () => clearInterval(timer)
    }
  }, [fetchData, timeRange])

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-card border border-border rounded-lg p-2 text-xs shadow-md">
        <div className="text-muted-foreground mb-1">{label}</div>
        {payload.map((entry: any) => {
          const symbol = entry.dataKey.replace('_idx', '')
          const idx = INDICES.find((i) => i.symbol === symbol)
          const rawPrice = entry.payload[symbol]
          const pctChange = typeof entry.value === 'number' ? entry.value - 100 : 0
          return (
            <div key={entry.dataKey} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="font-medium">{idx?.label}</span>
              <span>{typeof rawPrice === 'number' ? rawPrice.toFixed(2) : rawPrice}</span>
              <span className={cn(
                pctChange >= 0 ? "text-green-500" : "text-red-500"
              )}>
                {pctChange >= 0 ? "+" : ""}{pctChange.toFixed(2)}%
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 px-4 pt-4">
        {/* Index toggles */}
        <div className="flex flex-col gap-1">
          {INDICES.map((idx) => {
            const q = quotes[idx.symbol]
            const positive = q ? q.change >= 0 : true
            const isVisible = visible[idx.symbol]
            return (
              <button
                key={idx.symbol}
                className={cn(
                  "flex items-center gap-2 px-2 py-0.5 rounded-md text-xs font-medium transition-all",
                  isVisible ? "opacity-100" : "opacity-40"
                )}
                onClick={() => toggleVisibility(idx.symbol)}
              >
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: isVisible ? idx.color : "hsl(var(--muted-foreground))" }}
                />
                <span className="w-16 text-left">{idx.label}</span>
                {q ? (
                  <>
                    <span className="font-mono text-xs tabular-nums">
                      {q.price.toFixed(2)}
                    </span>
                    <span
                      className={cn(
                        "text-xs font-mono tabular-nums",
                        positive ? "text-green-500" : "text-red-500"
                      )}
                    >
                      {positive ? "+" : ""}{q.change.toFixed(2)} ({positive ? "+" : ""}{q.changePct.toFixed(2)}%)
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">--</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Time range buttons */}
        <div className="flex gap-0.5 mt-1">
          {TIME_RANGES.map((r) => (
            <Button
              key={r.key}
              variant={timeRange === r.key ? "secondary" : "ghost"}
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setTimeRange(r.key)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="flex-1 px-2 pb-2 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {error}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={50}
                scale="log"
                domain={["auto", "auto"]}
                allowDataOverflow
                tickFormatter={(v) => {
                  const pct = v - 100
                  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
                }}
              />
              <RechartsTooltip content={<CustomTooltip />} />
              {INDICES.map((idx) => (
                visible[idx.symbol] && (
                  <Line
                    key={idx.symbol}
                    type="monotone"
                    dataKey={`${idx.symbol}_idx`}
                    name={idx.label}
                    stroke={idx.color}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3 }}
                    connectNulls
                  />
                )
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
