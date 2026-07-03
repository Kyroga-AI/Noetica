'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export interface UseResizableOptions {
  /** localStorage key so the width persists across reloads */
  storageKey: string
  /** default width in px (used until the stored value hydrates) */
  initial: number
  min: number
  max: number
  /**
   * Which panel this seam controls. 'left' = handle on the panel's RIGHT edge
   * (dragging right widens it). 'right' = handle on the panel's LEFT edge
   * (dragging left widens it). Mirrors the two shell panels.
   */
  side: 'left' | 'right'
}

export interface Resizable {
  width: number
  /** attach to the ResizeHandle */
  onPointerDown: (e: React.PointerEvent) => void
  /** double-click the seam to reset to the default */
  reset: () => void
  dragging: boolean
}

/**
 * A dependency-free draggable-width primitive for the shell panels. One hook per
 * seam; the same hook drives both the left sidebar and the right tool drawer so
 * they behave identically (drag, clamp, persist, double-click-to-reset).
 */
export function useResizable({ storageKey, initial, min, max, side }: UseResizableOptions): Resizable {
  const [width, setWidth] = useState(initial)
  const [dragging, setDragging] = useState(false)
  const widthRef = useRef(initial)

  // hydrate from localStorage AFTER mount (keeps SSR markup === first client render)
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey))
      if (Number.isFinite(saved) && saved > 0) {
        const w = clamp(saved, min, max)
        widthRef.current = w
        setWidth(w)
      }
    } catch { /* private mode / no storage — keep default */ }
  }, [storageKey, min, max])

  const reset = useCallback(() => {
    widthRef.current = initial
    setWidth(initial)
    try { localStorage.setItem(storageKey, String(initial)) } catch { /* ignore */ }
  }, [initial, storageKey])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startW = widthRef.current
    // lock the cursor + kill text selection while dragging
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const next = clamp(startW + (side === 'left' ? dx : -dx), min, max)
      widthRef.current = next
      setWidth(next)
    }
    const up = () => {
      setDragging(false)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      try { localStorage.setItem(storageKey, String(widthRef.current)) } catch { /* ignore */ }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [side, min, max])

  return { width, onPointerDown, reset, dragging }
}
