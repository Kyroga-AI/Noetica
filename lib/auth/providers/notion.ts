import type { ConnectorAuthState } from '../types'
import { generateState } from '../pkce'

// ─── OAuth ────────────────────────────────────────────────────────────────────
// Notion uses authorization_code flow with Basic auth (client_id:client_secret).
// No PKCE — secret is required and stored in settings.

const PENDING_KEY = 'noetica-oauth-pending-notion'

export async function initiateNotionOAuth(clientId: string, redirectUri: string): Promise<void> {
  const state = generateState()
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ state }))

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    owner: 'user',
    state,
  })
  window.open(`https://api.notion.com/v1/oauth/authorize?${params.toString()}`, '_blank', 'width=520,height=680')
}

export async function exchangeNotionCode(
  code: string,
  clientId: string,
  redirectUri: string,
  clientSecret: string
): Promise<ConnectorAuthState> {
  sessionStorage.removeItem(PENDING_KEY)

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  })

  const res = await fetch('/api/oauth/notion/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) throw new Error(`Notion token exchange failed: ${await res.text()}`)

  const data = await res.json() as {
    access_token: string
    token_type: string
    bot_id: string
    workspace_name?: string
    workspace_id: string
    owner?: { user?: { name?: string; person?: { email?: string }; avatar_url?: string } }
    error?: string
  }

  if (data.error) throw new Error(`Notion error: ${data.error}`)

  const owner = data.owner?.user
  return {
    status: 'connected',
    accessToken: data.access_token,
    connectedAt: new Date().toISOString(),
    userInfo: {
      name: owner?.name ?? data.workspace_name,
      email: owner?.person?.email,
      avatar: owner?.avatar_url,
      login: data.workspace_name,
    },
  }
}

// ─── API types ────────────────────────────────────────────────────────────────

export type NotionPage = {
  id: string
  title: string
  url: string
  lastEdited: string
  icon?: string
  coverUrl?: string
}

type NotionBlock = {
  id: string
  type: string
  has_children: boolean
  [key: string]: unknown
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function notionGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
    },
  })
  if (!res.ok) throw new Error(`Notion API ${path} ${res.status}`)
  return res.json() as Promise<T>
}

async function notionPost<T>(token: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Notion API POST ${path} ${res.status}`)
  return res.json() as Promise<T>
}

function extractTitle(page: Record<string, unknown>): string {
  const props = page.properties as Record<string, unknown> | undefined
  if (!props) return 'Untitled'
  for (const prop of Object.values(props)) {
    const p = prop as Record<string, unknown>
    if (p.type === 'title') {
      const arr = p.title as Array<{ plain_text?: string }> | undefined
      return arr?.map((t) => t.plain_text ?? '').join('') || 'Untitled'
    }
  }
  return 'Untitled'
}

function extractIcon(page: Record<string, unknown>): string | undefined {
  const icon = page.icon as Record<string, unknown> | null | undefined
  if (!icon) return undefined
  if (icon.type === 'emoji') return icon.emoji as string
  return undefined
}

export async function fetchNotionPages(token: string): Promise<NotionPage[]> {
  const data = await notionPost<{ results: Array<Record<string, unknown>> }>(
    token,
    'search',
    {
      filter: { value: 'page', property: 'object' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: 50,
    }
  )

  return data.results.map((page) => ({
    id: page.id as string,
    title: extractTitle(page),
    url: page.url as string,
    lastEdited: page.last_edited_time as string,
    icon: extractIcon(page),
  }))
}

// ─── Block → text renderer ────────────────────────────────────────────────────

function richTextToString(rich: Array<{ plain_text?: string }>): string {
  return rich.map((t) => t.plain_text ?? '').join('')
}

function blockToMarkdown(block: NotionBlock): string {
  const type = block.type
  const content = block[type] as Record<string, unknown> | undefined
  if (!content) return ''

  const text = Array.isArray(content.rich_text)
    ? richTextToString(content.rich_text as Array<{ plain_text?: string }>)
    : ''

  switch (type) {
    case 'heading_1':    return `# ${text}\n`
    case 'heading_2':    return `## ${text}\n`
    case 'heading_3':    return `### ${text}\n`
    case 'paragraph':    return text ? `${text}\n` : '\n'
    case 'bulleted_list_item': return `• ${text}\n`
    case 'numbered_list_item': return `1. ${text}\n`
    case 'to_do': {
      const checked = (content.checked as boolean | undefined) ? 'x' : ' '
      return `[${checked}] ${text}\n`
    }
    case 'quote':        return `> ${text}\n`
    case 'divider':      return `---\n`
    case 'code': {
      const lang = (content.language as string | undefined) ?? ''
      return `\`\`\`${lang}\n${text}\n\`\`\`\n`
    }
    case 'callout':      return `💡 ${text}\n`
    case 'toggle':       return `▶ ${text}\n`
    default:             return text ? `${text}\n` : ''
  }
}

export async function fetchNotionPageContent(token: string, pageId: string): Promise<string> {
  const data = await notionGet<{ results: NotionBlock[] }>(token, `blocks/${pageId}/children?page_size=100`)
  return data.results.map(blockToMarkdown).join('')
}
