// The Noetica wordmark glyph — Direction A: an italic-serif N with a true subscript
// zero (N₀). Uses currentColor so it inherits the avatar's text colour. Scale via the
// className (e.g. "h-4 w-4"); the viewBox keeps the glyph centred at any size.
export function NoeticaMark({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <text x="8.5" y="17.5" fontFamily="var(--font-serif), Georgia, 'Times New Roman', serif" fontStyle="italic" fontWeight={700} fontSize="19" fill="currentColor" textAnchor="middle">N</text>
      <text x="17.5" y="20.5" fontFamily="var(--font-serif), Georgia, 'Times New Roman', serif" fontStyle="italic" fontWeight={700} fontSize="9" fill="currentColor" textAnchor="middle">0</text>
    </svg>
  )
}

type LockupSize = 22 | 28 | 36

const TILE_RADIUS: Record<LockupSize, number> = { 22: 6, 28: 8, 36: 10 }
const N_SIZE: Record<LockupSize, number> = { 22: 11, 28: 15, 36: 19 }
const ZERO_SIZE: Record<LockupSize, number> = { 22: 6, 28: 7, 36: 9 }
const DOT_SIZE: Record<LockupSize, number> = { 22: 0, 28: 10, 36: 11 }

/**
 * The full brand lockup — Direction A glyph in a rounded-square tile, with an
 * optional live status dot (green in SourceOS mode, neutral gray in standalone).
 * Used in the Titlebar (22px, no dot), Sidebar (28px, dot), and the empty-chat
 * greeting (36px, dot). Ring color around the dot matches the tile's own
 * surrounding background so it visually "punches out."
 */
export function BrandLockup({
  size = 28,
  mode,
  ringColor = 'var(--paper-sunk)',
  className = '',
}: {
  size?: LockupSize
  mode?: 'standalone' | 'sourceos'
  ringColor?: string
  className?: string
}) {
  const dotSize = DOT_SIZE[size]
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: TILE_RADIUS[size],
        background: 'var(--ink)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-serif), Georgia, serif',
          fontStyle: 'italic',
          fontWeight: 700,
          fontSize: N_SIZE[size],
          color: 'var(--paper)',
          lineHeight: 1,
        }}
      >
        N
        <span style={{ fontSize: ZERO_SIZE[size], verticalAlign: 'sub', marginLeft: -1 }}>0</span>
      </span>
      {mode && dotSize > 0 && (
        <div
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: dotSize,
            height: dotSize,
            borderRadius: '50%',
            background: mode === 'sourceos' ? 'var(--verified)' : 'var(--ink3)',
            border: `2px solid ${ringColor}`,
          }}
        />
      )}
    </div>
  )
}
