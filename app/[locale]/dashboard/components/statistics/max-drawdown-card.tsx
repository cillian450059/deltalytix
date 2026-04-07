'use client'

import { useData } from "@/context/data-provider"
import { Card } from "@/components/ui/card"
import { TrendingDown, HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

function drawdownColor(pct: number) {
  if (pct <= 5)  return "text-green-500"
  if (pct <= 15) return "text-yellow-500"
  if (pct <= 30) return "text-orange-400"
  return "text-red-500"
}

export default function MaxDrawdownCard() {
  const { advancedStatistics: { maxDrawdown, maxDrawdownPct } } = useData()

  const color = drawdownColor(maxDrawdownPct)

  return (
    <Card className="h-full">
      <div className="flex items-center justify-center h-full gap-1.5">
        <TrendingDown className={cn("h-3 w-3", color)} />
        <span className="text-xs text-muted-foreground">Max DD</span>
        <div className={cn("font-semibold text-base font-mono tabular-nums", color)}>
          ${maxDrawdown.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <span className={cn("text-xs font-mono tabular-nums", color)}>
          ({maxDrawdownPct.toFixed(1)}%)
        </span>
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={5} className="max-w-[280px]">
              Maximum peak-to-trough decline of the cumulative net P&L curve across the selected trades. Colour: green ≤5%, yellow ≤15%, orange ≤30%, red &gt;30%.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </Card>
  )
}
