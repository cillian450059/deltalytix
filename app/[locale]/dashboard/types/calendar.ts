import { Trade } from "@/prisma/generated/prisma/browser";

export interface CalendarEntry {
  pnl: number;
  tradeNumber: number;
  longNumber: number;
  shortNumber: number;
  trades: Trade[];
  equity?: number;   // account NAV from DailyEquity (if available)
  cash?: number;
}

export interface CalendarData {
  [date: string]: CalendarEntry;
}

export interface DailyEquityRecord {
  date: string;        // YYYY-MM-DD
  equity: number;
  cash: number;
  accountNumber: string;
}
