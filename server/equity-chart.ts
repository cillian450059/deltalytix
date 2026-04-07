"use server";

import { createClient } from "./auth";
import { prisma } from "@/lib/prisma";
import {
  computeEquityChartData,
  type EquityChartParams,
  type EquityChartResult,
} from "@/lib/equity-chart";

export type { EquityChartParams, EquityChartResult } from "@/lib/equity-chart";

export async function getEquityChartDataAction(
  params: EquityChartParams
): Promise<EquityChartResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Unauthorized");
  }

  try {
    const [trades, accounts, groups, dailyEquities] = await prisma.$transaction([
      prisma.trade.findMany({
        where: { userId: user.id },
        orderBy: { entryDate: "desc" },
      }),
      prisma.account.findMany({
        where: { userId: user.id },
        include: { payouts: true },
      }),
      prisma.group.findMany({
        where: { userId: user.id },
        include: { accounts: true },
      }),
      prisma.dailyEquity.findMany({
        where: { userId: user.id },
        orderBy: { date: "asc" },
      }),
    ]);

    const result = computeEquityChartData(
      trades.map((t) => ({
        entryDate: t.entryDate,
        accountNumber: t.accountNumber,
        instrument: t.instrument,
        pnl: t.pnl,
        commission: t.commission,
        timeInPosition: t.timeInPosition,
        tags: t.tags,
      })),
      accounts.map((a) => ({
        number: a.number,
        groupId: a.groupId,
        startingBalance: a.startingBalance,
        resetDate: a.resetDate,
        payouts: (a.payouts ?? []).map((p) => ({
          date: p.date,
          amount: p.amount,
          status: p.status,
        })),
      })),
      groups.map((g) => ({
        id: g.id,
        name: g.name,
        accounts: (g.accounts ?? []).map((a) => ({ number: a.number })),
      })),
      params
    );

    // Merge DailyEquity snapshots into chart data points
    // Each snapshot represents the actual portfolio value on that date
    if (dailyEquities.length > 0) {
      const equityByDate = new Map<string, number>()
      for (const de of dailyEquities) {
        const dateKey = new Date(de.date).toISOString().split("T")[0]
        // Sum equity across all accounts for same date
        equityByDate.set(dateKey, (equityByDate.get(dateKey) ?? 0) + de.equity)
      }

      for (const point of result.chartData) {
        const dateKey = point.date.split("T")[0]
        const actualEquity = equityByDate.get(dateKey)
        if (actualEquity !== undefined) {
          point.actualEquity = actualEquity
        }
      }
    }

    return result;
  } catch (error) {
    console.error("[getEquityChartData] Error:", error);
    throw new Error("Failed to fetch equity chart data");
  }
}
