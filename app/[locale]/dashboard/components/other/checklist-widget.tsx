'use client'

import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChecklistStore } from '@/store/widgets/checklist-store'

function YellowCheckbox({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: () => void
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border-2 transition-colors',
        checked
          ? 'border-yellow-400 bg-yellow-400'
          : 'border-muted-foreground/40 bg-transparent hover:border-yellow-400'
      )}
      aria-checked={checked}
      role="checkbox"
    >
      {checked && (
        <svg
          viewBox="0 0 10 8"
          fill="none"
          className="h-2.5 w-2.5"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M1 4L3.5 6.5L9 1"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  )
}

export default function ChecklistWidget() {
  const { items, addItem, toggleItem, removeItem } = useChecklistStore()
  const [inputValue, setInputValue] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Avoid SSR/hydration mismatch with localStorage
  useEffect(() => {
    setMounted(true)
  }, [])

  const handleAdd = () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    addItem(trimmed)
    setInputValue('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleAdd()
  }

  // Unchecked first, then checked
  const sorted = mounted
    ? [
        ...items.filter((i) => !i.completed),
        ...items.filter((i) => i.completed),
      ]
    : []

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-shrink-0 pb-2 pt-3 px-3">
        <CardTitle className="text-sm font-semibold">Checklist</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-2 overflow-hidden px-3 pb-3">
        {/* Input row */}
        <div className="flex gap-1.5">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add ticker or note…"
            className="h-7 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleAdd}
            disabled={!inputValue.trim()}
            className="h-7 w-7 flex-shrink-0 p-0"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {sorted.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-muted-foreground">No items yet</p>
            </div>
          ) : (
            <ul className="space-y-1">
              {sorted.map((item) => (
                <li
                  key={item.id}
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50"
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <YellowCheckbox
                    checked={item.completed}
                    onChange={() => toggleItem(item.id)}
                  />
                  <span
                    className={cn(
                      'flex-1 truncate text-xs transition-colors',
                      item.completed
                        ? 'text-muted-foreground/60 line-through'
                        : 'text-foreground'
                    )}
                    title={item.text}
                  >
                    {item.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className={cn(
                      'flex-shrink-0 rounded p-0.5 text-muted-foreground/40 transition-opacity hover:text-destructive',
                      hoveredId === item.id ? 'opacity-100' : 'opacity-0'
                    )}
                    aria-label="Remove item"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
