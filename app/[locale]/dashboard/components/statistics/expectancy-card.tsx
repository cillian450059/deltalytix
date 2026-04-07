'use client'

import { useData } from "@/context/data-provider"
import { Card } from "@/components/ui/card"
import { TrendingUp, HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export default function ExpectancyCard() {
  const { advancedStatistics: { expectancy } } = useData()

  const isPositive = expectancy >= 0

  return (
    <Card className="h-full">
      <div className="flex items-center justify-center h-full gap-1.5">
        <TrendingUp className={cn("h-3 w-3", isPositive ? "text-green-500" : "text-red-500")} />
        <span className="text-xs text-muted-foreground">Expectancy</span>
        <div className={cn(
          "font-semibold text-base font-mono tabular-nums",
          isPositive ? "text-green-500" : "text-red-500"
        )}>
          {isPositive ? "+" : ""}${expectancy.toFixed(2)}
        </div>
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={5} className="max-w-[280px]">
              Expected net P&L per trade. Calculated as Win Rate × Avg Win − Loss Rate × Avg Loss (net of commission). A positive expectancy means the strategy has an edge.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </Card>
  )
}
