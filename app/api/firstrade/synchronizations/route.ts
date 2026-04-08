import { NextRequest, NextResponse } from 'next/server'
import {
  getFirstradeSynchronizations,
  removeFirstradeSync,
} from '@/app/[locale]/dashboard/components/import/firstrade/sync/actions'
import { createClient } from '@/server/auth'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })

    const result = await getFirstradeSynchronizations()
    if (result.error) {
      return NextResponse.json(
        { success: false, message: result.error },
        { status: 400 },
      )
    }

    const sanitized = (result.synchronizations || []).map(({ token, ...rest }) => {
      return {
        ...rest,
        hasToken: !!token && token.length > 0,
        needsReauth: !!rest.needsReauth,
      }
    })

    return NextResponse.json({
      success: true,
      data: sanitized,
    })
  } catch (error) {
    console.error('Error fetching Firstrade synchronizations:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch Firstrade synchronizations' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    const body = await request.json()
    const accountId = body?.accountId as string | undefined

    if (!accountId) {
      return NextResponse.json(
        { success: false, message: 'accountId is required' },
        { status: 400 },
      )
    }

    const result = await removeFirstradeSync(accountId)
    if (result.error) {
      return NextResponse.json(
        { success: false, message: result.error },
        { status: 400 },
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Synchronization removed',
    })
  } catch (error) {
    console.error('Error deleting Firstrade synchronization:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete synchronization' },
      { status: 500 },
    )
  }
}
