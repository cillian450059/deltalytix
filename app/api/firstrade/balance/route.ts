import { NextRequest, NextResponse } from 'next/server'
import { fetchAndSaveDailyEquity } from '@/app/[locale]/dashboard/components/import/firstrade/sync/actions'
import { getUserId } from '@/server/auth'

export async function POST(request: NextRequest) {
  try {
    await getUserId()
    const body = await request.json()
    const { sessionId } = body

    if (!sessionId) {
      return NextResponse.json(
        { success: false, message: 'sessionId is required' },
        { status: 400 },
      )
    }

    const result = await fetchAndSaveDailyEquity(sessionId)

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.error },
        { status: 400 },
      )
    }

    return NextResponse.json({
      success: true,
      equity: result.equity,
      message: 'Daily equity saved',
    })
  } catch (error) {
    console.error('Error saving daily equity:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to save daily equity' },
      { status: 500 },
    )
  }
}
