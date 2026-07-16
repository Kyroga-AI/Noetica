import { amUrl } from '@/lib/tauri/bridge'
import type { WorkspaceSession } from './types'

/**
 * commons-client.ts — the frontend half of the opt-in open-chat commons. Opening a chat POSTs its messages to the
 * agent-machine, which runs the MANDATORY PII gate (open-chat-gate.ts) and either redacts-and-indexes or refuses.
 * Making a chat private DELETEs the entry (instant revocation). The visibility bit is only flipped to 'open' by the
 * caller when publish returns ok — so a refused publish never leaves a chat marked open-but-unindexed.
 */
export interface PublishFindings { pii: Record<string, number>; piiCount: number; exfilUrls: string[] }
export interface PublishResult { ok: boolean; findings?: PublishFindings; error?: string }

export async function publishOpenChat(session: WorkspaceSession): Promise<PublishResult> {
  // The caller (useSession.setSessionVisibility) already refuses ephemeral chats, and the server enforces it too;
  // we still pass the real flag so the server has an independent signal — never trust the client alone.
  const messages = (session.messages ?? []).map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : String(m.content ?? '') }))
  try {
    const res = await fetch(amUrl('/api/open-chats/publish'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, title: session.title, messages, ephemeral: session.ephemeral === true }),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return (await res.json()) as PublishResult
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'publish failed — is the agent running?' }
  }
}

export async function revokeOpenChat(sessionId: string): Promise<void> {
  try {
    await fetch(amUrl(`/api/open-chats/publish?session=${encodeURIComponent(sessionId)}`), { method: 'DELETE' })
  } catch { /* revoke is best-effort from the client; the server also drops it on next publish/list reconcile */ }
}
