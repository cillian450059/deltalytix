'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, Trash2, Plus, RefreshCw, MoreVertical, AlertTriangle, WifiOff, Download } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import {
  loginFirstrade,
  submitFirstradeOtp,
  getFirstradeAccounts,
  storeFirstradeSync,
} from './actions'
import { useFirstradeSyncContext } from '@/context/firstrade-sync-context'

export function FirstradeCredentialsManager() {
  const {
    performSyncForAccount,
    performSyncForAllAccounts,
    accounts,
    deleteAccount,
    loadAccounts,
    isAutoSyncing,
    sessionId,
    setSessionId,
    serviceAvailable,
    needsReconnect,
  } = useFirstradeSyncContext()

  // Dialog states
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isOtpDialogOpen, setIsOtpDialogOpen] = useState(false)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)

  // Loading states
  const [isLoading, setIsLoading] = useState(false)
  const [isReloading, setIsReloading] = useState(false)

  // Form states
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')

  const handleLogin = useCallback(async () => {
    if (!username || !password) {
      toast.error('Username and password are required')
      return
    }

    try {
      setIsLoading(true)
      const result = await loginFirstrade(username, password)

      if (!result.success) {
        toast.error(result.error || 'Login failed')
        return
      }

      // Clear credentials from memory immediately after sending
      setUsername('')
      setPassword('')

      setSessionId(result.sessionId || null)

      if (result.requiresOtp) {
        // Need OTP - show OTP dialog
        setIsAddDialogOpen(false)
        setIsOtpDialogOpen(true)
        toast.info('Firstrade has sent a verification code to your phone/email')
        return
      }

      // Login succeeded without OTP - fetch accounts
      await handlePostLogin(result.sessionId!)
    } catch (error) {
      toast.error('Login failed')
    } finally {
      setIsLoading(false)
    }
  }, [username, password])

  const handleOtpSubmit = useCallback(async () => {
    if (!sessionId || !otpCode) {
      toast.error('Please enter the verification code')
      return
    }

    try {
      setIsLoading(true)
      const result = await submitFirstradeOtp(sessionId, otpCode)

      if (!result.success) {
        toast.error(result.error || 'OTP verification failed')
        return
      }

      setIsOtpDialogOpen(false)
      toast.success('Verification successful')

      // Fetch accounts after OTP
      await handlePostLogin(sessionId)
    } catch (error) {
      toast.error('OTP verification failed')
    } finally {
      setIsLoading(false)
    }
  }, [sessionId, otpCode])

  const handlePostLogin = useCallback(async (sid: string) => {
    try {
      // Get account numbers
      const accountsResult = await getFirstradeAccounts(sid)

      if (!accountsResult.success || !accountsResult.accounts?.length) {
        toast.error('No accounts found')
        return
      }

      // Store sync records for each account
      let allTokensStored = true
      for (const acctId of accountsResult.accounts) {
        const storeResult = await storeFirstradeSync(acctId, sid)
        if (!storeResult.tokenStored) allTokensStored = false
      }

      // Reset form
      setUsername('')
      setPassword('')
      setOtpCode('')
      setIsAddDialogOpen(false)

      // Clear DailyBalanceFetcher cache so it re-runs today
      localStorage.removeItem('ft_balance_fetch_date')

      if (!allTokensStored) {
        toast.warning('已連線但 session 儲存失敗，自動同步可能無法運作。請確認 Firstrade 服務是否正常。', { duration: 8000 })
      }
      toast.success(`Connected ${accountsResult.accounts.length} account(s). Syncing trades...`)
      await loadAccounts()

      // Trigger initial sync for each account
      for (const acctId of accountsResult.accounts) {
        try {
          const result = await performSyncForAccount(acctId, sid)
          if (result?.success) {
            toast.success(result.message)
          } else if (result?.message) {
            toast.error(result.message)
          }
        } catch (err) {
          console.error(`[Firstrade] Initial sync failed for ${acctId}:`, err)
        }
      }
    } catch (error) {
      toast.error('Failed to fetch accounts')
    }
  }, [loadAccounts, performSyncForAccount])

  const handleDelete = useCallback(
    async (accountId: string) => {
      try {
        await deleteAccount(accountId)
        setIsDeleteDialogOpen(false)
        toast.success(`Account ${accountId} removed`)
      } catch (error) {
        toast.error(`Failed to remove account ${accountId}`)
      }
    },
    [deleteAccount],
  )

  const handleReloadAccounts = useCallback(async () => {
    try {
      setIsReloading(true)
      await loadAccounts()
      toast.success('Accounts refreshed')
    } catch (error) {
      toast.error('Failed to refresh accounts')
    } finally {
      setIsReloading(false)
    }
  }, [loadAccounts])

  const [isSyncingTrades, setIsSyncingTrades] = useState(false)
  const [syncDays, setSyncDays] = useState(365)

  const handleSyncTrades = useCallback(async (days: number) => {
    setIsSyncingTrades(true)
    try {
      const resp = await fetch(`/api/firstrade/sync-trades?days=${days}`, { method: 'POST' })
      const data = await resp.json()
      if (!resp.ok) {
        toast.error(data.error || '同步失敗')
        return
      }
      const total = data.results?.reduce((s: number, r: any) => s + (r.savedCount ?? 0), 0) ?? 0
      const errors = data.results?.filter((r: any) => r.error).map((r: any) => r.error) ?? []
      if (errors.includes('session_expired') || errors.includes('no_session_stored')) {
        toast.error('連線已過期，請重新連線 Firstrade')
      } else if (total > 0) {
        toast.success(`已同步 ${total} 筆新交易（${days} 天）`)
      } else {
        toast.success(`無新交易（${days} 天內已是最新）`)
      }
    } catch {
      toast.error('同步失敗，請稍後再試')
    } finally {
      setIsSyncingTrades(false)
    }
  }, [])

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleString()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Connected Accounts</h2>
            <Button
              onClick={handleReloadAccounts}
              size="sm"
              variant="ghost"
              disabled={isReloading}
              className="h-8 w-8 p-0"
            >
              {isReloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
          <div className="flex gap-2 items-center">
            {accounts.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isSyncingTrades}
                    className="h-8"
                  >
                    {isSyncingTrades ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    同步交易
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-2" align="end">
                  <div className="flex flex-col gap-1 text-sm">
                    <p className="text-xs text-muted-foreground px-2 pb-1">選擇同步範圍</p>
                    {[
                      { label: '最近 30 天', days: 30 },
                      { label: '最近 90 天', days: 90 },
                      { label: '最近 1 年', days: 365 },
                      { label: '最近 3 年', days: 1095 },
                      { label: '全部（5 年）', days: 1825 },
                    ].map(({ label, days }) => (
                      <Button
                        key={days}
                        variant="ghost"
                        size="sm"
                        className="justify-start h-8"
                        onClick={() => handleSyncTrades(days)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {sessionId && accounts.length > 0 && (
              <Button
                onClick={async () => {
                  await performSyncForAllAccounts(sessionId)
                }}
                size="sm"
                variant="outline"
                disabled={isAutoSyncing}
                className="h-8"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Sync All
              </Button>
            )}
            <Button
              onClick={() => setIsAddDialogOpen(true)}
              disabled={isLoading}
              size="sm"
              className="h-8"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Add Account
            </Button>
          </div>
        </div>
      </div>

      {serviceAvailable === false && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 text-red-800 dark:text-red-200 text-sm">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>Firstrade 同步服務未啟動。請確認 firstrade-service 正在運行。</span>
        </div>
      )}

      {needsReconnect && serviceAvailable !== false && accounts.length > 0 && (
        <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-200 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Firstrade 連線已過期，請重新登入以恢復自動同步。</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsAddDialogOpen(true)}
            className="shrink-0 h-7 text-xs"
          >
            重新連線
          </Button>
        </div>
      )}

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Last Synced</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.accountId}>
                <TableCell className="font-medium">{account.accountId}</TableCell>
                <TableCell>{formatDate(account.lastSyncedAt.toISOString())}</TableCell>
                <TableCell>
                  <span
                    className={`px-2 py-1 rounded text-xs ${
                      account.hasToken && !account.needsReauth
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                    }`}
                  >
                    {account.hasToken && !account.needsReauth
                      ? 'Connected'
                      : account.needsReauth
                        ? '連線已過期'
                        : '尚未連線'}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex justify-center items-center gap-2">
                    {(!account.hasToken || account.needsReauth) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsAddDialogOpen(true)}
                        className="h-8"
                      >
                        重新連線
                      </Button>
                    )}
                    {sessionId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          await performSyncForAccount(account.accountId, sessionId)
                        }}
                        disabled={isAutoSyncing}
                      >
                        <RefreshCw className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    )}
                    <Popover modal>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-48 p-2" align="end">
                        <div className="flex flex-col space-y-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="justify-start text-destructive hover:text-destructive"
                            onClick={() => {
                              setSelectedAccountId(account.accountId)
                              setIsDeleteDialogOpen(true)
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {accounts.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                  No connected accounts. Click &quot;Add Account&quot; to connect your Firstrade account.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Login Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Firstrade Account</DialogTitle>
            <DialogDescription>
              Enter your Firstrade credentials. Your login info is used to establish a session and is not stored.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="ft-username">Username / Email</Label>
              <Input
                id="ft-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your Firstrade username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ft-password">Password</Label>
              <Input
                id="ft-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your Firstrade password"
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleLogin} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Connect'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* OTP Dialog */}
      <Dialog open={isOtpDialogOpen} onOpenChange={setIsOtpDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verification Code</DialogTitle>
            <DialogDescription>
              Firstrade has sent a verification code to your phone. Please enter it below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="ft-otp">Verification Code</Label>
              <Input
                id="ft-otp"
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="Enter 6-digit code"
                maxLength={8}
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setIsOtpDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleOtpSubmit} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove account {selectedAccountId}? This will not delete any imported trades.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end space-x-2 mt-4">
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedAccountId && handleDelete(selectedAccountId)}
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
