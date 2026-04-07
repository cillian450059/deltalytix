"use client"

import React from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { CalendarEntry } from "@/app/[locale]/dashboard/types/calendar"
import { useI18n } from '@/locales/client'
import { DailyMood } from './daily-mood'

interface DailyStatsProps {
  dayData: CalendarEntry | undefined;
  isWeekly?: boolean;
}

const formatCurrency = (value: number | undefined | null) => {
  if (value == null) return '$0.00'
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`
  return `${remainingSeconds}s`
}

export function DailyStats({ dayData, isWeekly = false }: DailyStatsProps) {
  const t = useI18n()

  const cashflowSides = ['dividend', 'interest', 'deposit', 'withdrawal', 'fee', 'transfer', 'journal']
  const depositSides = ['deposit', 'dividend', 'interest']
  const withdrawSides = ['withdrawal', 'fee', 'transfer', 'journal']

  // Calculate stats
  const { totalPnL, avgTimeInPosition, accountCount, maxDrawdown, maxProfit, cashflowDeposits, cashflowWithdrawals } = React.useMemo(() => {
    if (!dayData?.trades?.length) {
      return {
        totalPnL: 0,
        avgTimeInPosition: 0,
        accountCount: 0,
        maxDrawdown: 0,
        maxProfit: 0,
        cashflowDeposits: 0,
        cashflowWithdrawals: 0,
      }
    }

    // Separate real trades from cashflows
    const realTrades = dayData.trades.filter(t => !t.side || !cashflowSides.includes(t.side.toLowerCase()))
    const cashflows = dayData.trades.filter(t => t.side && cashflowSides.includes(t.side.toLowerCase()))

    const cashflowDeposits = cashflows
      .filter(t => depositSides.includes(t.side!.toLowerCase()))
      .reduce((sum, t) => sum + (t.pnl || 0), 0)
    const cashflowWithdrawals = cashflows
      .filter(t => withdrawSides.includes(t.side!.toLowerCase()))
      .reduce((sum, t) => sum + (t.pnl || 0), 0)

    // Calculate P&L for each account (only real trades)
    const accountPnL = realTrades.reduce((acc, trade) => {
      const accountNumber = trade.accountNumber || 'Unknown'
      const totalPnL = trade.pnl - (trade.commission || 0)
      acc[accountNumber] = (acc[accountNumber] || 0) + totalPnL
      return acc
    }, {} as Record<string, number>)

    const totalPnL = Object.values(accountPnL).reduce((sum, pnl) => sum + pnl, 0)
    const avgTimeInPosition = realTrades.length > 0
      ? realTrades.reduce((sum, trade) => sum + trade.timeInPosition, 0) / realTrades.length
      : 0
    const accountCount = Object.keys(accountPnL).length

    // Add sorting and equity curve (only real trades)
    const sortedTrades = [...realTrades].sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());
    const equity = [0];
    let cumulative = 0;
    sortedTrades.forEach(trade => {
      cumulative += trade.pnl - (trade.commission || 0);
      equity.push(cumulative);
    });

    // Calculate max drawdown
    let peak = -Infinity;
    let maxDD = 0;
    equity.forEach(val => {
      if (val > peak) peak = val;
      const dd = peak - val;
      if (dd > maxDD) maxDD = dd;
    });

    // Calculate max runup (profit)
    let trough = Infinity;
    let maxRU = 0;
    equity.forEach(val => {
      if (val < trough) trough = val;
      const ru = val - trough;
      if (ru > maxRU) maxRU = ru;
    });

    return {
      totalPnL,
      avgTimeInPosition,
      accountCount,
      maxDrawdown: maxDD,
      maxProfit: maxRU,
      cashflowDeposits,
      cashflowWithdrawals,
    }
  }, [dayData?.trades])

  if (!dayData?.trades?.length) {
    return null
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="flex flex-col">
          <CardHeader className="pb-1 flex-1">
            <CardTitle className="text-base md:text-lg">
              {isWeekly ? t('calendar.charts.weeklyPnlAfterComm') : t('calendar.charts.dailyPnlAfterComm')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2 mt-auto">
            <p className={`text-xl md:text-2xl font-bold ${totalPnL >= 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
              {formatCurrency(totalPnL)}
            </p>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">
              {t('calendar.charts.across')} {accountCount} {accountCount > 1 
                ? t('calendar.charts.accounts') 
                : t('calendar.charts.account')}
            </p>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="pb-1 flex-1">
            <CardTitle className="text-base md:text-lg">
              {isWeekly ? t('calendar.charts.weeklyAvgTimeInPosition') : t('calendar.charts.avgTimeInPosition')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2 mt-auto">
            <p className="text-xl md:text-2xl font-bold">
              {formatDuration(avgTimeInPosition)}
            </p>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">
              {t('calendar.charts.over')} {dayData.trades.length} {dayData.trades.length > 1 
                ? t('calendar.charts.trades') 
                : t('calendar.charts.trade')}
            </p>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="pb-1 flex-1">
            <CardTitle className="text-base md:text-lg">
              {isWeekly ? t('calendar.charts.weeklyMaxDrawdown') : t('calendar.charts.dailyMaxDrawdown')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2 mt-auto">
            <p className={`text-xl md:text-2xl font-bold ${maxDrawdown > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
              -{formatCurrency(maxDrawdown)}
            </p>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="pb-1 flex-1">
            <CardTitle className="text-base md:text-lg">
              {isWeekly ? t('calendar.charts.weeklyMaxProfit') : t('calendar.charts.dailyMaxProfit')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2 mt-auto">
            <p className={`text-xl md:text-2xl font-bold ${maxProfit > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground'}`}>
              {formatCurrency(maxProfit)}
            </p>
          </CardContent>
        </Card>
      </div>
      {/* Cashflow indicators */}
      {(cashflowDeposits !== 0 || cashflowWithdrawals !== 0) && (
        <div className="flex flex-wrap gap-3">
          {cashflowDeposits !== 0 && (
            <Card className="flex-1 min-w-[140px] border-yellow-500/30 bg-yellow-50/50 dark:bg-yellow-900/10">
              <CardContent className="p-3 flex items-center gap-2">
                <span className="text-sm text-yellow-600 dark:text-yellow-400 font-medium">入金</span>
                <span className="text-lg font-bold text-yellow-600 dark:text-yellow-400 font-mono">
                  +{formatCurrency(cashflowDeposits)}
                </span>
              </CardContent>
            </Card>
          )}
          {cashflowWithdrawals !== 0 && (
            <Card className="flex-1 min-w-[140px] border-yellow-500/30 bg-yellow-50/50 dark:bg-yellow-900/10">
              <CardContent className="p-3 flex items-center gap-2">
                <span className="text-sm text-yellow-600 dark:text-yellow-400 font-medium">出金</span>
                <span className="text-lg font-bold text-yellow-600 dark:text-yellow-400 font-mono">
                  {formatCurrency(Math.abs(cashflowWithdrawals))}
                </span>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
} 