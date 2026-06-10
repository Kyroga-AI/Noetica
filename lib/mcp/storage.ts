import type { McpConfigStore, McpServerConfig } from '@/lib/types/mcp'
import { MCP_STORE_KEY, MCP_STORE_VERSION } from '@/lib/types/mcp'
import { isTauri } from '@/lib/tauri/bridge'

// ─── Load ─────────────────────────────────────────────────────────────────────

export async function loadMcpStore(): Promise<McpConfigStore> {
  const empty: McpConfigStore = { servers: [], version: MCP_STORE_VERSION }
  try {
    if (isTauri()) {
      // eslint-disable-next-line
      const mod: any = await import('@tauri-apps/plugin-store' as string)
      // eslint-disable-next-line
      const store: any = await mod.load('noetica-mcp.json', { autoSave: true })
      // eslint-disable-next-line
      const raw: any = await store.get(MCP_STORE_KEY)
      if (raw && typeof raw === 'object' && Array.isArray(raw.servers)) return raw as McpConfigStore
      return empty
    }
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(MCP_STORE_KEY) : null
    if (!raw) return empty
    const parsed = JSON.parse(raw) as McpConfigStore
    if (!Array.isArray(parsed.servers)) return empty
    return parsed
  } catch {
    return empty
  }
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export async function saveMcpStore(store: McpConfigStore): Promise<void> {
  try {
    if (isTauri()) {
      // eslint-disable-next-line
      const mod: any = await import('@tauri-apps/plugin-store' as string)
      // eslint-disable-next-line
      const s: any = await mod.load('noetica-mcp.json', { autoSave: true })
      await s.set(MCP_STORE_KEY, store)
      return
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MCP_STORE_KEY, JSON.stringify(store))
    }
  } catch { /* ignore */ }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function makeServerConfig(
  partial: Omit<McpServerConfig, 'id' | 'createdAt'>
): McpServerConfig {
  return {
    ...partial,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
}
