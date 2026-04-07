'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Trade } from '@/prisma/generated/prisma/browser'
import { generateTradeHash } from '@/lib/utils'
import { PlatformProcessorProps } from '../config/platforms'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// Firstrade Transaction History CSV columns:
// Symbol, Date, Action, Quantity, Price, Commission, Amount, Description
// OR with account:
// Account Number, Trade Date, Settlement Date, Symbol, Buy/Sell, Quantity, Price, Amount, Commission, Description

const columnMappings: { [key: string]: string } = {
  "Symbol": "instrument",
  "Trade Date": "date",
  "Date": "date",
  "Buy/Sell": "action",
  "Action": "action",
  "Quantity": "quantity",
  "Price": "price",
  "Amount": "amount",
  "Commission": "commission",
  "Account Number": "accountNumber",
  "Account": "accountNumber",
}

interface FirstradeOrder {
  instrument: string
  date: Date
  action: 'buy' | 'sell'
  quantity: number
  originalQuantity: number
  price: number
  commission: number
  accountNumber: string
  rowIndex: number
}

// Parse MM/DD/YYYY or YYYY-MM-DD date strings
const parseDate = (dateStr: string): Date | null => {
  if (!dateStr) return null

  const usMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (usMatch) {
    const [, month, day, year] = usMatch
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 9, 30, 0)
  }

  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 9, 30, 0)
  }

  return null
}

// Parse values like "$1,234.56", "(500.00)", "-123.45"
const parseAmount = (val: string): number => {
  if (!val) return 0
  const isNegative = val.includes('(') || val.startsWith('-')
  const num = parseFloat(val.replace(/[$,() -]/g, ''))
  return isNaN(num) ? 0 : (isNegative ? -Math.abs(num) : Math.abs(num))
}

export default function FirstradeProcessor({ headers, csvData, setProcessedTrades }: PlatformProcessorProps) {
  const [trades, setTrades] = useState<Trade[]>([])

  const processTrades = useCallback(() => {
    // Step 1: Parse individual buy/sell orders from CSV
    const orders: FirstradeOrder[] = []

    csvData.forEach((row, rowIndex) => {
      if (row.length < 3 || row.every(cell => !cell)) return

      const item: Partial<FirstradeOrder> & { rowIndex: number } = { rowIndex }

      headers.forEach((header, index) => {
        const mappedKey = columnMappings[header.trim()]
        if (!mappedKey) return

        const cellValue = row[index]?.trim()
        if (!cellValue) return

        switch (mappedKey) {
          case 'instrument':
            item.instrument = cellValue.toUpperCase()
            break
          case 'date': {
            const d = parseDate(cellValue)
            if (d) item.date = d
            break
          }
          case 'action':
            if (cellValue.toLowerCase().includes('buy')) item.action = 'buy'
            else if (cellValue.toLowerCase().includes('sell')) item.action = 'sell'
            break
          case 'quantity':
            item.quantity = Math.abs(parseFloat(cellValue) || 0)
            break
          case 'price':
            item.price = parseAmount(cellValue)
            break
          case 'commission':
            item.commission = Math.abs(parseAmount(cellValue))
            break
          case 'accountNumber':
            item.accountNumber = cellValue
            break
        }
      })

      if (
        item.instrument &&
        item.date &&
        item.action &&
        item.quantity &&
        item.quantity > 0 &&
        item.price !== undefined &&
        item.price > 0
      ) {
        orders.push({
          ...item,
          originalQuantity: item.quantity,
          commission: item.commission ?? 0,
          accountNumber: item.accountNumber ?? 'Firstrade',
        } as FirstradeOrder)
      }
    })

    // Step 2: Sort chronologically
    orders.sort((a, b) => a.date.getTime() - b.date.getTime())

    // Step 3: FIFO matching — pair buy orders with sell orders per symbol+account
    const newTrades: Trade[] = []
    const buyQueues = new Map<string, FirstradeOrder[]>()

    orders.forEach(order => {
      const key = `${order.accountNumber}|${order.instrument}`

      if (order.action === 'buy') {
        if (!buyQueues.has(key)) buyQueues.set(key, [])
        buyQueues.get(key)!.push({ ...order })
      } else if (order.action === 'sell') {
        const queue = buyQueues.get(key)
        if (!queue || queue.length === 0) return // unmatched sell (short not yet supported)

        let remainingSellQty = order.quantity

        while (remainingSellQty > 0 && queue.length > 0) {
          const buyOrder = queue[0]
          const matchedQty = Math.min(remainingSellQty, buyOrder.quantity)

          // Proportional commission allocation
          const buyCommission = buyOrder.commission * (matchedQty / buyOrder.originalQuantity)
          const sellCommission = order.commission * (matchedQty / order.originalQuantity)

          const grossPnl = (order.price - buyOrder.price) * matchedQty
          const totalCommission = buyCommission + sellCommission

          const trade: Partial<Trade> = {
            instrument: order.instrument,
            accountNumber: order.accountNumber,
            side: 'long',
            quantity: matchedQty,
            entryPrice: buyOrder.price.toFixed(4),
            closePrice: order.price.toFixed(4),
            entryDate: buyOrder.date.toISOString(),
            closeDate: order.date.toISOString(),
            pnl: parseFloat(grossPnl.toFixed(2)),
            commission: parseFloat(totalCommission.toFixed(2)),
            timeInPosition: (order.date.getTime() - buyOrder.date.getTime()) / 1000,
          }
          trade.id = generateTradeHash({
            ...trade as Trade,
            entryId: `firstrade-${buyOrder.rowIndex}-${order.rowIndex}`,
          }).toString()

          newTrades.push(trade as Trade)

          remainingSellQty -= matchedQty
          buyOrder.quantity -= matchedQty
          if (buyOrder.quantity <= 0) queue.shift()
        }
      }
    })

    setTrades(newTrades)
    setProcessedTrades(newTrades)
  }, [csvData, headers, setProcessedTrades])

  useEffect(() => {
    processTrades()
  }, [processTrades])

  const totalPnL = useMemo(() => trades.reduce((sum, t) => sum + (t.pnl || 0), 0), [trades])
  const totalCommission = useMemo(() => trades.reduce((sum, t) => sum + (t.commission || 0), 0), [trades])
  const uniqueInstruments = useMemo(() => Array.from(new Set(trades.map(t => t.instrument))), [trades])

  return (
    <Card className="h-full flex flex-col w-full overflow-x-scroll">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b shrink-0 p-3 sm:p-4 h-[56px]">
        <CardTitle className="line-clamp-1 text-base">
          Processed Trades — Firstrade
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-auto p-0">
        <div className="flex h-full flex-col min-w-fit">
          <Table className="w-full h-full border-separate border-spacing-0">
            <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur-xs shadow-xs border-b">
              <TableRow>
                {['Account', 'Instrument', 'Side', 'Qty', 'Entry Price', 'Close Price', 'Entry Date', 'Close Date', 'PnL', 'Time in Position', 'Commission'].map(h => (
                  <TableHead key={h} className="whitespace-nowrap px-3 py-2 text-left text-sm font-semibold bg-muted/90 border-r border-border last:border-r-0 first:border-l">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="flex-1 overflow-auto bg-background">
              {trades.length > 0 ? trades.map(trade => (
                <TableRow key={trade.id} className="border-b border-border transition-all duration-75 hover:bg-muted/40">
                  <TableCell className="whitespace-nowrap px-3 py-2 text-sm border-r border-border/50 last:border-r-0 first:border-l">{trade.accountNumber}</TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2 text-sm border-r border-border/50 last:border-r-0 first:border-l">{trade.instrument}</TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2 text-sm border-r border-border/50 last:border-r-0 first:border-l">{trade.side}</TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2 text-sm border-r border-border/50 last:border-r-0 first:border-l">{trade.quantity}</TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2 text-sm border-r border-border/50 last:border-r-0 first:border-l">{trade.entryPrice}</TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2 text-sm border-r border-border/50 last:border-r-0 first:border-l">{trade.closePrice || '-'}</TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2 text-sm border-r border-border/50 last:border-r-0 first:border-l">{new Date(trade.entryDate).toLocaleDateString()}</TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2 text-sm border-r border-border/50 last:border-r-0 first:border-l">{trade.closeDate ? new Date(trade.closeDate).toLocaleDateString() : '-'}</TableCell>
                  <TableCell className={`whitespace-nowrap px-3 py-2 text-sm border-r border-border/50 last:border-r-0 first:border-l ${(trade.pnl || 0) >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                    ${trade.pnl?.toFixed(2)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2 text-sm border-r border-border/50 last:border-r-0 first:border-l">
                    {`${Math.floor((trade.timeInPosition || 0) / 86400)}d ${Math.floor(((trade.timeInPosition || 0) % 86400) / 3600)}h`}
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-2 text-sm border-r border-border/50 last:border-r-0 first:border-l">
                    ${trade.commission?.toFixed(2)}
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                    No trades found. Make sure your CSV has columns: Symbol, Date, Action (Buy/Sell), Quantity, Price, Commission.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t bg-background px-4 py-3 shrink-0">
        <div className="flex items-center gap-6">
          <div>
            <h3 className="text-sm font-semibold mb-1">Total PnL</h3>
            <p className={`text-lg font-bold ${totalPnL >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>
              ${totalPnL.toFixed(2)}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-1">Total Commission</h3>
            <p className="text-lg font-bold text-blue-600">
              ${totalCommission.toFixed(2)}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-1">Trades</h3>
            <p className="text-lg font-bold">{trades.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Symbols:</h3>
          <div className="flex flex-wrap gap-2">
            {uniqueInstruments.map(instrument => (
              <Button key={instrument} variant="outline" size="sm">{instrument}</Button>
            ))}
          </div>
        </div>
      </CardFooter>
    </Card>
  )
}
