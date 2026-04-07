"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel"
import { Journaling } from "./journaling"
import { Timeline } from "./timeline"
import { MindsetSummary } from "./mindset-summary"
import { useI18n } from "@/locales/client"
import { Info, ChevronLeft, ChevronRight, RefreshCw, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { WidgetSize } from "@/app/[locale]/dashboard/types/dashboard"
import type { EmblaCarouselType as CarouselApi } from "embla-carousel"
import { toast } from "sonner"
import { saveMindset, deleteMindset } from "@/server/journal"
import { addTagsToTradesForDay } from "@/server/trades"
import { isToday, format } from "date-fns"
import { useMoodStore } from "@/store/widgets/mood-store"
import { useFinancialEventsStore } from "@/store/widgets/financial-events-store"
import { useTradesStore } from "@/store/trades-store"
import { useCurrentLocale } from "@/locales/client"
import { FinancialEvent } from "@/prisma/generated/prisma/browser"
import { useFirstradeSyncContext } from "@/context/firstrade-sync-context"

interface MindsetWidgetProps {
  size: WidgetSize
}

export function MindsetWidget({ size }: MindsetWidgetProps) {
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(0)
  const [selectedNews, setSelectedNews] = useState<string[]>([])
  const [journalContent, setJournalContent] = useState("")
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [isEditing, setIsEditing] = useState(true)
  const [isTimelineVisible, setIsTimelineVisible] = useState(true)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moods = useMoodStore(state => state.moods)
  const setMoods = useMoodStore(state => state.setMoods)
  const financialEvents = useFinancialEventsStore(state => state.events)
  const trades = useTradesStore(state => state.trades)
  const setTrades = useTradesStore(state => state.setTrades)
  const locale = useCurrentLocale()
  const t = useI18n()

  // Firstrade auto-sync
  const { sessionId, accounts, performSyncForAllAccounts, isAutoSyncing } = useFirstradeSyncContext()
  const hasSyncedRef = useRef(false)

  // Auto-sync on mount if session + accounts available
  useEffect(() => {
    if (sessionId && accounts.length > 0 && !hasSyncedRef.current && !isAutoSyncing) {
      hasSyncedRef.current = true
      performSyncForAllAccounts(sessionId)
    }
  }, [sessionId, accounts, performSyncForAllAccounts, isAutoSyncing])

  // Consolidated effect for carousel and mood data handling
  useEffect(() => {
    if (!api) return

    // Handle carousel selection
    api.on("select", () => {
      setCurrent(api.selectedScrollSnap())
    })

    // Handle initial load and mood data
    if (moods) {
      const today = new Date()
      const hasTodayData = moods.some(mood => {
        if (!mood?.day) return false
        const moodDate = mood.day instanceof Date ? mood.day : new Date(mood.day)
        return format(moodDate, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd')
      })

      // Handle selected date mood data
      const mood = moods.find(mood => {
        if (!mood?.day) return false
        const moodDate = mood.day instanceof Date ? mood.day : new Date(mood.day)
        return format(moodDate, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd')
      })

      // If it's today and we have data, show summary
      if (isToday(selectedDate) && hasTodayData) {
        setSelectedNews(mood?.selectedNews ?? [])
        setJournalContent(mood?.journalContent ?? "")
        setIsEditing(true)
        api.scrollTo(1) // Summary is now index 1
        return
      }

      if (mood) {
        setSelectedNews(mood.selectedNews ?? [])
        setJournalContent(mood.journalContent ?? "")
        api.scrollTo(1) // Summary is now index 1
      } else {
        setSelectedNews([])
        setJournalContent("")
      }
    }
  }, [api, selectedDate, moods])

  // Debounced auto-save: fires 2 s after the last content change
  const triggerAutoSave = useCallback((content: string, news: string[], date: Date, currentMoods: typeof moods) => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus('saving')
      try {
        const dateKey = format(date, 'yyyy-MM-dd')
        const savedMood = await saveMindset({ emotionValue: 50, selectedNews: news, journalContent: content }, dateKey)
        const filtered = (currentMoods ?? []).filter(m => {
          if (!m?.day) return true
          const d = m.day instanceof Date ? m.day : new Date(m.day)
          return format(d, 'yyyy-MM-dd') !== dateKey
        })
        setMoods([...filtered, savedMood])
        setAutoSaveStatus('saved')
        setTimeout(() => setAutoSaveStatus('idle'), 2000)
      } catch {
        setAutoSaveStatus('idle')
      }
    }, 2000)
  }, [setMoods])

  // Clear auto-save timer on unmount
  useEffect(() => () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }, [])

  const handleNewsSelection = (newsIds: string[]) => {
    setSelectedNews(newsIds)
  }

  const handleJournalChange = (content: string) => {
    setJournalContent(content)
    triggerAutoSave(content, selectedNews, selectedDate, moods)
  }

  const handleApplyTagToAll = async (tag: string) => {
    try {
      const dateKey = format(selectedDate, 'yyyy-MM-dd')

      // Find all trades for this day
      const tradesForDay = trades.filter(trade => {
        const entryDate = trade.entryDate
        const closeDate = trade.closeDate
        const entryMatches = entryDate && (entryDate === dateKey || entryDate.startsWith(dateKey))
        const closeMatches = closeDate && (closeDate === dateKey || closeDate.startsWith(dateKey))
        return entryMatches || closeMatches
      })

      const tradeIds = tradesForDay.map(trade => trade.id)

      // Update local state immediately for instant feedback
      const updatedTrades = trades.map(trade => {
        if (tradeIds.includes(trade.id)) {
          return {
            ...trade,
            tags: Array.from(new Set([...trade.tags, tag]))
          }
        }
        return trade
      })
      setTrades(updatedTrades)

      // Then update on server
      await addTagsToTradesForDay(dateKey, [tag])

      toast.success(t('mindset.tags.tagApplied'), {
        description: t('mindset.tags.tagAppliedDescription', { tag }),
      })
    } catch (error) {
      toast.error(t('mindset.tags.tagApplyError'), {
        description: t('mindset.tags.tagApplyErrorDescription'),
      })
    }
  }

  const handleSave = async () => {
    // Scroll to summary view after saving
    api?.scrollTo(1)
    try {
      const dateKey = format(selectedDate, 'yyyy-MM-dd')
      const savedMood = await saveMindset({
        emotionValue: 50,
        selectedNews,
        journalContent,
      }, dateKey)

      // Update the moodHistory in context
      const updatedMoodHistory = moods?.filter(mood => {
        if (!mood?.day) return true
        const moodDate = mood.day instanceof Date ? mood.day : new Date(mood.day)
        const selectedDateKey = format(selectedDate, 'yyyy-MM-dd')
        const moodDateKey = format(moodDate, 'yyyy-MM-dd')
        return moodDateKey !== selectedDateKey
      }) || []
      setMoods([...updatedMoodHistory, savedMood])

      toast.success(t('mindset.saveSuccess'), {
        description: t('mindset.saveSuccessDescription'),
      })

    } catch (error) {
      toast.error(t('mindset.saveError'), {
        description: t('mindset.saveErrorDescription'),
      })
    }
  }

  const handleDeleteEntry = async (date: Date) => {
    try {
      const dateKey = format(date, 'yyyy-MM-dd')
      await deleteMindset(dateKey)

      // Update the moodHistory in context
      const updatedMoodHistory = moods?.filter(mood => {
        if (!mood?.day) return true
        const moodDate = mood.day instanceof Date ? mood.day : new Date(mood.day)
        return format(moodDate, 'yyyy-MM-dd') !== dateKey
      }) || []
      setMoods(updatedMoodHistory)

      // If the deleted entry was the selected date, reset the form
      if (dateKey === format(selectedDate, 'yyyy-MM-dd')) {
        setSelectedNews([])
        setJournalContent("")
        setIsEditing(true)
        api?.scrollTo(0)
      }
    } catch (error) {
      throw error // Let the Timeline component handle the error toast
    }
  }

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date)

    // Find if we have data for the selected date
    const moodForDate = moods?.find(mood => {
      if (!mood?.day) return false
      const moodDate = mood.day instanceof Date ? mood.day : new Date(mood.day)
      return format(moodDate, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
    })

    if (moodForDate) {
      setSelectedNews(moodForDate.selectedNews ?? [])
      setJournalContent(moodForDate.journalContent ?? " ")
      setIsEditing(true)
      api?.scrollTo(1) // Summary is now index 1
    } else {
      setSelectedNews([])
      setJournalContent("")
      setIsEditing(true)
      api?.scrollTo(0) // Journaling is index 0
    }
  }

  const getEventsForDate = (date: Date): FinancialEvent[] => {
    return financialEvents.filter(event => {
      if (!event.date) return false;
      try {
        const eventDate = new Date(event.date)
        const compareDate = new Date(date)

        // Set hours to start of day for comparison
        eventDate.setHours(0, 0, 0, 0)
        compareDate.setHours(0, 0, 0, 0)

        return eventDate.getTime() === compareDate.getTime() && event.lang === locale
      } catch (error) {
        console.error('Error parsing event date:', error)
        return false
      }
    })
  }

  const handleEdit = (section?: 'journal' | 'news') => {
    setIsEditing(true)
    api?.scrollTo(0)
  }

  const handleManualSync = () => {
    if (sessionId && accounts.length > 0) {
      hasSyncedRef.current = false
      performSyncForAllAccounts(sessionId)
    }
  }

  const toggleTimeline = () => {
    setIsTimelineVisible(!isTimelineVisible)
  }

  const steps = [
    {
      title: t('mindset.journaling.title'),
      component: <Journaling
        content={journalContent}
        onChange={handleJournalChange}
        onSave={handleSave}
        date={selectedDate}
        events={getEventsForDate(selectedDate)}
        selectedNews={selectedNews}
        onNewsSelection={handleNewsSelection}
        trades={trades}
        onApplyTagToAll={handleApplyTagToAll}
        autoSaveStatus={autoSaveStatus}
      />
    },
    {
      title: t('mindset.title'),
      component: <MindsetSummary
        date={selectedDate}
        selectedNews={selectedNews}
        journalContent={journalContent}
        onEdit={handleEdit}
      />
    }
  ]

  return (
    <Card className="flex flex-col p-0 h-full w-full">
      <CardHeader
        className={cn(
          "flex flex-row items-center justify-between space-y-0 border-b shrink-0",
          size === 'small' ? "p-2 h-10" : "p-3 sm:p-4 h-14"
        )}
      >
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-1.5">
            <CardTitle
              className={cn(
                "line-clamp-1",
                size === 'small' ? "text-sm" : "text-base"
              )}
            >
              {t('mindset.title')}
            </CardTitle>
            <TooltipProvider>
              <UITooltip>
                <TooltipTrigger asChild>
                  <Info className={cn(
                    "text-muted-foreground hover:text-foreground transition-colors cursor-help",
                    size === 'small' ? "h-3.5 w-3.5" : "h-4 w-4"
                  )} />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{t('mindset.description')}</p>
                </TooltipContent>
              </UITooltip>
            </TooltipProvider>
            {/* Firstrade sync indicator */}
            {accounts.length > 0 && (
              <TooltipProvider>
                <UITooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={handleManualSync}
                      disabled={isAutoSyncing || !sessionId}
                    >
                      {isAutoSyncing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-yellow-500" />
                      ) : (
                        <RefreshCw className={cn(
                          "h-3.5 w-3.5",
                          sessionId ? "text-yellow-500" : "text-muted-foreground"
                        )} />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>{isAutoSyncing ? 'Syncing Firstrade...' : sessionId ? 'Sync Firstrade' : 'No active Firstrade session'}</p>
                  </TooltipContent>
                </UITooltip>
              </TooltipProvider>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              {steps.map((_, index) => (
                <div
                  key={index}
                  className={cn(
                    "h-1.5 w-1.5 rounded-full transition-colors",
                    current === index
                      ? "bg-primary"
                      : "bg-muted"
                  )}
                />
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => api?.scrollPrev()}
                disabled={current === 0}
                className="h-6 w-6"
              >
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => api?.scrollNext()}
                disabled={current === steps.length - 1}
                className="h-6 w-6"
              >
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0 flex flex-row relative">
        {/* Timeline with animation */}
        <div
          className={cn(
            "relative transition-all duration-300 ease-out-quart",
            isTimelineVisible ? "w-auto" : "w-0 overflow-hidden"
          )}
        >
          <Timeline
            className="shrink-0"
            selectedDate={selectedDate}
            onSelectDate={handleDateSelect}
            moodHistory={moods}
            onDeleteEntry={handleDeleteEntry}
          />

          {/* Hide/Show Button - positioned at right edge of timeline */}
          <div className="absolute right-0 top-1/2 -translate-y-1/2 z-10">
            <TooltipProvider>
              <UITooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={toggleTimeline}
                    className="h-8 w-4 rounded-r-none rounded-l-md border-r-0"
                  >
                    {isTimelineVisible ? (
                      <ChevronLeft className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>{isTimelineVisible ? t('mindset.hideTimeline') : t('mindset.showTimeline')}</p>
                </TooltipContent>
              </UITooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Show Button when timeline is collapsed */}
        {!isTimelineVisible && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 z-10">
            <TooltipProvider>
              <UITooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={toggleTimeline}
                    className="h-8 w-4 rounded-l-none rounded-r-md border-l-0"
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{t('mindset.showTimeline')}</p>
                </TooltipContent>
              </UITooltip>
            </TooltipProvider>
          </div>
        )}

        {/* Carousel */}
        <Carousel
          opts={{
            loop: false,
            watchDrag: (api, event) => {
              // Disable drag on desktop
              if (window.innerWidth >= 768) {
                return false
              }
              return true
            }
          }}
          setApi={setApi}
          className="flex-1 min-w-0 h-full flex flex-col"
        >
          <CarouselContent className="h-full flex-1 pl-4">
            {steps.map((step, index) => (
              <CarouselItem key={index} className="h-full p-4">
                {step.component}
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      </CardContent>
    </Card>
  )
}
