"use client";

import * as React from "react";
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useData } from "@/context/data-provider";
import { calculateRollingStatistics, type RollingDataPoint } from "@/lib/advanced-statistics";
import { WidgetSize } from "@/app/[locale]/dashboard/types/dashboard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Info } from "lucide-react";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Metric = "rollingWinRate" | "rollingExpectancy" | "rollingProfitFactor" | "rollingSharpe"

interface MetricConfig {
  label: string
  unit: string
  refLine?: number
  color: string
  format: (v: number) => string
}

const METRICS: Record<Metric, MetricConfig> = {
  rollingWinRate:      { label: "Win Rate",      unit: "%",  refLine: 50,  color: "hsl(217, 91%, 60%)", format: v => `${v.toFixed(1)}%`    },
  rollingExpectancy:   { label: "Expectancy",    unit: "$",  refLine: 0,   color: "hsl(142, 71%, 45%)", format: v => `$${v.toFixed(2)}`   },
  rollingProfitFactor: { label: "Profit Factor", unit: "",   refLine: 1,   color: "hsl(45, 93%, 47%)",  format: v => v.toFixed(2)          },
  rollingSharpe:       { label: "Sharpe",        unit: "",   refLine: 0,   color: "hsl(271, 81%, 56%)", format: v => v.toFixed(3)          },
}

const WINDOWS = [10, 20, 50, 100]

interface RollingStatisticsChartProps {
  size?: WidgetSize
}

const formatCurrency = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })

export default function RollingStatisticsChart({ size = "medium" }: RollingStatisticsChartProps) {
  const { formattedTrades } = useData()

  const [metric, setMetric]   = React.useState<Metric>("rollingExpectancy")
  const [window_, setWindow_] = React.useState<number>(20)

  const data: RollingDataPoint[] = React.useMemo(
    () => calculateRollingStatistics(formattedTrades, window_),
    [formattedTrades, window_]
  )

  const cfg = METRICS[metric]

  const CustomTooltip = React.useCallback(({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="rounded-lg border bg-background p-2 shadow-sm text-xs">
        <div className="text-muted-foreground mb-1">{label}</div>
        <div className="font-semibold" style={{ color: cfg.color }}>
          {cfg.label}: {cfg.format(payload[0]?.value ?? 0)}
        </div>
        <div className="text-muted-foreground text-[10px] mt-0.5">Trade #{payload[0]?.payload?.tradeIndex + 1}</div>
      </div>
    )
  }, [cfg])

  const isSmall = size === "small" || size === "tiny"
  const isEmpty = data.length === 0

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className={isSmall ? "pb-1 pt-3 px-3" : "pb-2"}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <CardTitle className={isSmall ? "text-sm" : "text-base"}>Rolling Statistics</CardTitle>
            <TooltipProvider delayDuration={100}>
              <UITooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px]">
                  Sliding-window metric computed over the last N trades at each point. Reveals whether your edge is improving, degrading, or stable over time.
                </TooltipContent>
              </UITooltip>
            </TooltipProvider>
          </div>
          <div className="flex gap-1.5">
            <Select value={metric} onValueChange={v => setMetric(v as Metric)}>
              <SelectTrigger className="h-7 text-xs w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(METRICS) as Metric[]).map(k => (
                  <SelectItem key={k} value={k} className="text-xs">{METRICS[k].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(window_)} onValueChange={v => setWindow_(Number(v))}>
              <SelectTrigger className="h-7 text-xs w-[70px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOWS.map(w => (
                  <SelectItem key={w} value={String(w)} className="text-xs">N={w}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent className={`flex-1 min-h-0 ${isSmall ? "px-2 pb-2" : "px-4 pb-4"}`}>
        {isEmpty ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            Need at least {window_} trades to display rolling statistics.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={cfg.format}
                width={55}
              />
              <Tooltip content={<CustomTooltip />} />
              {cfg.refLine !== undefined && (
                <ReferenceLine
                  y={cfg.refLine}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                />
              )}
              <Line
                type="monotone"
                dataKey={metric}
                stroke={cfg.color}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
