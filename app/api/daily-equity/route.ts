import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/server/auth'
import { prisma } from '@/lib/prisma'

// GET /api/daily-equity?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns DailyEquity records for the authenticated user within the date range.
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id

    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    const where: Record<string, unknown> = { userId }
    if (from || to) {
      where.date = {
        ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
      }
    }

    const records = await prisma.dailyEquity.findMany({
      where,
      orderBy: { date: 'asc' },
      select: { date: true, equity: true, cash: true, accountNumber: true },
    })

    // Return as { date: 'YYYY-MM-DD', equity, cash, accountNumber }[]
    const data = records.map((r) => ({
      date: r.date.toISOString().split('T')[0],
      equity: r.equity,
      cash: r.cash,
      accountNumber: r.accountNumber,
    }))

    return NextResponse.json(data)
  } catch (err) {
    console.error('[DailyEquity API]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
