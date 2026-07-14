'use client'

/**
 * projectRoot — a single filesystem root the user grants ONCE.
 *
 * Filesystem re-prompting came from re-picking directories and reading them
 * unscoped, with no persisted grant. Here the user picks one parent directory;
 * we hand it to the Rust `grant_project_root` command, which allows it (recursively)
 * in the Tauri fs scope. tauri-plugin-persisted-scope saves that grant, so browsing
 * into any subdirectory of it — and reading files under it — never re-prompts, even
 * across restarts. All local-browse / attachment paths should stay within this root.
 */
import { isTauri, invokeTauri } from '@/lib/tauri/bridge'

/** Re-establish the fs-scope grant for an already-chosen root (call on app start). */
export async function grantProjectRoot(path: string): Promise<void> {
  if (!isTauri() || !path) return
  try {
    await invokeTauri('grant_project_root', { path })
  } catch {
    /* persisted-scope may already have restored it; a failure here is non-fatal */
  }
}

/**
 * Prompt the user to pick a project root ONCE, grant it into the fs scope, and
 * return the chosen path (or null if cancelled / not in the desktop app).
 */
export async function pickProjectRoot(): Promise<string | null> {
  if (!isTauri()) return null
  // eslint-disable-next-line
  const dlg: any = await import(/* webpackIgnore: true */ '@tauri-apps/plugin-dialog' as string)
  const picked: string | string[] | null = await dlg.open({
    directory: true,
    multiple: false,
    title: 'Choose your project folder — Noetica will remember it',
  })
  const path = Array.isArray(picked) ? picked[0] : picked
  if (!path) return null
  await grantProjectRoot(path)
  return path
}
