import { useData } from "@/context/data-provider"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { PiggyBank, HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { WidgetSize } from '../../types/dashboard'
import { useI18n } from '@/locales/client'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface CumulativePnlCardProps {
  size?: WidgetSize
}

export default function CumulativePnlCard({ size = 'medium' }: CumulativePnlCardProps) {
  const { statistics: { cumulativePnl, cumulativeFees } } = useData()
  const totalPnl = cumulativePnl - cumulativeFees
  const isPositive = totalPnl > 0
  const t = useI18n()

    return (
      <Card className="h-full">
        <div className="flex items-center justify-center h-full gap-1.5">
          <PiggyBank className="h-3 w-3 text-yellow-500" />
          <span className="text-xs text-muted-foreground">PnL</span>
          <span className={cn(
            "font-semibold text-base font-mono tabular-nums",
            isPositive ? "text-yellow-500" : "text-red-500"
          )}>
            {isPositive ? '+' : '-'}${Math.abs(totalPnl).toFixed(2)}
          </span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <HelpCircle className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent 
                side="bottom" 
                sideOffset={5} 
                className="max-w-[300px]"
              >
                {t('widgets.cumulativePnl.tooltip')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </Card>
    )
  }
