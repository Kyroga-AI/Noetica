'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { McpServerConfig, McpServerState, McpTool, McpToolCall, McpToolResult } from '@/lib/types/mcp'
import { MCP_STORE_VERSION } from '@/lib/types/mcp'
import { loadMcpStore, saveMcpStore, makeServerConfig } from '@/lib/mcp/storage'
import { mcpManager } from '@/lib/mcp/client'

export interface UseMcpReturn {
  /** True after configs loaded from storage */
  hydrated: boolean
  /** All server states (config + runtime) */
  serverStates: McpServerState[]
  /** Flat list of tools across all connected servers */
  tools: McpTool[]
  /** Add a new server config and optionally connect */
  addServer: (partial: Omit<McpServerConfig, 'id' | 'createdAt'>, connectNow?: boolean) => Promise<void>
  /** Update a server config (disconnects + reconnects if connected) */
  updateServer: (id: string, patch: Partial<McpServerConfig>) => Promise<void>
  /** Remove a server config entirely */
  removeServer: (id: string) => Promise<void>
  /** Connect a server by id */
  connect: (id: string) => Promise<void>
  /** Disconnect a server by id */
  disconnect: (id: string) => Promise<void>
  /** Call a tool on a connected server */
  callTool: (call: McpToolCall) => Promise<McpToolResult>
}

export function useMcp(): UseMcpReturn {
  const [hydrated, setHydrated] = useState(false)
  const [serverStates, setServerStates] = useState<McpServerState[]>([])
  const configsRef = useRef<McpServerConfig[]>([])
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Subscribe to manager state changes ──────────────────────────────────

  useEffect(() => {
    const unsub = mcpManager.subscribe((states) => setServerStates(states))
    return unsub
  }, [])

  // ── Load configs from storage on mount ───────────────────────────────────

  useEffect(() => {
    let cancelled = false
    async function load() {
      const store = await loadMcpStore()
      if (cancelled) return
      configsRef.current = store.servers
      // Initialise manager state for each saved config (no auto-connect yet)
      for (const cfg of store.servers) {
        if (cfg.enabled) {
          // connect enabled servers on startup
          mcpManager.connect(cfg).catch(() => {/* handled in state */})
        }
      }
      setHydrated(true)
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ── Debounced save ───────────────────────────────────────────────────────

  function scheduleSave(configs: McpServerConfig[]) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveMcpStore({ servers: configs, version: MCP_STORE_VERSION }).catch(() => {/* ignore */})
    }, 600)
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  const addServer = useCallback(async (
    partial: Omit<McpServerConfig, 'id' | 'createdAt'>,
    connectNow = true,
  ) => {
    const cfg = makeServerConfig(partial)
    configsRef.current = [...configsRef.current, cfg]
    scheduleSave(configsRef.current)
    if (connectNow && cfg.enabled) {
      await mcpManager.connect(cfg)
    }
  }, [])

  const updateServer = useCallback(async (id: string, patch: Partial<McpServerConfig>) => {
    configsRef.current = configsRef.current.map((c) => c.id === id ? { ...c, ...patch } : c)
    scheduleSave(configsRef.current)
    const updated = configsRef.current.find((c) => c.id === id)
    if (!updated) return
    // Reconnect if currently connected
    const state = mcpManager.getState(id)
    if (state?.status === 'connected' && updated.enabled) {
      await mcpManager.connect(updated)
    } else if (!updated.enabled) {
      await mcpManager.disconnect(id)
    }
  }, [])

  const removeServer = useCallback(async (id: string) => {
    configsRef.current = configsRef.current.filter((c) => c.id !== id)
    scheduleSave(configsRef.current)
    await mcpManager.remove(id)
  }, [])

  const connect = useCallback(async (id: string) => {
    const cfg = configsRef.current.find((c) => c.id === id)
    if (cfg) await mcpManager.connect(cfg)
  }, [])

  const disconnect = useCallback(async (id: string) => {
    await mcpManager.disconnect(id)
  }, [])

  const callTool = useCallback((call: McpToolCall) => mcpManager.callTool(call), [])

  const tools = serverStates
    .filter((s) => s.status === 'connected')
    .flatMap((s) => s.tools)

  return { hydrated, serverStates, tools, addServer, updateServer, removeServer, connect, disconnect, callTool }
}
