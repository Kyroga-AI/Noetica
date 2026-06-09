/**
 * Safe wrappers around Tauri APIs. All functions no-op gracefully in the
 * browser (Next.js dev mode) where the Tauri runtime is absent.
 */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window
}

type UnlistenFn = () => void

/**
 * Listen for an event emitted from the Tauri Rust backend.
 * Returns a cleanup function. Safe to call in useEffect.
 */
export async function listenTauri(
  event: string,
  handler: (payload: unknown) => void
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  return listen(event, (e) => handler(e.payload))
}
