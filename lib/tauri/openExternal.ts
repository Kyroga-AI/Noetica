'use client'

/**
 * openExternal — open a link in the user's actual browser.
 *
 * In the desktop app, `window.open(url, '_blank')` silently does NOTHING: the Tauri
 * webview has no tabs and no window-creation capability, so every "open link" click
 * in chat search results was a dead click (v0.4.23 field report). Route through the
 * `open_external` Rust command (shell plugin → system default browser) when running
 * under Tauri; fall back to window.open on the web.
 */
import { isTauri, invokeTauri } from '@/lib/tauri/bridge'

export async function openExternal(url: string): Promise<void> {
  if (!url) return
  if (isTauri()) {
    try {
      await invokeTauri('open_external', { url })
      return
    } catch (e) {
      // Blocked scheme or plugin failure — log it, don't silently eat the click.
      console.warn('[open-external]', e)
      return
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
