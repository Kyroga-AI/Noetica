export function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-blue-600">
      <span className="inline-flex gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600 [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600 [animation-delay:240ms]" />
      </span>
      Streaming response
    </div>
  )
}
