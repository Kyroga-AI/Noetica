// The Noetica wordmark glyph — an italic-serif N with a subscript zero (N₀), matching
// the app icon. Uses currentColor so it inherits the avatar's text colour. Scale via the
// className (e.g. "h-4 w-4"); the viewBox keeps the glyph centred at any size.
export function NoeticaMark({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <text x="8.5" y="17.5" fontFamily="Georgia, 'Times New Roman', serif" fontStyle="italic" fontWeight={600} fontSize="19" fill="currentColor" textAnchor="middle">N</text>
      <text x="17.5" y="20.5" fontFamily="Georgia, 'Times New Roman', serif" fontStyle="italic" fontWeight={600} fontSize="9.5" fill="currentColor" textAnchor="middle">0</text>
    </svg>
  )
}
