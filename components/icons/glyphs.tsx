// Shared monochrome glyph set — house style: 24×24 viewBox, currentColor,
// 1.4 stroke, aria-hidden. These replace colorful/pictographic emoji across the
// non-chat surfaces so the UI carries no emoji. Size inherits color from the
// parent (currentColor); pass `size` to scale.
import type { CSSProperties, ReactNode } from 'react'

type GlyphProps = { size?: number; className?: string; style?: CSSProperties }

function Glyph({ size = 16, className, style, children }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function GlyphDoc(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <path d="M6 3.5h7l5 5V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5z" />
      <path d="M13 3.5v5h5" />
      <path d="M9 13h6M9 16.5h6" />
    </Glyph>
  )
}

export function GlyphGlobe(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.5 2.4 3.8 5.3 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.3-3.8-8.5S9.5 5.9 12 3.5z" />
    </Glyph>
  )
}

export function GlyphShield(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <path d="M12 3l7 2.5v6c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9v-6L12 3z" />
      <path d="M9 12l2 2 4-4.5" />
    </Glyph>
  )
}

export function GlyphBug(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <rect x="7.5" y="8" width="9" height="10" rx="4.5" />
      <path d="M9.5 5l1.2 2M14.5 5l-1.2 2" />
      <path d="M7.5 12H4M7.5 15.5H4.5M16.5 12H20M16.5 15.5H19.5M7.8 18l-2 2M16.2 18l2 2" />
      <path d="M7.6 12.5h8.8" />
    </Glyph>
  )
}

export function GlyphBook(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <path d="M6.5 3.5H17a.5.5 0 0 1 .5.5v15a.5.5 0 0 1-.5.5H6.5A1.5 1.5 0 0 1 5 18V5a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M5 17.5h12.5" />
    </Glyph>
  )
}

export function GlyphBeaker(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <path d="M9.5 3.5v5.2L5 17a1.6 1.6 0 0 0 1.4 2.5h11.2A1.6 1.6 0 0 0 19 17l-4.5-8.3V3.5" />
      <path d="M8.5 3.5h7" />
      <path d="M7.8 13.5h8.4" />
    </Glyph>
  )
}

export function GlyphFlag(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <path d="M6 21V3.5" />
      <path d="M6 4.5h11l-2.4 3.5L17 11.5H6" />
    </Glyph>
  )
}

export function GlyphBolt(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <path d="M13 3L5.5 13h5.5L10 21l8.5-11H13l0-7z" />
    </Glyph>
  )
}

export function GlyphCheckSquare(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M8 12l2.8 2.8L16 9" />
    </Glyph>
  )
}

export function GlyphFolder(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <path d="M3.5 7a2 2 0 0 1 2-2h3.6l2 2.5H18.5a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7z" />
    </Glyph>
  )
}

export function GlyphDesktop(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <rect x="3.5" y="4.5" width="17" height="12" rx="1.5" />
      <path d="M9 20h6M12 16.5V20" />
    </Glyph>
  )
}

export function GlyphPencil(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <path d="M4 20l1.2-4L15.5 5.7a1.6 1.6 0 0 1 2.3 0l.5.5a1.6 1.6 0 0 1 0 2.3L8 18.8 4 20z" />
      <path d="M14 7.2l2.8 2.8" />
    </Glyph>
  )
}

export function GlyphImage(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 17l5-5 4 4 3-3 4 4" />
    </Glyph>
  )
}

export function GlyphNote(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Glyph>
  )
}

export function GlyphCode(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
    </Glyph>
  )
}

export function GlyphRobot(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <rect x="5" y="8.5" width="14" height="9.5" rx="2" />
      <path d="M12 8.5V5" />
      <circle cx="12" cy="4" r="1.2" />
      <path d="M9.5 12.5v1.5M14.5 12.5v1.5" />
      <path d="M5 12H3.5M19 12h1.5" />
    </Glyph>
  )
}

export function GlyphUser(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </Glyph>
  )
}

export function GlyphLock(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Glyph>
  )
}
