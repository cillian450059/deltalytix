'use client'

import React, { useState, useEffect, useMemo } from "react"
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, startOfWeek, endOfWeek, addDays, getYear } from "date-fns"
import { formatInTimeZone } from 'date-fns-tz'
import { fr, enUS } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Newspaper, Calendar } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { FinancialEvent } from "@/prisma/generated/prisma/browser"
import { CalendarModal } from "./daily-modal"
import { useI18n, useCurrentLocale } from "@/locales/client"
import { translateWeekday } from "@/lib/translation-utils"
import { WeeklyModal } from "./weekly-modal"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { HourlyFinancialTimeline } from "../mindset/hourly-financial-timeline"
// CountryFilter and ImportanceFilter removed from calendar UI
import { useNewsFilterStore } from "@/store/filters/news-filter-store"
import { useCalendarViewStore } from "@/store/widgets/calendar-view"
import WeeklyCalendarPnl from "./weekly-calendar"
import { CalendarData } from "@/app/[locale]/dashboard/types/calendar"
import { useFinancialEventsStore } from "@/store/widgets/financial-events-store"
import { useUserStore } from "@/store/user-store"
import { Account, useDataSafe } from "@/context/data-provider"
import { HIDDEN_GROUP_NAME } from "../filters/account-group-board"


const WEEKDAYS_SUNDAY_START = [
  'calendar.weekdays.sun',
  'calendar.weekdays.mon',
  'calendar.weekdays.tue',
  'calendar.weekdays.wed',
  'calendar.weekdays.thu',
  'calendar.weekdays.fri',
  'calendar.weekdays.sat'
] as const

const WEEKDAYS_MONDAY_START = [
  'calendar.weekdays.mon',
  'calendar.weekdays.tue',
  'calendar.weekdays.wed',
  'calendar.weekdays.thu',
  'calendar.weekdays.fri',
  'calendar.weekdays.sat',
  'calendar.weekdays.sun'
] as const


function getCalendarDays(monthStart: Date, monthEnd: Date, weekStartsOnMonday: boolean = false) {
  const weekStartsOn = weekStartsOnMonday ? 1 : 0
  const startDate = startOfWeek(monthStart, { weekStartsOn })
  const endDate = endOfWeek(monthEnd, { weekStartsOn })
  const days = eachDayOfInterval({ start: startDate, end: endDate })

  // 5 complete rows (35 days) — perfect, no padding needed
  if (days.length <= 35) {
    if (days.length < 35) {
      const lastDay = days[days.length - 1]
      const additionalDays = eachDayOfInterval({
        start: addDays(lastDay, 1),
        end: addDays(startDate, 34)
      })
      return [...days, ...additionalDays].slice(0, 35)
    }
    return days
  }

  // More than 35 days — need 6 rows, pad to 42
  if (days.length < 42) {
    const lastDay = days[days.length - 1]
    const additionalDays = eachDayOfInterval({
      start: addDays(lastDay, 1),
      end: addDays(startDate, 41)
    })
    return [...days, ...additionalDays].slice(0, 42)
  }

  return days
}

const formatCurrency = (value: number, options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }) => {
  const formatted = value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 0
  })
  return formatted
}

// Compact number: 12345 → +1.23萬, 500 → +500
function formatCompact(value: number, mode: 'equity' | 'change' = 'change'): string {
  const abs = Math.abs(value)
  if (mode === 'equity') {
    // NAV: always show $ prefix, no sign
    if (abs >= 100_000_000) return `$${(abs / 100_000_000).toFixed(2)}億`
    if (abs >= 10_000) return `$${(abs / 10_000).toFixed(2)}萬`
    return `$${abs.toFixed(2)}`
  }
  // change: show – for negative, $ prefix
  const sign = value < 0 ? '-' : ''
  if (abs >= 100_000_000) return `${sign}$${(abs / 100_000_000).toFixed(2)}億`
  if (abs >= 10_000) return `${sign}$${(abs / 10_000).toFixed(2)}萬`
  return `${sign}$${abs.toFixed(2)}`
}

const truncateAccountNumber = (accountNumber: string, maxLength: number = 15): string => {
  if (accountNumber.length <= maxLength) {
    return accountNumber
  }
  
  // Always show last 3 digits
  const lastThree = accountNumber.slice(-3)
  const remainingLength = maxLength - 3 - 1 // -1 for the ellipsis
  
  if (remainingLength <= 0) {
    return `...${lastThree}`
  }
  
  // Show beginning + ellipsis + last 3 digits
  const beginning = accountNumber.slice(0, remainingLength)
  return `${beginning}...${lastThree}`
}

interface CalendarPnlProps {
  calendarData: CalendarData;
  financialEvents?: FinancialEvent[];
  hideFiltersOnMobile?: boolean;
  equityMap?: Record<string, { equity: number; cash: number }>;
}


type ImpactLevel = "low" | "medium" | "high"
const IMPACT_LEVELS: ImpactLevel[] = ["low", "medium", "high"]

const getEventImportanceStars = (importance: string): ImpactLevel => {
  switch (importance.toUpperCase()) {
    case 'HIGH':
      return "high"
    case 'MEDIUM':
      return "medium"
    case 'LOW':
      return "low"
    default:
      return "low"
  }
}

function EventBadge({ events, impactLevels }: { events: FinancialEvent[], impactLevels: ImpactLevel[] }) {
  // Filter events by impact level
  const filteredEvents = events.filter(e => impactLevels.includes(getEventImportanceStars(e.importance)))
  if (filteredEvents.length === 0) return null

  // Get the highest importance level for color coding
  const highestImportance = filteredEvents.reduce((highest, event) => {
    const level = getEventImportanceStars(event.importance)
    const levelIndex = IMPACT_LEVELS.indexOf(level)
    return Math.max(highest, levelIndex)
  }, 0)

  const badgeStyles = {
    2: "bg-background text-foreground border-border hover:bg-accent",
    1: "bg-background text-foreground border-border hover:bg-accent",
    0: "bg-background text-foreground border-border hover:bg-accent"
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "h-4 px-1.5 text-[8px] sm:text-[9px] font-medium cursor-pointer relative z-0 w-auto justify-center items-center gap-1",
            badgeStyles[highestImportance as keyof typeof badgeStyles],
            "transition-all duration-200 ease-in-out",
            "hover:scale-110 hover:shadow-md",
            "active:scale-95"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Newspaper className="h-2.5 w-2.5" />
          {filteredEvents.length}
        </Badge>
      </PopoverTrigger>
      <PopoverContent
        className="w-[400px] p-0 z-50"
        align="start"
        side="right"
        sideOffset={5}
        onClick={(e) => e.stopPropagation()}
      >
        <HourlyFinancialTimeline
          date={filteredEvents.length > 0 ? new Date(filteredEvents[0].date) : new Date()}
          events={filteredEvents}
          className="h-[400px]"
          preventScrollPropagation={true}
        />
      </PopoverContent>
    </Popover>
  )
}

function RenewalBadge({ renewals }: { renewals: Account[] }) {
  
  const t = useI18n()

  if (renewals.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "h-4 px-1.5 text-[8px] sm:text-[9px] font-medium cursor-pointer relative z-0 w-auto justify-center items-center gap-1",
            "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800 dark:hover:bg-blue-900/30",
            "transition-all duration-200 ease-in-out",
            "hover:scale-110 hover:shadow-md",
            "active:scale-95"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Calendar className="h-2.5 w-2.5" />
          {renewals.length}
        </Badge>
      </PopoverTrigger>
      <PopoverContent
        className="w-[320px] sm:w-[380px] md:w-[420px] max-w-[90vw] p-0 z-50 border shadow-lg bg-card"
        align="start"
        side="right"
        sideOffset={8}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-6">
          {/* Header */}
          <div className="flex items-center gap-2 mb-4 sm:mb-6">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900">
              <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm sm:text-base text-foreground truncate">{t('propFirm.renewal.title')}</h3>
              <p className="text-xs text-muted-foreground">{renewals.length} {renewals.length === 1 ? t('propFirm.renewal.account') : t('propFirm.renewal.accounts')}</p>
            </div>
          </div>

          {/* Account List with max height and scrolling */}
          <div className="space-y-2 sm:space-y-3 max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
            {renewals.map((account, index) => (
              <div 
                key={account.id} 
                className="group relative p-3 sm:p-4 rounded-lg border bg-card hover:bg-muted/50 hover:border-border transition-all duration-200 hover:shadow-xs"
              >
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 sm:gap-3">
                  {/* Account Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-2">
                      {account.propfirm ? (
                        <>
                          <div className="font-semibold text-sm text-foreground truncate">
                            {account.propfirm}
                          </div>
                          <div className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full inline-block w-fit">
                            <span className="block" title={account.number}>
                              {truncateAccountNumber(account.number, 12)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="font-semibold text-sm text-foreground">
                          <span className="block" title={account.number}>
                            {truncateAccountNumber(account.number, 18)}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-xs text-muted-foreground">
                      <div className="px-2 py-1 bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-md font-medium whitespace-nowrap">
                        {account.paymentFrequency?.toLowerCase()} {t('propFirm.renewal.frequency')}
                      </div>
                      {account.autoRenewal && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-green-50 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-md whitespace-nowrap">
                          <div className="w-1.5 h-1.5 bg-green-500 rounded-full shrink-0"></div>
                          <span className="text-xs font-medium">{t('propFirm.renewal.notification')}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Price */}
                  <div className="text-left sm:text-right shrink-0">
                    <div className="font-bold text-base sm:text-lg text-blue-600 dark:text-blue-400 mb-1">
                      {account.price != null && formatCurrency(account.price, { maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {account.paymentFrequency?.toLowerCase()}
                    </div>
                  </div>
                </div>

                {/* Subtle hover effect line */}
                <div className="absolute bottom-0 left-3 right-3 sm:left-4 sm:right-4 h-0.5 bg-linear-to-r from-blue-500/0 via-blue-500/50 to-blue-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"></div>
              </div>
            ))}
          </div>

          {/* Footer */}
          {renewals.length > 0 && (
            <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0 text-xs text-muted-foreground">
                <span>{t('propFirm.renewal.totalAccounts')}: {renewals.length}</span>
                <span className="truncate">
                  {t('propFirm.renewal.nextRenewal')}: {renewals[0]?.nextPaymentDate ? format(new Date(renewals[0].nextPaymentDate), 'MMM dd, yyyy') : 'N/A'}
                </span>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default function CalendarPnl({ calendarData, hideFiltersOnMobile = false, equityMap = {} }: CalendarPnlProps) {
  const accounts = useUserStore(state => state.accounts)
  const groups = useUserStore(state => state.groups)
  const t = useI18n()
  const locale = useCurrentLocale()
  const timezone = useUserStore(state => state.timezone)
  const userFinancialEvents = useFinancialEventsStore(state => state.events)
  const dateLocale = locale === 'fr' ? fr : enUS
  const weekStartsOnMonday = locale === 'fr'
  const WEEKDAYS = weekStartsOnMonday ? WEEKDAYS_MONDAY_START : WEEKDAYS_SUNDAY_START
  const dataCtx = useDataSafe()
  const setDateRange = dataCtx?.setDateRange ?? null
  const [currentDate, setCurrentDate] = useState(new Date())
  const [isLoading, setIsLoading] = useState(false)
  const [monthEvents, setMonthEvents] = useState<FinancialEvent[]>([])
  const [calendarDays, setCalendarDays] = useState<Date[]>([])

  // Memoize monthStart and monthEnd calculations
  const { monthStart, monthEnd } = React.useMemo(() => ({
    monthStart: startOfMonth(currentDate),
    monthEnd: endOfMonth(currentDate)
  }), [currentDate])

  // Update calendarDays and sync global dateRange when currentDate changes
  useEffect(() => {
    setCalendarDays(getCalendarDays(monthStart, monthEnd, weekStartsOnMonday))
    setDateRange?.({ from: monthStart, to: monthEnd })
  }, [currentDate, monthStart, monthEnd, weekStartsOnMonday, setDateRange])

  // Use the calendar view store
  const {
    viewMode,
    setViewMode,
    selectedDate,
    setSelectedDate,
    selectedWeekDate,
    setSelectedWeekDate
  } = useCalendarViewStore()

  // Use the global news filter store
  const impactLevels = useNewsFilterStore((s) => s.impactLevels)
  const selectedCountries = useNewsFilterStore((s) => s.selectedCountries)

  // Update monthEvents when currentDate or financialEvents change
  useEffect(() => {
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(currentDate)

    const filteredEvents = userFinancialEvents.filter(event => {
      const eventDate = new Date(event.date)
      return eventDate >= monthStart && eventDate <= monthEnd && event.lang === locale
    })

    setMonthEvents(filteredEvents)
  }, [currentDate, userFinancialEvents, locale])

  const handlePrevMonth = React.useCallback(() => {
    const newDate = subMonths(currentDate, 1)
    setCurrentDate(newDate)
    setDateRange?.({ from: startOfMonth(newDate), to: endOfMonth(newDate) })
  }, [currentDate, setDateRange])

  const handleNextMonth = React.useCallback(() => {
    const newDate = addMonths(currentDate, 1)
    setCurrentDate(newDate)
    setDateRange?.({ from: startOfMonth(newDate), to: endOfMonth(newDate) })
  }, [currentDate, setDateRange])

  // Pre-compute events map by date
  const eventsByDate = useMemo(() => {
    const map = new Map<string, FinancialEvent[]>();
    monthEvents.forEach(event => {
      if (!event.date) return;
      try {
        const eventDateObj = new Date(event.date);
        eventDateObj.setHours(0, 0, 0, 0);
        const dateKey = formatInTimeZone(eventDateObj, timezone, 'yyyy-MM-dd');
        if (!map.has(dateKey)) {
          map.set(dateKey, []);
        }
        map.get(dateKey)!.push(event);
      } catch (error) {
        console.error('Error parsing event date:', error);
      }
    });
    return map;
  }, [monthEvents, timezone]);

  // Pre-compute renewals map by date
  const renewalsByDate = useMemo(() => {
    const hiddenGroup = groups.find(g => g.name === HIDDEN_GROUP_NAME);
    const hiddenAccountIds = hiddenGroup ? new Set(hiddenGroup.accounts.map(a => a.id)) : new Set();
    
    const map = new Map<string, Account[]>();
    accounts.forEach(account => {
      if (hiddenAccountIds.has(account.id) || !account.nextPaymentDate) return;
      try {
        const renewalDateObj = new Date(account.nextPaymentDate);
        renewalDateObj.setHours(0, 0, 0, 0);
        const dateKey = formatInTimeZone(renewalDateObj, timezone, 'yyyy-MM-dd');
        if (!map.has(dateKey)) {
          map.set(dateKey, []);
        }
        map.get(dateKey)!.push(account);
      } catch (error) {
        console.error('Error parsing renewal date:', error);
      }
    });
    return map;
  }, [accounts, timezone, groups]);

  // Pre-compute day calculations (maxProfit, maxDrawdown) for all days
  const dayCalculations = useMemo(() => {
    const calculations = new Map<string, { maxProfit: number; maxDrawdown: number }>();
    
    Object.entries(calendarData).forEach(([dateString, dayData]) => {
      if (!dayData.trades || dayData.trades.length === 0) {
        calculations.set(dateString, { maxProfit: 0, maxDrawdown: 0 });
        return;
      }

      // Create a copy to avoid mutating original
      const sortedTrades = [...dayData.trades].sort((a, b) => 
        new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime()
      );
      
      const equity = [0];
      let cumulative = 0;
      sortedTrades.forEach(trade => {
        cumulative += trade.pnl - (trade.commission || 0);
        equity.push(cumulative);
      });

      // Max drawdown
      let peak = -Infinity;
      let maxDD = 0;
      equity.forEach(val => {
        if (val > peak) peak = val;
        const dd = peak - val;
        if (dd > maxDD) maxDD = dd;
      });

      // Max profit (runup)
      let trough = Infinity;
      let maxRU = 0;
      equity.forEach(val => {
        if (val < trough) trough = val;
        const ru = val - trough;
        if (ru > maxRU) maxRU = ru;
      });

      calculations.set(dateString, { maxProfit: maxRU, maxDrawdown: maxDD });
    });
    
    return calculations;
  }, [calendarData]);

  // Filter events by impact level and country - memoized
  const filteredEventsByDate = useMemo(() => {
    const filtered = new Map<string, FinancialEvent[]>();
    eventsByDate.forEach((events, dateKey) => {
      const filteredEvents = events.filter(e => {
        const matchesImpact = impactLevels.length === 0 ||
          impactLevels.includes(getEventImportanceStars(e.importance));
        const matchesCountry = selectedCountries.length === 0 ||
          (e.country && selectedCountries.includes(e.country));
        return matchesImpact && matchesCountry;
      });
      if (filteredEvents.length > 0) {
        filtered.set(dateKey, filteredEvents);
      }
    });
    return filtered;
  }, [eventsByDate, impactLevels, selectedCountries]);

  // Monthly total: equity-based if available, else trade P&L
  const monthlyTotal = useMemo(() => {
    const monthEquityDates = Object.keys(equityMap)
      .filter(d => isSameMonth(new Date(d), currentDate))
      .sort()
    if (monthEquityDates.length >= 2) {
      // Use equity delta over the month
      const allDates = Object.keys(equityMap).sort()
      const firstMonthDate = monthEquityDates[0]
      const priorIdx = allDates.indexOf(firstMonthDate) - 1
      const startEq = priorIdx >= 0
        ? (equityMap[allDates[priorIdx]]?.equity ?? 0)
        : (equityMap[firstMonthDate]?.equity ?? 0)
      const endEq = equityMap[monthEquityDates[monthEquityDates.length - 1]]?.equity ?? 0
      if (startEq > 0) return endEq - startEq
    }
    // Fallback to trade P&L
    return Object.entries(calendarData).reduce((total, [dateString, dayData]) => {
      const date = new Date(dateString)
      if (isSameMonth(date, currentDate)) {
        return total + dayData.pnl
      }
      return total
    }, 0)
  }, [calendarData, currentDate, equityMap])

  const yearTotal = useMemo(() => {
    return Object.entries(calendarData).reduce((total, [dateString, dayData]) => {
      const date = new Date(dateString)
      if (getYear(date) === getYear(currentDate)) {
        return total + dayData.pnl
      }
      return total
    }, 0)
  }, [calendarData, currentDate])

  // Monthly return rate: (lastEquity - firstEquity) / firstEquity
  const monthlyReturnRate = useMemo(() => {
    const monthDates = Object.keys(equityMap)
      .filter(d => isSameMonth(new Date(d), currentDate))
      .sort()
    if (monthDates.length < 2) return null

    // Find equity just before the month (last day of prior month in equityMap)
    const allDates = Object.keys(equityMap).sort()
    const firstMonthDate = monthDates[0]
    const priorIdx = allDates.indexOf(firstMonthDate) - 1
    const startEquity = priorIdx >= 0
      ? (equityMap[allDates[priorIdx]]?.equity ?? 0)
      : (equityMap[firstMonthDate]?.equity ?? 0) - monthlyTotal

    if (startEquity <= 0) return null
    const lastEquity = equityMap[monthDates[monthDates.length - 1]]?.equity ?? 0
    return ((lastEquity - startEquity) / startEquity) * 100
  }, [currentDate, equityMap, monthlyTotal])

  // Daily equity delta: equity[d] - equity[d-1], and return rate based on that
  const { dailyEquityChanges, dailyReturnRates } = useMemo(() => {
    const changes: Record<string, number | null> = {}
    const rates: Record<string, number | null> = {}
    const sortedDates = Object.keys(equityMap).sort()
    for (let i = 0; i < sortedDates.length; i++) {
      const d = sortedDates[i]
      if (i === 0) {
        changes[d] = null
        rates[d] = null
      } else {
        const prevD = sortedDates[i - 1]
        const prevEq = equityMap[prevD]?.equity ?? 0
        const currEq = equityMap[d]?.equity ?? 0
        const delta = prevEq > 0 ? currEq - prevEq : null
        changes[d] = delta
        rates[d] = delta !== null && prevEq > 0 ? (delta / prevEq) * 100 : null
      }
    }
    return { dailyEquityChanges: changes, dailyReturnRates: rates }
  }, [equityMap])

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="shrink-0 px-4 pt-3 pb-0 space-y-0 border-b">
        {/* Row 1: date picker + month/year toggle */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => viewMode === 'daily' ? handlePrevMonth() : setCurrentDate(new Date(getYear(currentDate) - 1, 0, 1))}
              className="p-1 hover:text-foreground text-muted-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold">
              {viewMode === 'daily'
                ? formatInTimeZone(currentDate, timezone, 'yyyy/MM', { locale: dateLocale })
                : formatInTimeZone(currentDate, timezone, 'yyyy', { locale: dateLocale })}
            </span>
            <button
              onClick={() => viewMode === 'daily' ? handleNextMonth() : setCurrentDate(new Date(getYear(currentDate) + 1, 0, 1))}
              className="p-1 hover:text-foreground text-muted-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
            <button
              onClick={() => setViewMode('daily')}
              className={cn("px-3 py-1 text-xs rounded font-medium transition-colors",
                viewMode === 'daily' ? "bg-background shadow text-foreground" : "text-muted-foreground")}
            >月</button>
            <button
              onClick={() => setViewMode('weekly')}
              className={cn("px-3 py-1 text-xs rounded font-medium transition-colors",
                viewMode === 'weekly' ? "bg-background shadow text-foreground" : "text-muted-foreground")}
            >年</button>
          </div>
        </div>

        {/* Row 2: monthly P&L + return rate */}
        {viewMode === 'daily' && (
          <div className="flex items-end justify-between pb-2">
            <div>
              <div className="text-[10px] text-muted-foreground mb-0.5">
                {formatInTimeZone(currentDate, timezone, 'M', { locale: dateLocale })}月收益 · USD
              </div>
              <div className={cn(
                "text-xl sm:text-2xl font-bold font-mono",
                monthlyTotal >= 0 ? "text-green-500" : "text-red-500"
              )}>
                {monthlyTotal >= 0 ? '+' : ''}{monthlyTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            {monthlyReturnRate !== null && (
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground mb-0.5">收益率</div>
                <div className={cn(
                  "text-xl sm:text-2xl font-bold font-mono",
                  monthlyReturnRate >= 0 ? "text-green-500" : "text-red-500"
                )}>
                  {monthlyReturnRate >= 0 ? '+' : ''}{monthlyReturnRate.toFixed(2)}%
                </div>
              </div>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-1 min-h-0 px-3 pb-2 pt-2">
        {viewMode === 'daily' ? (
          <>
            {/* Weekday headers */}
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((day) => (
                <div key={day} className="text-center font-medium text-[10px] sm:text-xs text-muted-foreground py-1">
                  {translateWeekday(t, day)}
                </div>
              ))}
            </div>

            {/* Calendar grid — no borders, horizontal dividers between rows */}
            <div className="grid grid-cols-7 auto-rows-fr h-[calc(100%-28px)]">
              {calendarDays.map((date, index) => {
                const dateString = format(date, 'yyyy-MM-dd')
                const dayData = calendarData[dateString]
                const isFirstDayOfRow = index % 7 === 0
                const isCurrentMonth = isSameMonth(date, currentDate)
                const dateEvents = filteredEventsByDate.get(dateString) || []
                const dateRenewals = renewalsByDate.get(dateString) || []
                const equityData = equityMap[dateString]
                const equityChange = dailyEquityChanges[dateString]
                const returnRate = dailyReturnRates[dateString]
                const hasEquity = isCurrentMonth && equityData && equityData.equity > 0
                const hasTrades = isCurrentMonth && !!dayData

                return (
                  <div
                    key={dateString}
                    className={cn(
                      "flex flex-col cursor-pointer px-1 py-1.5 transition-colors hover:bg-muted/40",
                      isFirstDayOfRow && index > 0 && "border-t border-border",
                      isToday(date) && "bg-primary/5",
                    )}
                    onClick={() => setSelectedDate(date)}
                  >
                    {/* Date number */}
                    <span className={cn(
                      "text-sm sm:text-base font-medium leading-none mb-1",
                      isCurrentMonth ? "text-foreground" : "text-muted-foreground/40",
                      isToday(date) && "text-primary font-semibold",
                    )}>
                      {format(date, 'd')}
                    </span>

                    {/* Event badges */}
                    {(dateEvents.length > 0 || dateRenewals.length > 0) && (
                      <div className="flex gap-0.5 mb-0.5">
                        {dateEvents.length > 0 && <EventBadge events={dateEvents} impactLevels={impactLevels} />}
                        {dateRenewals.length > 0 && <RenewalBadge renewals={dateRenewals} />}
                      </div>
                    )}

                    {/* Equity NAV + daily change (Firstrade positions) */}
                    {hasEquity && (
                      <>
                        <div className="text-[11px] sm:text-xs font-mono text-muted-foreground leading-tight">
                          {formatCompact(equityData!.equity, 'equity')}
                        </div>
                        {equityChange !== null && (
                          <div className={cn(
                            "text-[11px] sm:text-xs font-semibold font-mono leading-tight",
                            equityChange >= 0 ? "text-green-500" : "text-red-500"
                          )}>
                            {formatCompact(equityChange, 'change')}
                          </div>
                        )}
                        {returnRate !== null && (
                          <div className={cn(
                            "text-[11px] sm:text-xs font-semibold font-mono leading-tight",
                            returnRate >= 0 ? "text-green-500" : "text-red-500"
                          )}>
                            {returnRate < 0 ? '' : '+'}{returnRate.toFixed(2)}%
                          </div>
                        )}
                      </>
                    )}

                    {/* Trade P&L (when no equity data) */}
                    {!hasEquity && hasTrades && (
                      <div className={cn(
                        "text-[11px] sm:text-xs font-semibold font-mono leading-tight",
                        dayData!.pnl >= 0 ? "text-green-500" : "text-red-500"
                      )}>
                        {formatCompact(dayData!.pnl, 'change')}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <WeeklyCalendarPnl
            calendarData={calendarData}
            year={getYear(currentDate)}
          />
        )}
      </CardContent>
      <CalendarModal
        isOpen={selectedDate !== null && selectedDate !== undefined}
        onOpenChange={(open) => {
          if (!open) setSelectedDate(null)
        }}
        selectedDate={selectedDate}
        dayData={selectedDate ? calendarData[format(selectedDate, 'yyyy-MM-dd', { locale: dateLocale })] : undefined}
        isLoading={isLoading}
      />
      <WeeklyModal
        isOpen={selectedWeekDate !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedWeekDate(null)
        }}
        selectedDate={selectedWeekDate}
        calendarData={calendarData}
        isLoading={isLoading}
      />
    </Card>
  )
}