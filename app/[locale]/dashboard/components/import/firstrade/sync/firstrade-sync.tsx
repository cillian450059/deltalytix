'use client'

import { FirstradeCredentialsManager } from './firstrade-credentials-manager'

export function FirstradeSync() {
  return (
    <div className="flex flex-col space-y-6 p-6">
      <div className="flex flex-col space-y-2">
        <h2 className="text-lg font-semibold">Firstrade Account Sync</h2>
        <p className="text-sm text-muted-foreground">
          Connect your Firstrade account to automatically sync trades. Your credentials are only used to establish a session and are not stored permanently.
        </p>
      </div>
      <FirstradeCredentialsManager />
    </div>
  )
}
