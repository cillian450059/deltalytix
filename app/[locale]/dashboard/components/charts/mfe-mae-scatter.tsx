"use client";

import * as React from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useData } from "@/context/data-provider";
import { useTradeAnalyticsStore } from "@/store/widgets/trade-analytics-store";
import { getTradeAnalyticsAction } from "@/server/trade-analytics";
import type { TradeAnalyticsPoint } from "@/server/trade-analytics";
import { WidgetSize } from "@/app/[locale]/dashboard/types/dashboard";
import { Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ColorMode = "winLoss" | "efficiency" | "instrument"

interface MfeMaeScatterProps {
  size?: WidgetSize
}

// ── helpers ───────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function efficiencyColor(eff: number | null): string {
  if (eff === null) return "hsl(217,91%,60%)"
  if (eff >= 70) return "hsl(142,71%,45%)"
  if (eff >= 40) return "hsl(45,93%,47%)"
  return "hsl(0,84%,60%)"
}

// Fixed palette for up to 10 instruments
const INSTRUMENT_COLORS = [
  "hsl(217,91%,60%)", "hsl(142,71%,45%)", "hsl(45,93%,47%)",
  "hsl(271,81%,56%)", "hsl(0,84%,60%)",   "hsl(190,80%,50%)",
  "hsl(20,90%,55%)",  "hsl(300,70%,55%)", "hsl(160,70%,45%)",
  "hsl(60,80%,45%)",
]

// ── Custom tooltip ────────────────────────────────────────────────────────────

function ScatterTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d: TradeAnalyticsPoint = payload[0]?.payload
  if (!d) return null

  const pnlColor = d.pnl >= 0 ? "text-green-500" : "text-red-500"

  return (
    <div className="rounded-lg border bg-background p-2.5 shadow-md text-xs space-y-0.5 min-w-[170px]">
      <div className="font-semibold text-sm">{d.instrument}</div>
      <div className="text-muted-foreground">{d.entryDate} · {d.side}</div>
      <div className="border-t pt-1 mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
        <span className="text-muted-foreground">P&L</span>
        <span className={cn("text-right font-mono", pnlColor)}>
          {d.pnl >= 0 ? "+" : ""}${fmt(d.pnl)}
        </span>
        <span className="text-muted-foreground">MAE</span>
        <span className="text-right font-mono">{fmt(d.mae)}</span>
        <span className="text-muted-foreground">MFE</span>
        <span className="text-right font-mono">{fmt(d.mfe)}</span>
        {d.efficiency !== null && (
          <>
            <span className="text-muted-foreground">Efficiency</span>
            <span className="text-right font-mono">{d.efficiency.toFixed(1)}%</span>
          </>
        )}
        {d.riskRewardRatio !== null && (
          <>
            <span className="text-muted-foreground">MFE/MAE</span>
            <span className="text-right font-mono">{d.riskRewardRatio.toFixed(2)}</span>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MfeMaeScatter({ size = "medium" }: MfeMaeScatterProps) {
  const { formattedTrades } = useData()
  const { analytics, isLoading, loaded, setAnalytics, setIsLoading } =
    useTradeAnalyticsStore()

  const [colorMode, setColorMode] = React.useState<ColorMode>("winLoss")

  // ── Fetch analytics once per session ──────────────────────────────────────
  React.useEffect(() => {
    if (loaded) return
    setIsLoading(true)
    getTradeAnalyticsAction()
      .then(setAnalytics)
      .catch(() => setIsLoading(false))
  }, [loaded, setAnalytics, setIsLoading])

  // ── Intersect with filtered trades ────────────────────────────────────────
  const points = React.useMemo(() => {
    const tradeSet = new Set(formattedTrades.map(t => t.id))
    return analytics.filter(a => tradeSet.has(a.tradeId))
  }, [formattedTrades, analytics])

  // ── Instrument colour index ────────────────────────────────────────────────
  const instrumentIndex = React.useMemo(() => {
    const idx = new Map<string, number>()
    let i = 0
    for (const p of points) {
      if (!idx.has(p.instrument)) idx.set(p.instrument, i++ % INSTRUMENT_COLORS.length)
    }
    return idx
  }, [points])

  // ── Stats summary ─────────────────────────────────────────────────────────
  const summary = React.useMemo(() => {
    if (!points.length) return null
    const avgMae = points.reduce((s, p) => s + p.mae, 0) / points.length
    const avgMfe = points.reduce((s, p) => s + p.mfe, 0) / points.length
    const effPoints = points.filter(p => p.efficiency !== null)
    const avgEff = effPoints.length
      ? effPoints.reduce((s, p) => s + p.efficiency!, 0) / effPoints.length
      : null
    return { avgMae, avgMfe, avgEff, count: points.length }
  }, [points])

  const maxVal = React.useMemo(
    () => Math.max(...points.map(p => Math.max(p.mae, p.mfe)), 1),
    [points]
  )

  const isSmall = size === "small" || size === "tiny"

  const getColor = (p: TradeAnalyticsPoint): string => {
    if (colorMode === "winLoss") return p.pnl >= 0 ? "hsl(142,71%,45%)" : "hsl(0,84%,60%)"
    if (colorMode === "efficiency") return efficiencyColor(p.efficiency)
    return INSTRUMENT_COLORS[instrumentIndex.get(p.instrument) ?? 0]
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className={isSmall ? "pb-1 pt-3 px-3" : "pb-2"}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <CardTitle className={isSmall ? "text-sm" : "text-base"}>MFE / MAE</CardTitle>
            <TooltipProvider delayDuration={100}>
              <UITooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[280px] text-xs leading-relaxed">
                  <p><strong>X-axis (MAE)</strong>: How far the trade moved <em>against</em> you before closing.</p>
                  <p className="mt-1"><strong>Y-axis (MFE)</strong>: How far the trade moved <em>in your favour</em> before closing.</p>
                  <p className="mt-1">Points above the diagonal had more favourable excursion than adverse — your stop had room. Points below left profit on the table.</p>
                  <p className="mt-1">Computed from 1-minute OHLC bars via Databento (futures only).</p>
                </TooltipContent>
              </UITooltip>
            </TooltipProvider>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Summary stats */}
            {summary && !isSmall && (
              <div className="flex gap-3 text-xs text-muted-foreground mr-1">
                <span>Avg MAE <span className="text-foreground font-mono">{fmt(summary.avgMae)}</span></span>
                <span>Avg MFE <span className="text-foreground font-mono">{fmt(summary.avgMfe)}</span></span>
                {summary.avgEff !== null && (
                  <span>Efficiency <span className="text-foreground font-mono">{summary.avgEff.toFixed(1)}%</span></span>
                )}
              </div>
            )}
            <Select value={colorMode} onValueChange={v => setColorMode(v as ColorMode)}>
              <SelectTrigger className="h-7 text-xs w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="winLoss"     className="text-xs">Win / Loss</SelectItem>
                <SelectItem value="efficiency"  className="text-xs">Efficiency</SelectItem>
                <SelectItem value="instrument"  className="text-xs">Instrument</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent className={`flex-1 min-h-0 ${isSmall ? "px-2 pb-2" : "px-4 pb-4"}`}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading analytics…
          </div>
        ) : points.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 px-4">
            <p className="text-xs text-muted-foreground">
              No MFE/MAE data for the selected trades.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Analytics are computed weekly from 1-minute OHLC bars (Databento) for futures trades.
              Make sure <code className="bg-muted px-1 rounded">DATABENTO_API_KEY</code> is set and the weekly cron has run.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
              <XAxis
                type="number"
                dataKey="mae"
                name="MAE"
                domain={[0, maxVal * 1.05]}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                label={{ value: "MAE (pts)", position: "insideBottomRight", offset: -4, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                type="number"
                dataKey="mfe"
                name="MFE"
                domain={[0, maxVal * 1.05]}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={50}
                label={{ value: "MFE (pts)", angle: -90, position: "insideLeft", offset: 10, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: "3 3" }} />

              {/* y = x diagonal: trades above this had more MFE than MAE */}
              <ReferenceLine
                segment={[{ x: 0, y: 0 }, { x: maxVal, y: maxVal }]}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                strokeOpacity={0.4}
                label={{ value: "MFE = MAE", position: "insideTopLeft", fontSize: 10, fill: "hsl(var(--muted-foreground))", opacity: 0.5 }}
              />

              {/* Average MAE vertical reference */}
              {summary && (
                <ReferenceLine
                  x={summary.avgMae}
                  stroke="hsl(217,91%,60%)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                  label={{ value: "Avg MAE", position: "top", fontSize: 9, fill: "hsl(217,91%,60%)", opacity: 0.7 }}
                />
              )}

              <Scatter data={points} isAnimationActive={false}>
                {points.map((p, i) => (
                  <Cell key={p.tradeId} fill={getColor(p)} fillOpacity={0.75} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
