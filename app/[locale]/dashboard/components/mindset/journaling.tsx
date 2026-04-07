"use client"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/locales/client"
import { DayTagSelector } from "./day-tag-selector"
import { FinancialEvent, Trade } from "@/prisma/generated/prisma/browser"
import { TiptapEditor } from "@/components/tiptap-editor"
import { Loader2, Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface JournalingProps {
  content: string
  onChange: (content: string) => void
  onSave: () => void
  date: Date
  events: FinancialEvent[]
  selectedNews: string[]
  onNewsSelection: (newsIds: string[]) => void
  trades: Trade[]
  onApplyTagToAll: (tag: string) => Promise<void>
  autoSaveStatus?: 'idle' | 'saving' | 'saved'
}

export function Journaling({
  content,
  onChange,
  onSave,
  date,
  events,
  selectedNews,
  onNewsSelection,
  trades,
  onApplyTagToAll,
  autoSaveStatus = 'idle',
}: JournalingProps) {
  const t = useI18n()

  return (
    <div className="h-full flex flex-col">
      <div className="flex-none">
        <DayTagSelector
          trades={trades}
          date={date}
          onApplyTagToAll={onApplyTagToAll}
        />
      </div>

      <div className="flex-1 min-h-0 mt-4 flex flex-col">
          <TiptapEditor
            content={content}
            onChange={onChange}
            placeholder={t('mindset.journaling.placeholder')}
            width="100%"
            height="100%"
            events={events}
            selectedNews={selectedNews}
            onNewsSelection={onNewsSelection}
            date={date}
          />
      </div>

      <div className="flex-none flex items-center gap-3 mt-4">
        {/* Auto-save status indicator */}
        <div className={cn(
          "flex items-center gap-1.5 text-xs transition-opacity duration-300",
          autoSaveStatus === 'idle' ? "opacity-0" : "opacity-100"
        )}>
          {autoSaveStatus === 'saving' && (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Saving…</span>
            </>
          )}
          {autoSaveStatus === 'saved' && (
            <>
              <Check className="h-3 w-3 text-green-500" />
              <span className="text-green-500">Saved</span>
            </>
          )}
        </div>

        <Button
          onClick={onSave}
          className="flex-1"
        >
          {t('mindset.journaling.save')}
        </Button>
      </div>
    </div>
  )
}
