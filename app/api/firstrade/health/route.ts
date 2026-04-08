import { NextResponse } from 'next/server'

const FT_URL = process.env.FIRSTRADE_SERVICE_URL || 'http://localhost:8100'

export async function GET() {
  try {
    const resp = await fetch(`${FT_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    if (resp.ok) {
      return NextResponse.json({ available: true })
    }
    return NextResponse.json({ available: false, reason: `HTTP ${resp.status}` })
  } catch {
    return NextResponse.json({ available: false, reason: 'Service unreachable' })
  }
}
