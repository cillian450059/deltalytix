import { NextRequest, NextResponse } from 'next/server'
import {
  syncFirstradeTrades,
} from '@/app/[locale]/dashboard/components/import/firstrade/sync/actions'
import { getUserId } from '@/server/auth'

export async function POST(request: NextRequest) {
  try {
    await getUserId() // ensure user is authenticated
    const body = await request.json()
    const { sessionId, accountId, days } = body

    if (!sessionId || !accountId) {
      return NextResponse.json(
        { success: false, message: 'sessionId and accountId are required' },
        { status: 400 },
      )
    }

    const result = await syncFirstradeTrades(sessionId, accountId, days)

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.error },
        { status: 400 },
      )
    }

    return NextResponse.json({
      success: true,
      savedCount: result.savedCount ?? 0,
      tradesCount: result.tradesCount ?? 0,
      message: 'Sync completed',
    })
  } catch (error) {
    console.error('Error performing Firstrade sync:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to perform Firstrade sync' },
      { status: 500 },
    )
  }
}
