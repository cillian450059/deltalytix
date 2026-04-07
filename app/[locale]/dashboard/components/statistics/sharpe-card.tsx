'use client'

import { useData } from "@/context/data-provider"
import { Card } from "@/components/ui/card"
import { BarChart2, HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** Colour thresholds for per-trade Sharpe (not annualised). */
function sharpeColor(s: number) {
  if (s >= 0.5) return "text-green-500"
  if (s >= 0.2) return "text-yellow-500"
  if (s >= 0)   return "text-orange-400"
  return "text-red-500"
}

export default function SharpeCard() {
  const { advancedStatistics: { sharpeRatio, sortinoRatio } } = useData()

  return (
    <Card className="h-full">
      <div className="flex items-center justify-center h-full gap-1.5 flex-wrap">
        <BarChart2 className="h-3 w-3 text-blue-400" />
        <span className="text-xs text-muted-foreground">Sharpe</span>
        <div className={cn("font-semibold text-base font-mono tabular-nums", sharpeColor(sharpeRatio))}>
          {sharpeRatio.toFixed(3)}
        </div>
        <span className="text-xs text-muted-foreground">/ Sortino</span>
        <div className={cn("font-semibold text-base font-mono tabular-nums", sharpeColor(sortinoRatio))}>
          {sortinoRatio.toFixed(3)}
        </div>
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={5} className="max-w-[300px]">
              <p><strong>Sharpe</strong>: avg net return ÷ std dev of returns. Measures risk-adjusted performance per trade (not annualised).</p>
              <p className="mt-1"><strong>Sortino</strong>: same but uses only downside deviation — penalises losing trades only, not winning volatility.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </Card>
  )
}
