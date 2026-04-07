'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, Trash2, Plus, RefreshCw, MoreVertical } from 'lucide-react'
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
      for (const acctId of accountsResult.accounts) {
        await storeFirstradeSync(acctId, sid)
      }

      // Reset form
      setUsername('')
      setPassword('')
      setOtpCode('')
      setIsAddDialogOpen(false)

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
                      account.hasToken
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                    }`}
                  >
                    {account.hasToken ? 'Connected' : 'Session Expired'}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex justify-center items-center gap-2">
                    {!account.hasToken && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsAddDialogOpen(true)}
                        className="h-8"
                      >
                        Reconnect
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
