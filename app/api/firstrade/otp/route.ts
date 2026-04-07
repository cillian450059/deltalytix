import { NextRequest, NextResponse } from 'next/server'
import { submitFirstradeOtp } from '@/app/[locale]/dashboard/components/import/firstrade/sync/actions'
import { getUserId } from '@/server/auth'

export async function POST(request: NextRequest) {
  try {
    await getUserId() // ensure user is authenticated
    const body = await request.json()
    const { sessionId, otpCode } = body

    if (!sessionId || !otpCode) {
      return NextResponse.json(
        { success: false, message: 'sessionId and otpCode are required' },
        { status: 400 },
      )
    }

    const result = await submitFirstradeOtp(sessionId, otpCode)

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.error },
        { status: 401 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error during Firstrade OTP:', error)
    return NextResponse.json(
      { success: false, message: 'OTP verification failed' },
      { status: 500 },
    )
  }
}
