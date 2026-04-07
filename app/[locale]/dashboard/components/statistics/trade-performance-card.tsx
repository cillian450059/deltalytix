'use client'

import { useData } from "@/context/data-provider"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { BarChart, TrendingUp, TrendingDown, Minus, HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { WidgetSize } from '../../types/dashboard'
import { useI18n } from '@/locales/client'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface TradePerformanceCardProps {
  size?: WidgetSize
}

export default function TradePerformanceCard({ size = 'medium' }: TradePerformanceCardProps) {
  const { statistics: { nbWin, nbLoss, nbBe, nbTrades } } = useData()
  const t = useI18n()

  // Calculate rates
  const winRate = Number((nbWin / nbTrades * 100).toFixed(2))
  const lossRate = Number((nbLoss / nbTrades * 100).toFixed(2))
  const beRate = Number((nbBe / nbTrades * 100).toFixed(2))

    return (
      <Card className="h-full">
        <div className="flex items-center justify-center h-full gap-1.5">
          <span className="text-xs text-muted-foreground">W/B/L</span>
          <div className="flex items-center gap-0.5">
            <span className="font-semibold text-sm font-mono tabular-nums text-yellow-500">{winRate}%</span>
          </div>
          <span className="text-muted-foreground text-xs">/</span>
          <div className="flex items-center gap-0.5">
            <span className="font-semibold text-sm font-mono tabular-nums text-yellow-500">{beRate}%</span>
          </div>
          <span className="text-muted-foreground text-xs">/</span>
          <div className="flex items-center gap-0.5">
            <span className="font-semibold text-sm font-mono tabular-nums text-red-500">{lossRate}%</span>
          </div>
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent 
                side="bottom" 
                sideOffset={5} 
                className="max-w-[300px]"
              >
                {t('widgets.tradePerformance.tooltip')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </Card>
    )
  }
