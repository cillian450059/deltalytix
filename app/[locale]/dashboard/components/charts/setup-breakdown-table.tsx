"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useData } from "@/context/data-provider";
import { calculateGroupStatistics, type GroupStatistics } from "@/lib/advanced-statistics";
import { WidgetSize } from "@/app/[locale]/dashboard/types/dashboard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ArrowUpDown, Info } from "lucide-react";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type GroupBy = "tag" | "instrument" | "weekday" | "hour"
type SortKey = keyof Omit<GroupStatistics, "groupName">
type SortDir = "asc" | "desc"

const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "tag",        label: "Tag / Setup"  },
  { value: "instrument", label: "Instrument"   },
  { value: "weekday",    label: "Day of Week"  },
  { value: "hour",       label: "Hour of Day"  },
]

const COLUMNS: { key: SortKey; label: string; format: (v: number) => string }[] = [
  { key: "nbTrades",    label: "Trades",  format: v => String(v)                              },
  { key: "winRate",     label: "Win%",    format: v => `${v.toFixed(1)}%`                     },
  { key: "expectancy",  label: "Exp $",   format: v => `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`},
  { key: "profitFactor",label: "PF",      format: v => v === 99.99 ? "∞" : v.toFixed(2)      },
  { key: "netPnl",      label: "Net P&L", format: v => `${v >= 0 ? "+" : ""}$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
  { key: "avgWin",      label: "Avg Win", format: v => `$${v.toFixed(2)}`                     },
  { key: "avgLoss",     label: "Avg Loss",format: v => `$${v.toFixed(2)}`                     },
  { key: "sharpe",      label: "Sharpe",  format: v => v.toFixed(3)                           },
]

function pnlColor(v: number) {
  if (v > 0)  return "text-green-500"
  if (v < 0)  return "text-red-500"
  return "text-muted-foreground"
}

interface SetupBreakdownTableProps {
  size?: WidgetSize
}

export default function SetupBreakdownTable({ size = "medium" }: SetupBreakdownTableProps) {
  const { formattedTrades } = useData()

  const [groupBy, setGroupBy]   = React.useState<GroupBy>("tag")
  const [sortKey, setSortKey]   = React.useState<SortKey>("netPnl")
  const [sortDir, setSortDir]   = React.useState<SortDir>("desc")

  const rows: GroupStatistics[] = React.useMemo(
    () => calculateGroupStatistics(formattedTrades, groupBy),
    [formattedTrades, groupBy]
  )

  const sorted = React.useMemo(() => {
    return [...rows].sort((a, b) => {
      const va = a[sortKey] as number
      const vb = b[sortKey] as number
      return sortDir === "desc" ? vb - va : va - vb
    })
  }, [rows, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === "desc" ? "asc" : "desc")
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const isSmall = size === "small" || size === "tiny"

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className={isSmall ? "pb-1 pt-3 px-3" : "pb-2"}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <CardTitle className={isSmall ? "text-sm" : "text-base"}>Setup Breakdown</CardTitle>
            <TooltipProvider delayDuration={100}>
              <UITooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px]">
                  Full statistics per group. Use tags to categorise your setups (e.g. "breakout", "reversal") and see which have the best edge. Click column headers to sort.
                </TooltipContent>
              </UITooltip>
            </TooltipProvider>
          </div>
          <Select value={groupBy} onValueChange={v => setGroupBy(v as GroupBy)}>
            <SelectTrigger className="h-7 text-xs w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUP_BY_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className={`flex-1 min-h-0 overflow-auto ${isSmall ? "px-2 pb-2" : "px-3 pb-3"}`}>
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            No trades to display.
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1.5 px-1 text-muted-foreground font-medium sticky left-0 bg-card">
                  {GROUP_BY_OPTIONS.find(o => o.value === groupBy)?.label}
                </th>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    className="text-right py-1.5 px-1 text-muted-foreground font-medium cursor-pointer select-none whitespace-nowrap"
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {col.label}
                      <ArrowUpDown className={cn(
                        "h-2.5 w-2.5",
                        sortKey === col.key ? "text-foreground" : "opacity-30"
                      )} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr
                  key={row.groupName}
                  className={cn(
                    "border-b border-border/50 hover:bg-muted/30 transition-colors",
                    i % 2 === 0 ? "" : "bg-muted/10"
                  )}
                >
                  <td className="py-1.5 px-1 font-medium max-w-[120px] truncate sticky left-0 bg-inherit">
                    {row.groupName}
                  </td>
                  {COLUMNS.map(col => {
                    const val = row[col.key] as number
                    const isMonetary = ["expectancy", "netPnl"].includes(col.key)
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          "text-right py-1.5 px-1 font-mono tabular-nums",
                          isMonetary ? pnlColor(val) : "text-foreground"
                        )}
                      >
                        {col.format(val)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
