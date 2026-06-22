/**
 * chat-import — parse a Claude / ChatGPT data-export into normalized conversations so they can be
 * ingested into the brain.
 *
 * IMPORTANT: chat history is NOT reachable with an API key — a key authorizes new model calls, not
 * access to your claude.ai / ChatGPT history. History only comes from the official EXPORT:
 *   - ChatGPT  → Settings → Data controls → Export  → conversations.json (array; each has `mapping`)
 *   - Claude   → Settings → Export data            → conversations.json (array; each has `chat_messages`)
 * This parser detects either shape (plus a generic {title, messages:[{role,content}]}) and returns a
 * uniform list the import endpoint feeds to ingestDocument (chunk → embed → atoms).
 */

export interface ImportedMessage { role: string; content: string }
export interface ImportedConversation { title: string; messages: ImportedMessage[] }

function partsToText(parts: unknown): string {
  if (typeof parts === 'string') return parts
  if (Array.isArray(parts)) return parts.map((p) => (typeof p === 'string' ? p : (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text ?? '') : ''))).join('\n')
  return ''
}

export function parseChatExport(data: unknown): ImportedConversation[] {
  const root = data as Record<string, unknown> | unknown[]
  const arr: unknown[] = Array.isArray(root) ? root : Array.isArray((root as Record<string, unknown>)?.['conversations']) ? (root as Record<string, unknown>)['conversations'] as unknown[] : []
  const out: ImportedConversation[] = []
  for (const c of arr) {
    const conv = c as Record<string, unknown>
    if (!conv || typeof conv !== 'object') continue

    // ── ChatGPT export: a `mapping` tree of message nodes ──
    if (conv['mapping'] && typeof conv['mapping'] === 'object') {
      const nodes = Object.values(conv['mapping'] as Record<string, { message?: Record<string, unknown> }>)
      const msgs = nodes
        .map((n) => n?.message).filter((m): m is Record<string, unknown> => !!m)
        .filter((m) => (m['author'] as { role?: string } | undefined)?.role && m['content'])
        .sort((a, b) => Number(a['create_time'] ?? 0) - Number(b['create_time'] ?? 0))
        .map((m) => ({ role: String((m['author'] as { role?: string }).role ?? 'user'), content: partsToText((m['content'] as { parts?: unknown }).parts).trim() }))
        .filter((m) => m.content)
      if (msgs.length) out.push({ title: String(conv['title'] ?? 'ChatGPT conversation'), messages: msgs })
      continue
    }

    // ── Claude export: a `chat_messages` array ──
    if (Array.isArray(conv['chat_messages'])) {
      const msgs = (conv['chat_messages'] as Record<string, unknown>[])
        .map((m) => ({
          role: m['sender'] === 'human' ? 'user' : 'assistant',
          content: String(m['text'] ?? partsToText(m['content'])).trim(),
        }))
        .filter((m) => m.content)
      if (msgs.length) out.push({ title: String(conv['name'] ?? 'Claude conversation'), messages: msgs })
      continue
    }

    // ── Generic {title, messages:[{role,content}]} ──
    if (Array.isArray(conv['messages'])) {
      const msgs = (conv['messages'] as Record<string, unknown>[])
        .map((m) => ({ role: String(m['role'] ?? 'user'), content: String(m['content'] ?? '').trim() }))
        .filter((m) => m.content)
      if (msgs.length) out.push({ title: String(conv['title'] ?? 'Conversation'), messages: msgs })
    }
  }
  return out
}

/** Flatten a conversation into a single transcript for document ingestion. */
export function transcript(conv: ImportedConversation): string {
  return conv.messages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')
}
