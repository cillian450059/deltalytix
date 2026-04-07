"use client"

import { useI18n } from "@/locales/client"
import { format } from "date-fns"
import { formatInTimeZone } from "date-fns-tz"
import { fr, enUS } from "date-fns/locale"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Pencil } from "lucide-react"
import { HourlyFinancialTimeline } from "./hourly-financial-timeline"
import { useState, useEffect } from "react"
import type { FinancialEvent } from "@/prisma/generated/prisma/browser"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { useUserStore } from "@/store/user-store"
import { useTradesStore } from "@/store/trades-store"
import { useFinancialEventsStore } from "@/store/widgets/financial-events-store"

interface MindsetSummaryProps {
  date: Date
  selectedNews: string[]
  journalContent: string
  onEdit: (section?: 'journal' | 'news') => void
}

export function MindsetSummary({
  date,
  selectedNews,
  journalContent,
  onEdit
}: MindsetSummaryProps) {
  const t = useI18n()
  const { locale } = useParams()
  const dateLocale = locale === 'fr' ? fr : enUS
  const trades = useTradesStore(state => state.trades)
  const financialEvents = useFinancialEventsStore(state => state.events)
  const timezone = useUserStore(state => state.timezone)
  const [events, setEvents] = useState<FinancialEvent[]>([])
  const [showOnlySelectedNews, setShowOnlySelectedNews] = useState(true)

  useEffect(() => {
    // Filter events for the selected date, locale, and selected news
    const dateEvents = financialEvents.filter(event => {
      const eventDate = new Date(event.date)
      const matchesDate = eventDate.toDateString() === date.toDateString()
      const matchesLocale = event.lang === locale
      const matchesSelectedNews = !showOnlySelectedNews || selectedNews.includes(event.id)

      return matchesDate && matchesLocale && matchesSelectedNews
    })
    setEvents(dateEvents)
  }, [date, financialEvents, locale, selectedNews, showOnlySelectedNews])

  // Filter trades for the selected date
  const dayTrades = trades.filter(trade => {
    const tradeDate = new Date(trade.entryDate)
    const tradeDateString = formatInTimeZone(tradeDate, timezone, 'yyyy-MM-dd')
    const selectedDateString = formatInTimeZone(date, timezone, 'yyyy-MM-dd')
    return tradeDateString === selectedDateString
  })

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          {format(date, 'MMMM d, yyyy', { locale: dateLocale })}
        </h2>
      </div>

      <div className="grid gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {t('mindset.journaling.title')}
            </p>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEdit('journal')}>
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
          {!journalContent ? (
            <p className="text-sm text-muted-foreground">{t('mindset.noData')}</p>
          ) : (
            <div
              key={journalContent}
              className="prose prose-sm dark:prose-invert max-w-none [&_.ProseMirror]:outline-hidden [&_.ProseMirror]:relative [&_.ProseMirror]:h-full"
              dangerouslySetInnerHTML={{ __html: journalContent }}
            />
          )}
        </div>
        <div className="space-y-2">
          <div className="flex justify-between flex-col gap-2">
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">
                {t('mindset.newsImpact.title')}
              </p>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEdit('news')}>
                <Pencil className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-only-selected"
                  checked={showOnlySelectedNews}
                  onCheckedChange={(checked) => setShowOnlySelectedNews(checked === true)}
                />
                <Label htmlFor="show-only-selected" className="text-xs text-muted-foreground">
                  {t('mindset.newsImpact.showOnlySelectedNews')}
                </Label>
              </div>
            </div>
          </div>
          <HourlyFinancialTimeline
            date={date}
            events={events}
            trades={dayTrades}
            selectedEventIds={selectedNews}
          />
        </div>
      </div>
    </div>
  )
}
