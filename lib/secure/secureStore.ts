'use client'

/**
 * secureStore — secrets (API keys, OAuth tokens) go to the OS keychain via the Tauri keychain_* commands
 * (macOS Keychain / Linux Secret Service / Windows Credential Manager). In the browser, or if the keychain is
 * unavailable (e.g. a headless Linux box with no Secret Service), it falls back to localStorage so nothing
 * breaks — but the packaged desktop app keeps credentials OUT of plaintext localStorage, closing the worst
 * exposure (a single XSS / disk read no longer yields every key + refresh token).
 */
import { isTauri, invokeTauri } from '@/lib/tauri/bridge'

const FALLBACK_PREFIX = 'noetica:secure:'

export async function secureSet(key: string, value: string): Promise<void> {
  if (isTauri()) {
    try { await invokeTauri('keychain_set', { key, value }); return } catch { /* fall through */ }
  }
  try { window.localStorage.setItem(FALLBACK_PREFIX + key, value) } catch { /* quota */ }
}

export async function secureGet(key: string): Promise<string | null> {
  if (isTauri()) {
    try {
      const v = await invokeTauri<string | null>('keychain_get', { key })
      if (v != null) return v
      // keychain returned no entry — still check the fallback (migration from localStorage).
    } catch { /* fall through */ }
  }
  try { return window.localStorage.getItem(FALLBACK_PREFIX + key) } catch { return null }
}

export async function secureDelete(key: string): Promise<void> {
  if (isTauri()) {
    try { await invokeTauri('keychain_delete', { key }) } catch { /* fall through */ }
  }
  try { window.localStorage.removeItem(FALLBACK_PREFIX + key) } catch { /* */ }
}

/** One-time migration: move a secret currently in plaintext localStorage into the keychain, then clear it. */
export async function migrateSecretToKeychain(legacyKey: string, secureKey: string): Promise<void> {
  if (!isTauri()) return
  try {
    const existing = window.localStorage.getItem(legacyKey)
    if (existing) { await secureSet(secureKey, existing); window.localStorage.removeItem(legacyKey) }
  } catch { /* best-effort */ }
}
