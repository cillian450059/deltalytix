'use client'

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Trash2, Save, ImageIcon, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/locales/client'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useData } from '@/context/data-provider'
import { useHashUpload } from '@/hooks/use-hash-upload'
import { useUserStore } from '@/store/user-store'
import {
  Dropzone,
  DropzoneContent,
  DropzoneEmptyState,
} from '@/components/ui/dropzone'
import { createClient } from '@/lib/supabase'
import { toast } from 'sonner'
import NextImage from 'next/image'

const supabase = createClient()

const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_IMAGES = 10
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

interface TradeCommentProps {
  tradeIds: string[]
  comment: string | null
  trade: any
  onCommentChange?: (comment: string | null) => void
}

export function TradeComment({
  tradeIds,
  comment: initialComment,
  trade,
  onCommentChange,
}: TradeCommentProps) {
  const t = useI18n()
  const { updateTrades } = useData()
  const user = useUserStore((state) => state.user)
  const [isOpen, setIsOpen] = useState(false)
  const [localComment, setLocalComment] = useState(initialComment || '')
  const [isUpdating, setIsUpdating] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showUpload, setShowUpload] = useState(false)

  // Re-initialise local state each time the dialog opens so it reflects the
  // latest saved value (avoids stale-closure issues from the old Popover approach)
  useEffect(() => {
    if (isOpen) {
      setLocalComment(initialComment || '')
      setShowUpload(false)
    }
  }, [isOpen, initialComment])

  // Current images on this trade (supports both new array and legacy fields)
  const imageArray: string[] =
    trade?.images && trade.images.length > 0
      ? trade.images
      : ([trade?.imageBase64, trade?.imageBase64Second].filter(Boolean) as string[])

  // Upload hook – same bucket/path as TradeImageEditor
  const uploadProps = useHashUpload({
    bucketName: 'trade-images',
    path: `${user?.id}/trades`,
    allowedMimeTypes: ACCEPTED_IMAGE_TYPES,
    maxFileSize: MAX_FILE_SIZE,
    maxFiles: MAX_IMAGES,
  })

  const handleUploadImages = useCallback(
    async (newUrls: string[]) => {
      const currentImages: string[] =
        trade?.images && trade.images.length > 0
          ? [...trade.images]
          : ([trade?.imageBase64, trade?.imageBase64Second].filter(Boolean) as string[])
      const updatedImages = [...currentImages, ...newUrls]
      await updateTrades(tradeIds, {
        images: updatedImages,
        imageBase64: updatedImages[0] ?? null,
        imageBase64Second: updatedImages[1] ?? null,
      } as any)
    },
    [trade, tradeIds, updateTrades],
  )

  // React to upload completion
  useEffect(() => {
    if (uploadProps.isSuccess && uploadProps.uploadedUrls.length > 0) {
      handleUploadImages(uploadProps.uploadedUrls).then(() => {
        toast.success(t('trade-table.imageUploadSuccess'))
        uploadProps.setFiles([])
        uploadProps.setErrors([])
        setShowUpload(false)
      })
    } else if (uploadProps.errors.length > 0) {
      toast.error(
        t('trade-table.imageUploadError', { error: uploadProps.errors[0].message }),
      )
    }
  }, [uploadProps.isSuccess, uploadProps.uploadedUrls, uploadProps.errors])

  // Clear upload state when the dropzone panel closes
  useEffect(() => {
    if (!showUpload) {
      uploadProps.setFiles([])
      uploadProps.setErrors([])
    }
  }, [showUpload])

  const handleRemoveImage = async (imageIndex: number) => {
    try {
      const currentImages: string[] =
        trade?.images && trade.images.length > 0
          ? [...trade.images]
          : ([trade?.imageBase64, trade?.imageBase64Second].filter(Boolean) as string[])
      const imageUrl = currentImages[imageIndex]
      const newImages = currentImages.filter((_: string, i: number) => i !== imageIndex)
      await updateTrades(tradeIds, {
        images: newImages,
        imageBase64: newImages[0] ?? null,
        imageBase64Second: newImages[1] ?? null,
      } as any)
      if (imageUrl) {
        const path = imageUrl.split('/storage/v1/object/public/trade-images/')[1]
        if (path) await supabase.storage.from('trade-images').remove([path])
      }
      toast.success('Image removed')
    } catch {
      toast.error('Failed to remove image')
    }
  }

  const handleSave = async () => {
    setIsUpdating(true)
    try {
      const newComment = localComment.trim() || null
      await updateTrades(tradeIds, { comment: newComment })
      onCommentChange?.(newComment)
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 1200)
      setIsOpen(false)
    } catch (error) {
      console.error('Failed to save comment:', error)
      toast.error('Failed to save comment')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleClear = async () => {
    setIsUpdating(true)
    try {
      await updateTrades(tradeIds, { comment: null })
      onCommentChange?.(null)
      setLocalComment('')
      setIsOpen(false)
    } catch (error) {
      console.error('Failed to clear comment:', error)
      toast.error('Failed to clear comment')
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            'h-8 w-full justify-start px-2 gap-2 truncate',
            !initialComment && 'text-muted-foreground font-normal',
          )}
        >
          <span className="truncate">{initialComment || t('trade-table.addComment')}</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('trade-table.comment')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Comment textarea */}
          <textarea
            placeholder={t('trade-table.addComment')}
            value={localComment}
            onChange={(e) => setLocalComment(e.target.value)}
            className={cn(
              'w-full px-3 py-2 text-sm bg-transparent border rounded min-h-[120px]',
              'focus:outline-none focus:ring-2 focus:ring-primary resize-none transition-all duration-200',
            )}
            autoFocus
          />

          {/* Attached images */}
          {imageArray.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                Images ({imageArray.length}/{MAX_IMAGES})
              </Label>
              <div className="flex flex-wrap gap-2">
                {imageArray.map((url: string, idx: number) => (
                  <div key={idx} className="relative group">
                    <NextImage
                      src={url}
                      alt={`Image ${idx + 1}`}
                      width={64}
                      height={64}
                      className="rounded object-cover border"
                      style={{ width: 64, height: 64 }}
                    />
                    <button
                      onClick={() => handleRemoveImage(idx)}
                      className="absolute -top-1.5 -right-1.5 h-4 w-4 bg-destructive text-destructive-foreground rounded-full hidden group-hover:flex items-center justify-center"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
                {imageArray.length < MAX_IMAGES && (
                  <button
                    onClick={() => setShowUpload((v) => !v)}
                    className="w-16 h-16 border-2 border-dashed border-muted-foreground/30 rounded flex items-center justify-center hover:border-muted-foreground/60 transition-colors"
                  >
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* "Add images" link when no images yet */}
          {imageArray.length === 0 && (
            <button
              type="button"
              onClick={() => setShowUpload((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              {showUpload ? 'Hide image upload' : 'Add images'}
            </button>
          )}

          {/* Dropzone */}
          {showUpload && (
            <div className="space-y-2">
              <Dropzone {...uploadProps}>
                {uploadProps.files.length > 0 ? (
                  <DropzoneContent />
                ) : (
                  <DropzoneEmptyState />
                )}
              </Dropzone>
              {uploadProps.files.length > 0 && !uploadProps.isSuccess && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={uploadProps.onUpload}
                  disabled={uploadProps.loading}
                >
                  {uploadProps.loading ? 'Uploading…' : 'Upload'}
                </Button>
              )}
            </div>
          )}

          {/* Footer actions */}
          <div className="flex justify-between pt-1">
            <Button
              variant="outline"
              size="sm"
              disabled={isUpdating || !localComment}
              onClick={handleClear}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('common.clear')}
            </Button>
            <Button size="sm" disabled={isUpdating} onClick={handleSave}>
              {showSuccess ? (
                '✓ Saved'
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {t('common.save')}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
