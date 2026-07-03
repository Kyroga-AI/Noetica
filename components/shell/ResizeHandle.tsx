'use client'

import type { Resizable } from './useResizable'

/**
 * The draggable vertical seam between two shell panels. A wide (invisible) hit
 * target with a thin visible rule that lights up on hover/drag — so the whole
 * seam is grabbable, not just a 1px line. Double-click resets the panel width.
 */
export function ResizeHandle({
  resizable,
  ariaLabel,
}: {
  resizable: Pick<Resizable, 'onPointerDown' | 'reset' | 'dragging'>
  ariaLabel: string
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={resizable.onPointerDown}
      onDoubleClick={resizable.reset}
      className="group relative z-30 -mx-1 flex w-2 shrink-0 cursor-col-resize touch-none select-none items-stretch"
    >
      <span
        className={`pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all ${
          resizable.dragging
            ? 'w-0.5 bg-[var(--color-accent-primary,#6366f1)]'
            : 'w-px bg-transparent group-hover:w-0.5 group-hover:bg-[var(--color-accent-primary,#6366f1)]'
        }`}
      />
    </div>
  )
}
