/**
 * Safe wrappers around Tauri APIs. All functions no-op gracefully in the
 * browser (Next.js dev mode) where the Tauri runtime is absent.
 */

export function isTauri(): boolean {
  // Tauri 2.x exposes __TAURI_INTERNALS__; Tauri 1.x exposed __TAURI__.
  return typeof window !== 'undefined' && (
    '__TAURI_INTERNALS__' in window || '__TAURI__' in window
  )
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

/**
 * Resolve an Agent Machine URL — absolute in Tauri, relative in browser.
 */
export function amUrl(path: string): string {
  return isTauri() ? `http://127.0.0.1:8080${path}` : path
}

/**
 * Invoke a Tauri command. Returns null in browser (non-Tauri) environments.
 */
export async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}
