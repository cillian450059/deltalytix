import { NextRequest, NextResponse } from 'next/server'
import { loginFirstrade } from '@/app/[locale]/dashboard/components/import/firstrade/sync/actions'
import { getUserId } from '@/server/auth'

export async function POST(request: NextRequest) {
  try {
    await getUserId() // ensure user is authenticated
    const body = await request.json()
    const { username, password, pin } = body

    if (!username || !password) {
      return NextResponse.json(
        { success: false, message: 'Username and password are required' },
        { status: 400 },
      )
    }

    const result = await loginFirstrade(username, password, pin)

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.error },
        { status: 401 },
      )
    }

    return NextResponse.json({
      success: true,
      sessionId: result.sessionId,
      requiresOtp: result.requiresOtp,
    })
  } catch (error) {
    console.error('Error during Firstrade login:', error)
    return NextResponse.json(
      { success: false, message: 'Login failed' },
      { status: 500 },
    )
  }
}
